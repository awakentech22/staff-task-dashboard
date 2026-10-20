'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isViewer, parseList } = require('../src/lib/roles');

const principal = (userDetails, claims = []) => ({ userDetails, claims });

test('parseList handles commas, semicolons, spacing and case', () => {
  assert.deepEqual([...parseList(' A@x.org; b@x.org,\nC@x.org ')], ['a@x.org', 'b@x.org', 'c@x.org']);
});

test('matches on userDetails', () => {
  assert.equal(isViewer(principal('Tony@Awakenlv.org'), 'tony@awakenlv.org'), true);
});

test('matches on preferred_username claim', () => {
  const claims = [{ typ: 'preferred_username', val: 'tony@awakenlv.org' }];
  assert.equal(isViewer(principal('Tony Smith', claims), 'tony@awakenlv.org'), true);
});

test('matches on the long-form emailaddress claim type', () => {
  const claims = [{ typ: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', val: 'tony@awakenlv.org' }];
  assert.equal(isViewer(principal('Tony Smith', claims), 'tony@awakenlv.org'), true);
});

test('display name alone never matches', () => {
  const claims = [{ typ: 'name', val: 'tony@awakenlv.org' }];
  assert.equal(isViewer(principal('Tony Smith', claims), 'tony@awakenlv.org'), false);
});

test('empty allowlist denies everyone', () => {
  assert.equal(isViewer(principal('tony@awakenlv.org'), ''), false);
  assert.equal(isViewer(principal('tony@awakenlv.org'), undefined), false);
});

test('someone else is denied', () => {
  assert.equal(isViewer(principal('other@awakenlv.org'), 'tony@awakenlv.org'), false);
});
