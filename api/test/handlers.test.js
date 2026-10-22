'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GRAPH_TENANT_ID = 'tenant';
process.env.GRAPH_CLIENT_ID = 'client';
process.env.GRAPH_CLIENT_SECRET = 'secret';

const { tasksResponse } = require('../src/lib/handlers');

const context = { log() {}, error() {} };
const post = (body) => ({ method: 'POST', json: async () => body });

test('with nobody chosen the answer is an empty list and Planner is never called', async () => {
  global.fetch = async () => { throw new Error('no network call expected'); };
  for (const request of [{ method: 'GET' }, post(null), post({}), post({ people: null }), post({ people: [] })]) {
    const result = await tasksResponse(request, context, { userDetails: 'a@x.org', claims: [] });
    assert.equal(result.status, 200);
    assert.deepEqual(result.jsonBody.people, []);
    assert.equal(result.jsonBody.filter.applied, false);
  }
});

test('an invalid list is still rejected', async () => {
  const result = await tasksResponse(post({ people: [{ key: 'not valid' }] }), context, { userDetails: 'a@x.org', claims: [] });
  assert.equal(result.status, 400);
});

test('onlyMine is reported back when nobody is chosen', async () => {
  const result = await tasksResponse(post({ people: [], onlyMine: false }), context, { userDetails: 'a@x.org', claims: [] });
  assert.equal(result.jsonBody.filter.onlyMine, false);
});
