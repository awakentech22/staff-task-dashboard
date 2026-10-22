(() => {
  'use strict';

  /*
   * Teams host for the dashboard. Loaded only by teams.html, before app.js.
   *
   * It signs in with Teams single sign-on (no login pop-up), sends the Teams
   * token to /api/teams/*, opens Planner links through Teams, and follows the
   * Teams light, dark or high-contrast theme. If the page is opened outside
   * Teams it explains how to get to the normal dashboard.
   */

  const TOKEN_REUSE_MS = 5 * 60 * 1000;
  const SIGN_IN_MESSAGE =
    'Teams couldn’t sign you in automatically. Close and reopen the tab, or ask an admin to check the app’s sign-in setup. You can also open the dashboard in a browser.';

  function userError(message) {
    const err = new Error(message);
    err.userMessage = message;
    return err;
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'dark' || theme === 'contrast' ? 'dark' : 'light';
  }

  let token = null;
  let tokenAt = 0;

  async function getToken(forceNew) {
    if (!forceNew && token && Date.now() - tokenAt < TOKEN_REUSE_MS) return token;
    try {
      token = await window.microsoftTeams.authentication.getAuthToken();
      tokenAt = Date.now();
      return token;
    } catch (err) {
      token = null;
      throw userError(SIGN_IN_MESSAGE);
    }
  }

  const REDIRECT_MESSAGE =
    'The API answered with a redirect to a sign-in page instead of data. That usually means the Teams sign-in token was rejected. Close and reopen the tab, and if it continues ask an admin to check the app’s sign-in setup.';

  // Adds the Teams token to a request. On a 401, a redirect or a dropped request it asks Teams
  // for a token again and tries once more before giving up. Redirects are not followed: a
  // sign-in redirect cannot work inside Teams and would only hide the real problem.
  async function authFetch(url, init = {}, retried = false) {
    const bearer = await getToken(retried);
    let response;
    try {
      response = await window.fetch(url, {
        ...init,
        redirect: 'manual',
        headers: { ...(init.headers || {}), Authorization: `Bearer ${bearer}` },
      });
    } catch (err) {
      if (!retried) return authFetch(url, init, true);
      throw err;
    }
    if (response.type === 'opaqueredirect') {
      if (!retried) return authFetch(url, init, true);
      throw userError(REDIRECT_MESSAGE);
    }
    if (response.status === 401 && !retried) return authFetch(url, init, true);
    return response;
  }

  function openLink(url) {
    const fallback = () => window.open(url, '_blank', 'noopener,noreferrer');
    try {
      window.microsoftTeams.app.openLink(url).catch(fallback);
    } catch (err) {
      fallback();
    }
  }

  async function start() {
    if (!window.microsoftTeams) throw userError('The Teams library did not load. Reload the tab.');
    try {
      await window.microsoftTeams.app.initialize();
    } catch (err) {
      const message = 'This page is built to run inside Microsoft Teams. To use the dashboard in a browser, go to the main address instead.';
      const link = document.createElement('a');
      link.href = '/';
      link.textContent = 'Open the dashboard';
      const note = document.getElementById('message');
      note.classList.add('is-error');
      note.textContent = `${message} `;
      note.append(link);
      throw Object.assign(new Error(message), { userMessage: null, handled: true });
    }

    const context = await window.microsoftTeams.app.getContext();
    applyTheme(context && context.app && context.app.theme);
    window.microsoftTeams.app.registerOnThemeChangeHandler(applyTheme);

    // Tell Teams the tab has loaded so it can hide its own loading indicator.
    try {
      window.microsoftTeams.app.notifyAppLoaded();
      window.microsoftTeams.app.notifySuccess();
    } catch (err) {
      /* Older hosts may not support these. */
    }
  }

  window.plannerHost = {
    tasksUrl: '/api/teams/tasks',
    peopleUrl: '/api/teams/people',
    fetch: authFetch,
    openLink,
    unauthorizedMessage: SIGN_IN_MESSAGE,
    ready: start(),
  };
  // A start-up failure is reported by app.js; keep the browser from logging it as unhandled.
  window.plannerHost.ready.catch(() => {});
})();
