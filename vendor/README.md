# Vendored libraries

`MicrosoftTeams.min.js` is the UMD build of `@microsoft/teams-js` version 2.58.0 (MIT license, see `MicrosoftTeams.LICENSE.txt`). It is kept in the repo so the page can run under a strict content security policy with no outside scripts.

To update it: `npm install @microsoft/teams-js`, copy `node_modules/@microsoft/teams-js/dist/umd/MicrosoftTeams.min.js` over this file, and update the version above.
