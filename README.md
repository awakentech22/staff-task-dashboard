# Staff task dashboard

A live, sign-in-protected dashboard that shows the open Microsoft Planner tasks for staff. It opens with a default list, and each viewer can search the organization and choose up to 8 people to follow. It runs on Azure Static Web Apps: a plain HTML/CSS/JS page plus a small Node API that reads Planner through Microsoft Graph.

```
Browser ──sign in──▶ Static Web Apps (Entra ID login, your tenant only)
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
| `403.html`, `403.css` | Fallback page if the platform itself ever returns a 403. |
| `staticwebapp.config.json` | Login provider, sign-in requirement, security headers, API runtime. |
| `api/staff.json` | The default list shown until a viewer chooses their own people. |
| `api/src/functions/tasks.js` | `GET /api/tasks` (default list) and `POST /api/tasks` (chosen people, max 8). |
| `api/src/functions/people.js` | `GET /api/people?q=` directory search for the picker. |
| `api/src/lib/*.js` | Graph client, task shaping, viewer-list matching, request validation. |
| `api/test/*.test.js` | Unit tests (`cd api && npm install && npm test`). |

Do not delete or edit the `.github/workflows/azure-static-web-apps-*.yml` file Azure added to the repo. It must keep `app_location: "/"`, `api_location: "api"`, and an empty output location.

## Two Entra app registrations

Keep these separate. The first has tenant-wide read access to Planner, so it never needs to sign anyone in. The second only signs people in and has no data permissions.

| | Graph reader (backend) | Login (website) |
|---|---|---|
| Purpose | Reads Planner tasks | Signs viewers in |
| Credential type | Application permissions | Web redirect + ID tokens |
| Permissions | `Tasks.Read.All`, `User.Read.All` (admin consent) | None beyond default sign-in |
| Settings | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET` |

## First-time setup

1. **Graph reader registration.** Create it with the permissions above and grant admin consent. Create a client secret. `User.Read.All` is only used by the people search; the default list works without it, but "Choose people" shows a permission message until it is consented.
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
7. **Check it.** Open the site, sign in, and confirm one column per person. A signed-in person who is not on `VIEWER_EMAILS` sees a message naming the account they signed in with, and no task data.

## Day-to-day changes

| To do this | Do this |
|---|---|
| Change the default list | Edit `api/staff.json` and commit. Viewers who chose their own people keep their choice. |
| Let another person view the dashboard | Add their email to `VIEWER_EMAILS`. Takes effect on their next refresh. |
| Rotate the Graph secret | Create a new secret in the Graph reader registration, update `GRAPH_CLIENT_SECRET`, delete the old one. |
| Change the refresh feel | `CACHE_SECONDS` (server) or `AUTO_REFRESH_MS` at the top of `app.js` (browser). |

Put a calendar reminder a few weeks before each client secret expires. An expired secret makes every column show an error.

## Choosing people

- **Choose people** opens a panel with a search box. It searches names and email addresses across the organization, shows up to 10 matches, and lets a viewer add or remove people. The limit is 8 people.
- A viewer's choice is saved in their own browser (local storage) and applies on that browser only. **Reset to the default list** goes back to `api/staff.json`.
- The browser sends the chosen people as `{ key, name }` pairs, where `key` is an Entra object ID or an email. The server validates the keys and only uses `name` as a display label.
- Anyone on `VIEWER_EMAILS` can follow anyone's Planner tasks in the tenant. Keep that list short and deliberate.

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

`local.settings.json` is git-ignored. The SWA emulator's fake login lets you enter roles; add any email on your `VIEWER_EMAILS` list as the user. Never commit secrets.

## Troubleshooting

| What you see | Likely cause |
|---|---|
| Every column says tasks are unavailable and mentions app settings | One of the `GRAPH_*` settings is missing or misspelled. |
| Every column says Microsoft rejected the app's sign-in | The Graph client secret expired or was pasted wrong. |
| Every column says the app isn't allowed to read Planner | Admin consent was not granted for `Tasks.Read.All`. |
| One column says Microsoft 365 doesn't recognize an email | The email in `staff.json` is not that person's sign-in name. Use their `userId` (Entra object ID) instead. |
| The picker says the app needs permission to search people | `User.Read.All` has not been added and consented on the Graph reader registration. |
| Plan or bucket names are missing | Name lookups failed. Tasks still show; check consent for `Tasks.Read.All`. |
| The page says your account isn't on the viewer list | The sign-in name shown in the message must appear in `VIEWER_EMAILS`. Fix the setting and refresh. |
| Sign-in loops or shows an error before the app loads | The redirect URI on the login registration must match `https://<hostname>/.auth/login/aad/callback` exactly, and **ID tokens** must be ticked. |

## Security notes

- Access needs both a sign-in from your tenant and an entry in `VIEWER_EMAILS`. The page shell loads for any signed-in person in your tenant, but all task data comes from `/api/tasks`, which checks the viewer list on every request.
- The Graph secret lives only in Azure app settings. It is never sent to the browser or committed.
- Responses are marked `no-store`, and a content security policy limits the page to its own scripts and styles.
- The Graph reader can read every user's Planner tasks and profile in the tenant. The API only does so for signed-in people on `VIEWER_EMAILS`, but that limit is enforced in code, so treat the secret like a password.
- Requests are validated: at most 8 people, and every key must be an Entra object ID or an email address.

## Microsoft Teams (planned next phase)

The dashboard can be added as a Teams tab. That needs a Teams app manifest, a Teams single sign-on step (a Teams tab cannot show a normal login redirect), and an updated `frame-ancestors` entry in the content security policy in `staticwebapp.config.json`. None of that is included yet.

## Fonts

The page falls back to Helvetica or Arial because the Suiza brand font files are not in this repo. Add licensed files and an `@font-face` rule at the top of `styles.css` to switch it on.
