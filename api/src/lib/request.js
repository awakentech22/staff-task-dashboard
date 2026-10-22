'use strict';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s/\\?#%]+@[^@\s/\\?#%]+\.[^@\s/\\?#%]+$/;
const MAX_PEOPLE = 8;
const MAX_NAME = 100;

/**
 * Validates the optional { people: [{ key, name }] } body of POST /api/tasks.
 * A key is an Entra object ID or an email. Names are display-only labels that
 * the browser sends back; they are never used to look anything up.
 *
 * Returns { people: null } when no list was sent (nobody is selected),
 * { people: [...] } when valid, or { error } when not.
 */
function parsePeople(body) {
  if (!body || body.people === undefined || body.people === null) return { people: null };
  if (!Array.isArray(body.people)) return { error: 'BAD_REQUEST' };
  if (body.people.length === 0) return { people: null };
  if (body.people.length > MAX_PEOPLE) return { error: 'TOO_MANY_PEOPLE' };

  const seen = new Set();
  const people = [];
  for (const item of body.people) {
    const key = item && typeof item.key === 'string' ? item.key.trim() : '';
    if (!key || key.length > 254 || !(GUID.test(key) || EMAIL.test(key))) return { error: 'BAD_REQUEST' };
    const id = key.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const rawName = item && typeof item.name === 'string' ? item.name.trim() : '';
    people.push({ key, name: rawName ? rawName.slice(0, MAX_NAME) : key, email: EMAIL.test(key) ? key : null });
  }
  return { people };
}

/** Full POST body: the people list plus the "only plans I created" switch (on unless explicitly false). */
function parseRequest(body) {
  const parsed = parsePeople(body);
  if (parsed.error) return parsed;
  return { people: parsed.people, onlyMine: !(body && body.onlyMine === false) };
}

module.exports = { parsePeople, parseRequest, MAX_PEOPLE };
