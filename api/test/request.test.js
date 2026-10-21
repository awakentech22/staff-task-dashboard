'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePeople, MAX_PEOPLE } = require('../src/lib/request');

const guid = '123e4567-e89b-12d3-a456-426614174000';

test('no body or no list means use the default staff list', () => {
  assert.deepEqual(parsePeople(null), { people: null });
  assert.deepEqual(parsePeople({}), { people: null });
  assert.deepEqual(parsePeople({ people: [] }), { people: null });
});

test('accepts object IDs and emails, trims, labels and de-duplicates', () => {
  const { people } = parsePeople({ people: [
    { key: ` ${guid} `, name: '  Ann Lee ' },
    { key: 'Bob@x.org', name: 'Bob' },
    { key: 'bob@X.org', name: 'Bob again' },
  ] });
  assert.equal(people.length, 2);
  assert.equal(people[0].key, guid);
  assert.equal(people[0].name, 'Ann Lee');
  assert.equal(people[1].email, 'Bob@x.org');
});

test('rejects keys that are neither a GUID nor an email', () => {
  for (const key of ['../me', 'ann', 'a b@x.org', 'x@y', '', 12]) {
    assert.deepEqual(parsePeople({ people: [{ key }] }), { error: 'BAD_REQUEST' }, String(key));
  }
});

test('rejects non-array lists and oversized lists', () => {
  assert.deepEqual(parsePeople({ people: 'ann@x.org' }), { error: 'BAD_REQUEST' });
  const many = Array.from({ length: MAX_PEOPLE + 1 }, (_, i) => ({ key: `p${i}@x.org` }));
  assert.deepEqual(parsePeople({ people: many }), { error: 'TOO_MANY_PEOPLE' });
});

test('long names are cut and missing names fall back to the key', () => {
  const { people } = parsePeople({ people: [{ key: 'a@x.org', name: 'n'.repeat(500) }, { key: 'b@x.org' }] });
  assert.equal(people[0].name.length, 100);
  assert.equal(people[1].name, 'b@x.org');
});
