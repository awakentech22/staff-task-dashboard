'use strict';

const { getUserId } = require('./graph');
const { collectIdentifiers } = require('./roles');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function objectIdFromClaims(principal) {
  const claims = Array.isArray(principal && principal.claims) ? principal.claims : [];
  for (const claim of claims) {
    const last = String((claim && (claim.typ || claim.type)) || '').toLowerCase().split('/').pop();
    const value = String((claim && (claim.val || claim.value)) || '');
    if ((last === 'objectidentifier' || last === 'oid') && GUID.test(value)) return value;
  }
  return null;
}

/**
 * The signed-in viewer's Entra object ID, used to find plans they created.
 * Uses the token's object-id claim when Static Web Apps forwards it, and
 * otherwise looks the viewer up in the directory by sign-in name.
 */
async function resolveViewerId(principal) {
  const fromClaim = objectIdFromClaims(principal);
  if (fromClaim) return fromClaim;
  for (const identifier of collectIdentifiers(principal)) {
    const id = await getUserId(identifier);
    if (id) return id;
  }
  return null;
}

module.exports = { resolveViewerId, objectIdFromClaims };
