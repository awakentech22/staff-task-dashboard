'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('@azure/functions');
const { buildDashboard } = require('../lib/dashboard');

const STAFF_FILE = path.join(__dirname, '..', '..', 'staff.json');
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS) > 0 ? Number(process.env.CACHE_SECONDS) : 60;
const COMPLETED_DAYS = Number(process.env.COMPLETED_DAYS) > 0 ? Number(process.env.COMPLETED_DAYS) : 14;

let cache = { at: 0, payload: null };
let inflight = null;

function loadPeople() {
  const parsed = JSON.parse(fs.readFileSync(STAFF_FILE, 'utf8'));
  return (parsed.people || []).filter((person) => person && person.email);
}

/** Static Web Apps forwards the signed-in user in this header. */
function callerRoles(request) {
  try {
    const header = request.headers.get('x-ms-client-principal');
    if (!header) return [];
    const principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    return Array.isArray(principal.userRoles) ? principal.userRoles : [];
  } catch (err) {
    return [];
  }
}

async function getDashboard(context) {
  if (cache.payload && Date.now() - cache.at < CACHE_SECONDS * 1000) return cache.payload;
  if (!inflight) {
    inflight = buildDashboard({
      people: loadPeople(),
      completedDays: COMPLETED_DAYS,
      log: (message) => context.log(message),
    })
      .then((payload) => {
        cache = { at: Date.now(), payload };
        return payload;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

app.http('tasks', {
  methods: ['GET'],
  authLevel: 'anonymous', // Access is enforced by staticwebapp.config.json (role "viewer").
  route: 'tasks',
  handler: async (request, context) => {
    // Belt and braces: the route rule already requires this role.
    if (!callerRoles(request).includes('viewer')) {
      return { status: 403, jsonBody: { error: 'Forbidden' } };
    }
    try {
      const payload = await getDashboard(context);
      return { status: 200, headers: { 'Cache-Control': 'no-store' }, jsonBody: payload };
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { error: 'Could not load tasks' } };
    }
  },
});
