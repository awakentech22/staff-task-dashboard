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

async function graphGet(pathOrUrl) {
  // Only ever send the bearer token to Graph itself, including for nextLink URLs.
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`;
  if (!url.startsWith(`${GRAPH_ROOT}/`)) throw new Error('Refusing to call a non-Graph URL');

  for (let attempt = 0; ; attempt += 1) {
    const token = await getToken();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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

async function cachedName(kind, id, path, field) {
  const key = `${kind}:${id}`;
  const hit = nameCache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? NAME_TTL_MS : MISS_TTL_MS)) return hit.value;

  let value = null;
  try {
    const data = await graphGet(path);
    value = data[field] || null;
  } catch (err) {
    // A missing plan or bucket name should never take the dashboard down.
    value = null;
  }
  nameCache.set(key, { value, at: Date.now() });
  return value;
}

const getPlanTitle = (planId) => cachedName('plan', planId, `/planner/plans/${encodeURIComponent(planId)}`, 'title');
const getBucketTitle = (bucketId) => cachedName('bucket', bucketId, `/planner/buckets/${encodeURIComponent(bucketId)}`, 'name');

function resetCaches() {
  tokenCache = { value: null, expiresAt: 0 };
  tokenRequest = null;
  nameCache.clear();
}

module.exports = { listUserTasks, getPlanTitle, getBucketTitle, resetCaches };
