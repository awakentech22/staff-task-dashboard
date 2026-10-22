'use strict';

/**
 * Validates the single-sign-on token that Microsoft Teams hands to a tab
 * (microsoftTeams.authentication.getAuthToken). Uses only Node's crypto module.
 *
 * Checks: RS256 signature against your tenant's published keys, expiry, tenant,
 * issuer (v1 or v2 token), audience (the app's client ID or its api:// URI) and
 * the access_as_user scope. Anything else is rejected.
 */

const crypto = require('crypto');

const SKEW_SECONDS = 120;
const KEYS_TTL_MS = 60 * 60 * 1000;
const KEYS_MIN_REFRESH_MS = 5 * 60 * 1000;
const REQUIRED_SCOPE = 'access_as_user';

class TokenError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

let keyCache = { keys: null, at: 0 };

function resetTokenCaches() {
  keyCache = { keys: null, at: 0 };
}

async function fetchKeys(tenantId) {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/discovery/v2.0/keys`);
  if (!response.ok) throw new TokenError('KEYS_UNAVAILABLE');
  const data = await response.json();
  return Array.isArray(data.keys) ? data.keys : [];
}

/**
 * Finds the signing key for a token. An unknown key ID triggers a refresh, but
 * never more than once every few minutes, so junk tokens cannot force fetches.
 */
async function findKey(kid, tenantId, getKeys) {
  const now = Date.now();
  if (keyCache.keys && now - keyCache.at < KEYS_TTL_MS) {
    const hit = keyCache.keys.find((key) => key.kid === kid);
    if (hit) return hit;
  }
  if (!keyCache.keys || now - keyCache.at >= KEYS_MIN_REFRESH_MS) {
    keyCache = { keys: await getKeys(tenantId), at: now };
    return keyCache.keys.find((key) => key.kid === kid) || null;
  }
  return null;
}

function fromBase64Url(value) {
  return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseSegment(value) {
  try {
    const parsed = JSON.parse(fromBase64Url(value).toString('utf8'));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (err) {
    /* fall through */
  }
  throw new TokenError('MALFORMED');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns a principal ({ userDetails, claims }) shaped like the one Static Web
 * Apps provides, so the same viewer-list and viewer-lookup code works for both.
 */
async function verifyTeamsToken(token, { tenantId, clientId, now = Date.now(), getKeys = fetchKeys } = {}) {
  if (!tenantId || !clientId) throw new TokenError('CONFIG');

  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new TokenError('MALFORMED');

  const header = parseSegment(parts[0]);
  const claims = parseSegment(parts[1]);

  if (header.alg !== 'RS256') throw new TokenError('BAD_ALGORITHM');
  const jwk = await findKey(header.kid, tenantId, getKeys);
  if (!jwk) throw new TokenError('UNKNOWN_KEY');

  let valid = false;
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, fromBase64Url(parts[2]));
  } catch (err) {
    valid = false;
  }
  if (!valid) throw new TokenError('BAD_SIGNATURE');

  const nowSeconds = Math.floor(now / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_SECONDS < nowSeconds) throw new TokenError('EXPIRED');
  if (typeof claims.nbf === 'number' && claims.nbf - SKEW_SECONDS > nowSeconds) throw new TokenError('NOT_YET_VALID');

  const tenant = String(tenantId).toLowerCase();
  if (String(claims.tid || '').toLowerCase() !== tenant) throw new TokenError('BAD_TENANT');

  const issuers = [`https://login.microsoftonline.com/${tenant}/v2.0`, `https://sts.windows.net/${tenant}/`];
  if (!issuers.includes(String(claims.iss || '').toLowerCase())) throw new TokenError('BAD_ISSUER');

  const audience = String(claims.aud || '');
  const audienceOk =
    audience.toLowerCase() === String(clientId).toLowerCase() ||
    new RegExp(`^api://[^/]+/${escapeRegExp(clientId)}$`, 'i').test(audience);
  if (!audienceOk) throw new TokenError('BAD_AUDIENCE');

  if (!String(claims.scp || '').split(' ').includes(REQUIRED_SCOPE)) throw new TokenError('BAD_SCOPE');

  const userDetails = claims.preferred_username || claims.upn || claims.unique_name || claims.email || null;
  if (!userDetails) throw new TokenError('NO_USER');

  const identity = ['oid', 'preferred_username', 'upn', 'unique_name', 'email']
    .filter((name) => typeof claims[name] === 'string')
    .map((name) => ({ typ: name, val: claims[name] }));
  return { identityProvider: 'teams', userDetails, claims: identity };
}

module.exports = { verifyTeamsToken, resetTokenCaches, TokenError };
