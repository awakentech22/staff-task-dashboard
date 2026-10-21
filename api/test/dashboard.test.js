'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GRAPH_TENANT_ID = 'tenant';
process.env.GRAPH_CLIENT_ID = 'client';
process.env.GRAPH_CLIENT_SECRET = 'secret';

const { buildDashboard, clearPersonCache } = require('../src/lib/dashboard');
const { resetCaches } = require('../src/lib/graph');

function json(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] || null }, json: async () => body };
}

test('builds per-person results, enriches names, isolates failures', async () => {
  resetCaches();
  clearPersonCache();
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).includes('/oauth2/v2.0/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    assert.equal(options.headers.Authorization, 'Bearer tok');
    if (url.includes('/users/ann%40x.org/planner/tasks')) {
      return json(200, {
        value: [
          { id: 't1', title: 'Open task', planId: 'p1', bucketId: 'b1', percentComplete: 0, priority: 1, dueDateTime: '2026-10-21T07:00:00Z' },
          { id: 't2', title: 'Old done', planId: 'p1', bucketId: 'b1', percentComplete: 100, completedDateTime: '2026-01-01T00:00:00Z' },
        ],
      });
    }
    if (url.includes('/users/nobody%40x.org/planner/tasks')) return json(404, {});
    if (url.endsWith('/planner/plans/p1')) return json(200, { title: 'Events' });
    if (url.endsWith('/planner/buckets/b1')) return json(200, { name: 'Print' });
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await buildDashboard({
    people: [{ key: 'ann@x.org', name: 'Ann', email: 'ann@x.org' }, { key: 'nobody@x.org', name: 'Nobody', email: 'nobody@x.org' }],
    completedDays: 14,
    now: Date.parse('2026-10-20T12:00:00Z'),
  });

  assert.equal(result.people.length, 2);
  const ann = result.people[0];
  assert.equal(ann.error, null);
  assert.equal(ann.tasks.length, 1);
  assert.equal(ann.tasks[0].planTitle, 'Events');
  assert.equal(ann.tasks[0].bucketTitle, 'Print');
  assert.equal(ann.tasks[0].priorityLabel, 'Urgent');
  assert.equal(result.people[1].error.code, 'USER_NOT_FOUND');
  assert.equal(result.people[1].tasks.length, 0);
  assert.equal(calls.filter((u) => u.includes('/oauth2/')).length, 1, 'token is cached');
});

test('missing settings surface as a CONFIG error per person', async () => {
  resetCaches();
  clearPersonCache();
  const saved = process.env.GRAPH_CLIENT_SECRET;
  delete process.env.GRAPH_CLIENT_SECRET;
  global.fetch = async () => { throw new Error('should not be called'); };
  const result = await buildDashboard({ people: [{ key: 'ann@x.org', name: 'Ann', email: 'ann@x.org' }] });
  assert.equal(result.people[0].error.code, 'CONFIG');
  assert.match(result.people[0].error.message, /GRAPH_CLIENT_SECRET/);
  process.env.GRAPH_CLIENT_SECRET = saved;
});

test('never sends the bearer token to a non-Graph nextLink', async () => {
  resetCaches();
  clearPersonCache();
  global.fetch = async (url) => {
    if (String(url).includes('/oauth2/v2.0/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    return json(200, { value: [], '@odata.nextLink': 'https://evil.example.com/steal' });
  };
  const result = await buildDashboard({ people: [{ key: 'ann@x.org', name: 'Ann', email: 'ann@x.org' }] });
  assert.equal(result.people[0].error.code, 'UNKNOWN');
});

test('per-person results are cached between requests', async () => {
  resetCaches();
  clearPersonCache();
  let taskCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes('/oauth2/v2.0/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.includes('/planner/tasks')) { taskCalls += 1; return json(200, { value: [] }); }
    throw new Error(`Unexpected URL ${url}`);
  };
  const people = [{ key: 'ann@x.org', name: 'Ann', email: 'ann@x.org' }];
  await buildDashboard({ people, ttlMs: 60000 });
  await buildDashboard({ people, ttlMs: 60000 });
  assert.equal(taskCalls, 1);
});
