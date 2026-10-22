# Planner tasks dashboard

A live, sign-in-protected dashboard that shows the open Microsoft Planner tasks for the people each viewer chooses. Viewers search the organization and pick up to 8 people to follow; nobody is shown until they do. It runs on Azure Static Web Apps: a plain HTML/CSS/JS page plus a small Node API that reads Planner through Microsoft Graph.

```
Browser ──sign in──▶ Static Web Apps (Entra ID login, your tenant only)
   │                       │
   │  GET /api/tasks       ▼
   └──────────────▶  Managed function ──app-only token──▶ Microsoft Graph
                           │                 GET /users/{email}/planner/tasks
                           └─ people: chosen by each viewer in the page
```

Every time the page loads (and every 5 minutes while it stays open) it asks `/api/tasks`, which queries Graph live. Results are cached on the server for 60 seconds so several people opening the page do not each trigger a full Graph run.

## Repository layout

| Path | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | The dashboard. No build step and no framework. |
| `teams.html`, `teams.js` | The Teams tab page and its Teams host (sign-in, links, theme). |
| `vendor/` | Vendored Teams JavaScript library (`MicrosoftTeams.min.js`). |
| `teams/` | Teams app manifest template, icons and `build_package.py`. |
| `403.html`, `403.css` | Fallback page if the platform itself ever returns a 403. |
| `staticwebapp.config.json` | Login provider, sign-in requirement, security headers, API runtime. |
| `api/src/functions/tasks.js` | `POST /api/tasks` (the chosen people, max 8). With no people it returns an empty list. |
| `api/src/functions/people.js` | `GET /api/people?q=` directory search for the picker. |
| `api/src/functions/teamsTasks.js`, `teamsPeople.js` | `/api/teams/tasks` and `/api/teams/people`: the same endpoints for Teams, gated by a Teams token. |
| `api/src/lib/*.js` | Graph client, task shaping, viewer-list matching, request validation, Teams token validation, shared handlers. |
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

1. **Graph reader registration.** Create it with the permissions above and grant admin consent. Create a client secret. `User.Read.All` powers the people search and identifies the viewer for "Only plans I created". Without it, search shows a permission message and the page shows every plan.
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
   | `TEAMS_CLIENT_ID` (optional) | Only if Teams sign-in uses a different app registration than `AAD_CLIENT_ID`. |

   Static Web Apps custom sign-in needs the **Standard** hosting plan.
5. **Deploy.** Commit everything to `main`. GitHub Actions builds and deploys automatically. Watch progress on the repo's **Actions** tab.
6. **Check it.** Open the site, sign in, press **Choose people**, add someone, and confirm their column appears. A signed-in person who is not on `VIEWER_EMAILS` sees a message naming the account they signed in with, and no task data.

## Day-to-day changes

| To do this | Do this |
|---|---|
| Let another person view the dashboard | Add their email to `VIEWER_EMAILS`. Takes effect on their next refresh. |
| Rotate the Graph secret | Create a new secret in the Graph reader registration, update `GRAPH_CLIENT_SECRET`, delete the old one. |
| Change the refresh feel | `CACHE_SECONDS` (server) or `AUTO_REFRESH_MS` at the top of `app.js` (browser). |

Put a calendar reminder a few weeks before each client secret expires. An expired secret makes every column show an error.

## Choosing people

- **Choose people** opens a panel with a search box. It searches names and email addresses across the organization, shows up to 10 matches, and lets a viewer add or remove people. The limit is 8 people.
- A viewer's choice is saved in their own browser (local storage) and applies on that browser only. **Clear all** in the panel removes everyone. A first visit starts empty with a prompt to choose people.
- The browser sends the chosen people as `{ key, name }` pairs, where `key` is an Entra object ID or an email. The server validates the keys and only uses `name` as a display label.
- Anyone on `VIEWER_EMAILS` can follow anyone's Planner tasks in the tenant. Keep that list short and deliberate.

## Opening tasks in Planner

A task's title opens that task in Planner, and the plan name opens the plan's board. Both open in a new tab and only work for people who have access to the plan.

The links are built on the server from two templates. The plan format was taken from a real Planner link, `https://planner.cloud.microsoft/ui/web/plan/<planId>/view/board?tid=<tenantId>`. The task format extends it with `/task/<taskId>`; confirm it by opening one task link after deploying. If Microsoft changes either, change a setting instead of the code:

