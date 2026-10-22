'use strict';

/**
 * Minimal Microsoft Graph client using the app-only (client credentials) flow.
 * Node 20 provides a global fetch, so there are no runtime dependencies.
 */

const GRAPH_ROOT = 'https://graph.microsoft.com';
const GRAPH_BASE = `${GRAPH_ROOT}/v1.0`;
const TOKEN_SKEW_MS = 60 * 1000;
const NAME_TTL_MS = 10 * 60 * 1000;
const MISS_TTL_MS = 60 * 1000;
const MAX_PAGES = 10;

let tokenCache = { value: null, expiresAt: 0 };
let tokenRequest = null;
const nameCache = new Map();

function configError(message) {
  const err = new Error(message);
  err.code = 'CONFIG';
  return err;
}

function requireSettings() {
  const names = ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET'];
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw configError(`Missing app settings: ${missing.join(', ')}`);
}

async function getToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt - TOKEN_SKEW_MS) return tokenCache.value;
  // Share one in-flight request so parallel Graph calls do not each fetch a token.
  if (!tokenRequest) {
    tokenRequest = requestToken().finally(() => {
      tokenRequest = null;
    });
  }
  return tokenRequest;
}

async function requestToken() {
  requireSettings();

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(process.env.GRAPH_TENANT_ID)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GRAPH_CLIENT_ID,
        client_secret: process.env.GRAPH_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    }
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const aadsts = /AADSTS\d+/.exec(json.error_description || '');
    const err = new Error(`Token request failed (${response.status}${aadsts ? `, ${aadsts[0]}` : ''})`);
    err.code = 'AUTH';
    err.status = response.status;
    throw err;
  }
  tokenCache = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return tokenCache.value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphGet(pathOrUrl, extraHeaders = {}) {
  // Only ever send the bearer token to Graph itself, including for nextLink URLs.
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`;
  if (!url.startsWith(`${GRAPH_ROOT}/`)) throw new Error('Refusing to call a non-Graph URL');

  for (let attempt = 0; ; attempt += 1) {
    const token = await getToken();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...extraHeaders } });
    if (response.ok) return response.json();

    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after')) || 1;
      await sleep(Math.min(retryAfter, 5) * 1000);
      continue;
    }
    const err = new Error(`Graph request failed (${response.status})`);
    err.status = response.status;
    throw err;
  }
}

/** All Planner tasks assigned to one user, across every plan. */
async function listUserTasks(userKey) {
  const tasks = [];
  let next = `/users/${encodeURIComponent(userKey)}/planner/tasks`;
  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    const data = await graphGet(next);
    tasks.push(...(data.value || []));
    next = data['@odata.nextLink'] || null;
  }
  return tasks;
}

async function cachedLookup(kind, id, path, pick) {
  const key = `${kind}:${id}`;
  const hit = nameCache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? NAME_TTL_MS : MISS_TTL_MS)) return hit.value;

  let value = null;
  try {
    value = pick(await graphGet(path)) || null;
  } catch (err) {
    // A missing name or lookup should never take the dashboard down.
    value = null;
  }
  nameCache.set(key, { value, at: Date.now() });
  return value;
}

/**
 * Finds people in the directory by name or email. Needs the User.Read.All
 * application permission. Directory search requires ConsistencyLevel: eventual.
 */
function buildUserSearch(term) {
  const tokens = String(term)
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}@._'-]/gu, ''))
    .filter(Boolean)
    .slice(0, 4);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) {
    const t = tokens[0];
    return `"displayName:${t}" OR "mail:${t}" OR "userPrincipalName:${t}"`;
  }
  return tokens.map((t) => `"displayName:${t}"`).join(' AND ');
}

async function searchUsers(term) {
  const search = buildUserSearch(term);
  if (!search) return [];
  const query = `$search=${encodeURIComponent(search)}&$select=id,displayName,mail,userPrincipalName,jobTitle&$top=10&$count=true`;
  const data = await graphGet(`/users?${query}`, { ConsistencyLevel: 'eventual' });
  return (data.value || [])
    .filter((user) => user.id && (user.mail || user.userPrincipalName) && !String(user.userPrincipalName || '').includes('#EXT#'))
    .map((user) => ({
      key: user.id,
      name: user.displayName || user.mail || user.userPrincipalName,
      email: user.mail || user.userPrincipalName,
      title: user.jobTitle || null,
    }));
}

/** A plan's title and the Entra object ID of the person who created it (null if created by an app). */
const getPlanInfo = (planId) =>
  cachedLookup('plan', planId, `/planner/plans/${encodeURIComponent(planId)}`, (data) => ({
    title: data.title || null,
    createdById: (data.createdBy && data.createdBy.user && data.createdBy.user.id) || null,
  }));

const getBucketTitle = (bucketId) =>
  cachedLookup('bucket', bucketId, `/planner/buckets/${encodeURIComponent(bucketId)}`, (data) => data.name);

/** Entra object ID for an email or sign-in name. Needs User.Read.All. */
const getUserId = (userKey) =>
  cachedLookup('uid', String(userKey).toLowerCase(), `/users/${encodeURIComponent(userKey)}?$select=id`, (data) => data.id);

function resetCaches() {
  tokenCache = { value: null, expiresAt: 0 };
  tokenRequest = null;
  nameCache.clear();
}

module.exports = { listUserTasks, getPlanInfo, getBucketTitle, getUserId, searchUsers, buildUserSearch, resetCaches };
