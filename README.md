# Staff task dashboard

A live, sign-in-protected dashboard that shows the open Microsoft Planner tasks for a short list of staff. It runs on Azure Static Web Apps: a plain HTML/CSS/JS page plus a small Node API that reads Planner through Microsoft Graph.

```
Browser ──sign in──▶ Static Web Apps (Entra ID login, role "viewer")
   │                       │
   │  GET /api/tasks       ▼
   └──────────────▶  Managed function ──app-only token──▶ Microsoft Graph
                           │                 GET /users/{email}/planner/tasks
                           └─ staff list: api/staff.json
```

Every time the page loads (and every 5 minutes while it stays open) it asks `/api/tasks`, which queries Graph live. Results are cached on the server for 60 seconds so several people opening the page do not each trigger a full Graph run.

## Repository layout

| Path | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | The dashboard. No build step and no framework. |
| `403.html`, `403.css` | Shown to signed-in people who are not on the viewer list. |
| `staticwebapp.config.json` | Login provider, route protection, security headers, API runtime. |
| `api/staff.json` | Who appears on the dashboard. |
| `api/src/functions/tasks.js` | `GET /api/tasks`. |
| `api/src/functions/getRoles.js` | `POST /api/GetRoles`. Gives the `viewer` role to people on the allowlist. |
| `api/src/lib/*.js` | Graph client, task shaping, role matching. |
| `api/test/*.test.js` | Unit tests (`cd api && npm install && npm test`). |

Do not delete or edit the `.github/workflows/azure-static-web-apps-*.yml` file Azure added to the repo. It must keep `app_location: "/"`, `api_location: "api"`, and an empty output location.

## Two Entra app registrations

Keep these separate. The first has tenant-wide read access to Planner, so it never needs to sign anyone in. The second only signs people in and has no data permissions.

| | Graph reader (backend) | Login (website) |
|---|---|---|
| Purpose | Reads Planner tasks | Signs viewers in |
| Credential type | Application permissions | Web redirect + ID tokens |
| Permissions | `Tasks.Read.All`, `Group.Read.All` (admin consent) | None beyond default sign-in |
| Settings | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET` |

## First-time setup

1. **Graph reader registration.** Create it with the permissions above and grant admin consent. Create a client secret.
2. **Login registration.** In the Entra admin center go to **App registrations > New registration**.
   - Name: `Staff Task Dashboard Login`. Supported account types: this organizational directory only.
   - Redirect URI: platform **Web**, value `https://<your-site-hostname>/.auth/login/aad/callback`.
   - After creating it, open **Authentication** and under **Implicit grant and hybrid flows** tick **ID tokens**, then save.
   - Open **Certificates & secrets** and create a client secret. Copy the value immediately.
3. **Tenant ID.** In `staticwebapp.config.json`, replace `YOUR_TENANT_ID` in `openIdIssuer` with your Directory (tenant) ID. This pins sign-in to your organization. It is not a secret.
4. **App settings.** In the Azure portal open the Static Web App, go to **Environment variables** (older portals label it **Configuration**), and add:

   | Name | Value |
   |---|---|
   | `GRAPH_TENANT_ID` | Directory (tenant) ID |
   | `GRAPH_CLIENT_ID` | Graph reader app's client ID |
   | `GRAPH_CLIENT_SECRET` | Graph reader app's secret value |
   | `AAD_CLIENT_ID` | Login app's client ID |
   | `AAD_CLIENT_SECRET` | Login app's secret value |
   | `VIEWER_EMAILS` | Comma-separated sign-in emails allowed to view, for example `tony@awakenlv.org, pastor@awakenlv.org` |
   | `CACHE_SECONDS` (optional) | Server cache length. Default 60. |
   | `COMPLETED_DAYS` (optional) | How far back "recently completed" reaches. Default 14. |

   Static Web Apps custom sign-in needs the **Standard** hosting plan.
