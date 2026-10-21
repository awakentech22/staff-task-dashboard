'use strict';

const { isViewer } = require('./roles');

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

module.exports = { callerPrincipal, requireViewer };
