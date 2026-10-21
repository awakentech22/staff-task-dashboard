'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GRAPH_TENANT_ID = 'tenant';
process.env.GRAPH_CLIENT_ID = 'client';
process.env.GRAPH_CLIENT_SECRET = 'secret';

const { searchUsers, buildUserSearch, resetCaches } = require('../src/lib/graph');

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body };
}

test('single word searches name, mail and sign-in name', () => {
  assert.equal(buildUserSearch('dan'), '"displayName:dan" OR "mail:dan" OR "userPrincipalName:dan"');
});

test('several words must all match the display name', () => {
  assert.equal(buildUserSearch('daniel bar'), '"displayName:daniel" AND "displayName:bar"');
});

test('quotes and odd characters are stripped from the search', () => {
  assert.equal(buildUserSearch('a"b)c'), '"displayName:abc" OR "mail:abc" OR "userPrincipalName:abc"');
  assert.equal(buildUserSearch('"" ()'), null);
});

test('searchUsers sends the consistency header and tidies results', async () => {
  resetCaches();
  let seen;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/oauth2/v2.0/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    seen = { url: String(url), headers: options.headers };
    return json(200, { value: [
      { id: '1', displayName: 'Ann Lee', mail: 'ann@x.org', userPrincipalName: 'ann@x.org', jobTitle: 'Pastor' },
      { id: '2', displayName: 'Guest', mail: 'g@y.com', userPrincipalName: 'g_y.com#EXT#@x.onmicrosoft.com' },
      { id: '3', displayName: 'No address' },
    ] });
  };
  const results = await searchUsers('ann');
  assert.equal(seen.headers.ConsistencyLevel, 'eventual');
  assert.ok(seen.url.includes('$search='));
  assert.deepEqual(results, [{ key: '1', name: 'Ann Lee', email: 'ann@x.org', title: 'Pastor' }]);
});
