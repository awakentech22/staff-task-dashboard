'use strict';

const { isViewer } = require('./roles');
const { verifyTeamsToken } = require('./teamsToken');

/** Static Web Apps forwards the signed-in user in this header. */
function callerPrincipal(request) {
  try {
    const header = request.headers.get('x-ms-client-principal');
    if (!header) return null;
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch (err) {
    return null;
  }
}

/**
 * Gate for every data endpoint. Returns { ok: true, principal } for people on
 * the VIEWER_EMAILS list, otherwise { ok: false, response } ready to return.
 */
function requireViewer(request) {
  const principal = callerPrincipal(request);
  if (!principal) {
    return { ok: false, response: { status: 401, jsonBody: { error: 'SIGN_IN_REQUIRED' } } };
  }
  if (!isViewer(principal, process.env.VIEWER_EMAILS)) {
    // Echo the caller's own sign-in name back so they can tell an admin what to add.
    return {
      ok: false,
      response: { status: 403, jsonBody: { error: 'NOT_ON_VIEWER_LIST', signedInAs: principal.userDetails || null } },
    };
  }
  return { ok: true, principal };
}

/**
 * Gate for the Teams endpoints (/api/teams/*). Those routes are open to
 * anonymous callers at the platform level, so this function is the only thing
 * standing between the internet and the data. It trusts nothing but a valid
 * Teams token in the Authorization header. It never reads x-ms-client-principal.
 */
async function requireTeamsViewer(request, { verify = verifyTeamsToken } = {}) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
  if (!match) return { ok: false, response: { status: 401, jsonBody: { error: 'SIGN_IN_REQUIRED', detail: 'NO_TOKEN' } } };

  let principal;
  try {
    principal = await verify(match[1], {
      tenantId: process.env.GRAPH_TENANT_ID,
      clientId: process.env.TEAMS_CLIENT_ID || process.env.AAD_CLIENT_ID,
    });
  } catch (err) {
    const code = (err && err.code) || 'INVALID';
    const unavailable = code === 'CONFIG' || code === 'KEYS_UNAVAILABLE';
    return {
      ok: false,
      response: { status: unavailable ? 503 : 401, jsonBody: { error: unavailable ? 'UNAVAILABLE' : 'SIGN_IN_REQUIRED', detail: code } },
    };
  }

  if (!isViewer(principal, process.env.VIEWER_EMAILS)) {
    return {
      ok: false,
      response: { status: 403, jsonBody: { error: 'NOT_ON_VIEWER_LIST', signedInAs: principal.userDetails || null } },
    };
  }
  return { ok: true, principal };
}

module.exports = { callerPrincipal, requireViewer, requireTeamsViewer };