5. **Staff list.** Edit `api/staff.json`. Use each person's Microsoft 365 sign-in name for `email`.
6. **Deploy.** Commit everything to `main`. GitHub Actions builds and deploys automatically. Watch progress on the repo's **Actions** tab.
7. **Check it.** Open the site, sign in, and confirm one column per person. A signed-in person not on `VIEWER_EMAILS` should see the "isn't shared with you" page.

## Day-to-day changes

| To do this | Do this |
|---|---|
| Add or remove a person on the dashboard | Edit `api/staff.json` and commit. |
| Let another person view the dashboard | Add their email to `VIEWER_EMAILS`. Takes effect on their next sign-in. |
| Rotate the Graph secret | Create a new secret in the Graph reader registration, update `GRAPH_CLIENT_SECRET`, delete the old one. |
| Change the refresh feel | `CACHE_SECONDS` (server) or `AUTO_REFRESH_MS` at the top of `app.js` (browser). |

Put a calendar reminder a few weeks before each client secret expires. An expired secret makes every column show an error.

## How tasks are shown

- Each person's open tasks are grouped as overdue, due in the next 7 days, later, and no due date. The bar under the name shows that split at a glance.
- "Recently completed" is hidden until the toggle in the header is switched on.
- Dates are calendar days in Pacific time.
- Priority flags appear only for Urgent and Important tasks.
- Task titles and plan names are rendered as plain text, never as HTML.
- Tasks in Planner Premium plans may not appear, because the Graph Planner API does not cover them.

## Local development

```sh
npm install -g @azure/static-web-apps-cli azure-functions-core-tools@4
cd api && npm install && cp local.settings.json.example local.settings.json
# fill in the GRAPH_* values and VIEWER_EMAILS, then from the repo root:
swa start . --api-location api
```

`local.settings.json` is git-ignored. The SWA emulator's fake login lets you enter roles; add `viewer` to see the dashboard. Never commit secrets.

## Troubleshooting

| What you see | Likely cause |
|---|---|
| Every column says tasks are unavailable and mentions app settings | One of the `GRAPH_*` settings is missing or misspelled. |
| Every column says Microsoft rejected the app's sign-in | The Graph client secret expired or was pasted wrong. |
| Every column says the app isn't allowed to read Planner | Admin consent was not granted for `Tasks.Read.All`. |
| One column says Microsoft 365 doesn't recognize an email | The email in `staff.json` is not that person's sign-in name. Use their `userId` (Entra object ID) instead. |
| Plan or bucket names are missing | Name lookups failed. Tasks still show; check consent for `Tasks.Read.All`. |
| You are signed in but land on the "isn't shared" page | Your email is not in `VIEWER_EMAILS`, or the setting has a typo. Sign out and back in after fixing. |
| Sign-in loops or shows an error before the app loads | The redirect URI on the login registration must match `https://<hostname>/.auth/login/aad/callback` exactly, and **ID tokens** must be ticked. |

## Security notes

- Access needs both a sign-in from your tenant and an entry in `VIEWER_EMAILS`. The API enforces the same role check again on its own.
- The Graph secret lives only in Azure app settings. It is never sent to the browser or committed.
- Responses are marked `no-store`, and a content security policy limits the page to its own scripts and styles.
- The Graph reader can read every user's Planner tasks in the tenant. The code only requests the people in `staff.json`, but that limit is enforced in code, so treat the secret like a password.

## Microsoft Teams (planned next phase)

The dashboard can be added as a Teams tab. That needs a Teams app manifest, a Teams single sign-on step (a Teams tab cannot show a normal login redirect), and an updated `frame-ancestors` entry in the content security policy in `staticwebapp.config.json`. None of that is included yet.

## Fonts

The page falls back to Helvetica or Arial because the Suiza brand font files are not in this repo. Add licensed files and an `@font-face` rule at the top of `styles.css` to switch it on.
