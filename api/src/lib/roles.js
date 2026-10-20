'use strict';

/**
 * Decides whether a signed-in person may view the dashboard.
 *
 * Static Web Apps calls the GetRoles function after login and posts the user's
 * identity. We compare the sign-in name (and a few equivalent claims) against
 * the VIEWER_EMAILS app setting. Matching claims come from a token issued by
 * our own tenant only, because staticwebapp.config.json pins the issuer.
 */

const IDENTIFIER_CLAIMS = new Set(['preferred_username', 'upn', 'unique_name', 'email', 'emailaddress']);

function parseList(value) {
  return new Set(
    String(value || '')
      .split(/[,;\n]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function collectIdentifiers(principal) {
  const found = new Set();
  const add = (value) => {
    const v = String(value || '').trim().toLowerCase();
    if (v.includes('@')) found.add(v);
  };

  add(principal && principal.userDetails);

  const claims = Array.isArray(principal && principal.claims) ? principal.claims : [];
  for (const claim of claims) {
    const type = String((claim && (claim.typ || claim.type)) || '').toLowerCase();
    const last = type.split('/').pop();
    if (IDENTIFIER_CLAIMS.has(last)) add(claim.val || claim.value);
  }
  return found;
}

function isViewer(principal, allowedCsv) {
  const allowed = parseList(allowedCsv);
  if (allowed.size === 0) return false;
  for (const id of collectIdentifiers(principal)) {
    if (allowed.has(id)) return true;
  }
  return false;
}

module.exports = { parseList, collectIdentifiers, isViewer };