| Setting | Default |
|---|---|
| `PLANNER_TASK_URL_TEMPLATE` | `https://planner.cloud.microsoft/ui/web/plan/{planId}/view/board/task/{taskId}?tid={tenantId}` |
| `PLANNER_PLAN_URL_TEMPLATE` | `https://planner.cloud.microsoft/ui/web/plan/{planId}/view/board?tid={tenantId}` |

Set a template to `none` to turn that link off. `{tenantId}` comes from `GRAPH_TENANT_ID`. Only `https` links are ever shown.

## Only plans I created

The header has an **Only plans I created** switch, on by default. When it is on, each column shows only the tasks that sit in plans the signed-in viewer created, so a manager sees the plans they set up for an employee and not the employee's other plans.

- Planner records who created each plan. The API reads that from the plan and compares it with the viewer's Entra object ID. The viewer's ID comes from the sign-in token when Static Web Apps forwards it, and otherwise from a directory lookup by sign-in name (this uses `User.Read.All`).
- Each column notes how many open tasks are hidden because their plan was created by someone else. Turning the switch off shows every plan again.
- The switch is saved in the viewer's browser.
- If the API cannot work out who the viewer is, the page says so and shows every plan instead of an empty dashboard.
- Tasks in a plan whose creator cannot be read are treated as not created by the viewer, so they are hidden while the switch is on.
- "Created by" means who created the plan, not who currently manages it. Plans created by an app, or by someone else such as an admin, do not count as the viewer's.
- Only tasks assigned to the chosen person are shown. Unassigned tasks in the same plan do not appear.
- This is a view preference, not an access control. Anyone on `VIEWER_EMAILS` can switch it off.

API shape: `POST /api/tasks` takes `{ "people": [{ "key": "...", "name": "..." }] | null, "onlyMine": true | false }`. `onlyMine` defaults to true. The response includes a `filter` object (`onlyMine`, `applied`, `error`) and a `hiddenCount` per person.

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
| One column says Microsoft 365 doesn't recognize someone | Remove them and search for them again, so the entry uses their directory ID. |
| The picker says the app needs permission to search people | `User.Read.All` has not been added and consented on the Graph reader registration. |
| The page says it couldn't work out which plans you created | The viewer lookup failed. Check that `User.Read.All` is consented and that your sign-in name exists in the directory. All plans are shown until it works. |
| A column says tasks are hidden but you expected to see them | The plan was created by someone else or by an app. Turn off **Only plans I created** to see it. |
| Plan or bucket names are missing | Name lookups failed. Tasks still show; check consent for `Tasks.Read.All`. |
| The page says your account isn't on the viewer list | The sign-in name shown in the message must appear in `VIEWER_EMAILS`. Fix the setting and refresh. |
| Sign-in loops or shows an error before the app loads | The redirect URI on the login registration must match `https://<hostname>/.auth/login/aad/callback` exactly, and **ID tokens** must be ticked. |

## Security notes

- Access needs both a sign-in from your tenant and an entry in `VIEWER_EMAILS`. The page shell loads for any signed-in person in your tenant, but all task data comes from `/api/tasks`, which checks the viewer list on every request.
- The Graph secret lives only in Azure app settings. It is never sent to the browser or committed.
- Responses are marked `no-store`, and a content security policy limits the page to its own scripts and styles.
- The Graph reader can read every user's Planner tasks and profile in the tenant. The API only does so for signed-in people on `VIEWER_EMAILS`, but that limit is enforced in code, so treat the secret like a password.
- Requests are validated: at most 8 people, and every key must be an Entra object ID or an email address.
- The Teams endpoints are open at the platform level and protected by token validation in code. That code is covered by tests for forged, expired, wrong-tenant, wrong-audience and wrong-scope tokens. Keep `api/test/teamsToken.test.js` passing before changing it.

## Microsoft Teams

The dashboard runs as a personal tab in Teams (and, with the same package, in the Microsoft 365 app and Outlook). It is the same dashboard: choose people, the plan filter, and links all work. It follows the Teams light, dark and high-contrast themes.

### How sign-in works in Teams

Microsoft's sign-in page cannot appear inside a frame, so the browser cookie sign-in cannot be used. Instead:

1. `teams.html` loads inside Teams and `teams.js` asks Teams for a single-sign-on token (`getAuthToken`). Nobody sees a login prompt.
2. The page sends that token to `/api/teams/tasks` and `/api/teams/people` in a header named `X-Teams-Token`. It deliberately does not use `Authorization`: in testing, the API received a different value in that header from the platform in front of it.
3. The API checks the token itself (`api/src/lib/teamsToken.js`): RS256 signature against your tenant's published keys, expiry, tenant, issuer, audience, and the `access_as_user` scope. It then applies the same `VIEWER_EMAILS` list.

Because Teams has no Static Web Apps cookie, `/api/teams/*` and the few files the Teams page needs (`teams.html`, `teams.js`, `app.js`, `styles.css`, `vendor/*`) are open to anonymous requests in `staticwebapp.config.json`. The files are only page code. All data comes from the API, and the Teams endpoints ignore the `x-ms-client-principal` header completely, so a forged header cannot get in. Only `teams.html` may be framed by Teams, Microsoft 365 and Outlook; every other page still refuses framing.

### Setup

1. **Expose an API on the login app registration** (the one behind `AAD_CLIENT_ID`). In the Entra admin center open it, then **Expose an API**:
   - Set the **Application ID URI** to `api://<site hostname>/<Application (client) ID>`, for example `api://victorious-coast-06011241e.3.azurestaticapps.net/00000000-0000-0000-0000-000000000000`. The hostname is the site's address without `https://`.
   - **Add a scope** named `access_as_user`. Who can consent: **Admins and users**. Give it any consent titles and descriptions, for example "Teams can sign you in to the Planner dashboard".
   - Under **Authorized client applications**, add these two client IDs and tick the `access_as_user` scope for each:
     - `1fec8e78-bce4-4aaf-ab1b-5451cc387264` (Teams desktop and mobile)
     - `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` (Teams web)
   - If you use a different registration for Teams than for the browser login, add its client ID as the app setting `TEAMS_CLIENT_ID`. Otherwise no new settings are needed.
2. **Deploy the files.** Commit everything in this repo, wait for the green check on the **Actions** tab, and confirm `https://<site hostname>/teams.html` loads (outside Teams it shows a message saying it must run in Teams).
3. **Build the app package.**

   ```sh
   python3 teams/build_package.py --client-id <Application (client) ID> --host <site hostname>
   ```

   This writes `teams/dist/planner-tasks-teams.zip` (a `manifest.json` plus two icons). Run it again with a higher `--version` after any change to the manifest, or Teams will not treat the upload as an update. Before sharing widely, edit `teams/manifest.template.json` so the `websiteUrl`, `privacyUrl` and `termsOfUseUrl` point at real pages.
4. **Upload the package.** In the Teams admin center go to **Teams apps > Manage apps > Upload new app** and choose the zip. To limit who sees it, use an app permission policy and a setup policy (which can also pin it). To try it yourself first, use **Apps > Manage your apps > Upload an app** in Teams, if custom app uploads are allowed in your tenant.
5. **Open it.** Find **Planner Tasks** in Teams, open it, and confirm your columns load.

### Troubleshooting Teams

| What you see | Likely cause |
|---|---|
| The tab is blank or says the page refused to connect | The frame permission is missing. Confirm `teams.html` is deployed and the route in `staticwebapp.config.json` still has the `frame-ancestors` list. |
| "Teams couldn't sign you in automatically" | The Application ID URI, scope or authorized client IDs on the registration do not match the manifest. The URI must be exactly `api://<host>/<client ID>`. Rebuild the package if the host or client ID changed. |
| The page says your account isn't on the viewer list | Add the sign-in name shown in the message to `VIEWER_EMAILS`. |
| Opening `/teams.html` in a browser shows a "must run in Teams" notice | Expected. The browser address is the main site. |
| The dashboard works in a browser but not in Teams | Compare the two. A 401 from `/api/teams/*` includes a `detail` code (for example `BAD_AUDIENCE`, `BAD_SCOPE`, `BAD_ISSUER`, `EXPIRED`) that names the failed check. |
| Settings reset each time you open the tab | Teams can clear local storage. "Choose people" and the plan filter are saved per browser and may reset. |

Token `detail` codes: `NO_TOKEN`, `MALFORMED`, `BAD_ALGORITHM`, `UNKNOWN_KEY`, `BAD_SIGNATURE`, `EXPIRED`, `NOT_YET_VALID`, `BAD_TENANT`, `BAD_ISSUER`, `BAD_AUDIENCE`, `BAD_SCOPE`, `NO_USER`, `CONFIG`, `KEYS_UNAVAILABLE`.

## Fonts

The page falls back to Helvetica or Arial because the Suiza brand font files are not in this repo. Add licensed files and an `@font-face` rule at the top of `styles.css` to switch it on.
