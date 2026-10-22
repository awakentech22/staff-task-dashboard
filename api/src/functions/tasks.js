'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('@azure/functions');
const { buildDashboard } = require('../lib/dashboard');
const { requireViewer } = require('../lib/auth');
const { parseRequest } = require('../lib/request');
const { resolveViewerId } = require('../lib/viewer');

const STAFF_FILE = path.join(__dirname, '..', '..', 'staff.json');
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS) > 0 ? Number(process.env.CACHE_SECONDS) : 60;
const COMPLETED_DAYS = Number(process.env.COMPLETED_DAYS) > 0 ? Number(process.env.COMPLETED_DAYS) : 14;

/** The list shown until a viewer chooses their own people. */
function loadDefaultPeople() {
  const parsed = JSON.parse(fs.readFileSync(STAFF_FILE, 'utf8'));
  return (parsed.people || [])
    .filter((person) => person && (person.userId || person.email))
    .map((person) => ({
      key: person.userId || person.email,
      name: person.name || person.email,
      email: person.email || null,
    }));
}

/**
 * GET  /api/tasks  -> tasks for the default staff list (api/staff.json)
 * POST /api/tasks  -> tasks for { people: [{ key, name }], onlyMine } (max 8 people)
 *
 * onlyMine (default true) limits results to tasks in plans the signed-in
 * viewer created. It is a view preference, not an access control.
 */
app.http('tasks', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // Sign-in is enforced by staticwebapp.config.json; the viewer list is enforced below.
  route: 'tasks',
  handler: async (request, context) => {
    const auth = requireViewer(request);
    if (!auth.ok) return auth.response;

    let people = null;
    let onlyMine = true;
    if (request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const parsed = parseRequest(body);
      if (parsed.error) return { status: 400, jsonBody: { error: parsed.error } };
      people = parsed.people;
      onlyMine = parsed.onlyMine;
    }

    try {
      let viewerId = null;
      if (onlyMine) {
        try {
          viewerId = await resolveViewerId(auth.principal);
        } catch (err) {
          context.log(`Could not resolve the viewer: ${err.message}`);
        }
      }

      const payload = await buildDashboard({
        people: people || loadDefaultPeople(),
        completedDays: COMPLETED_DAYS,
        ttlMs: CACHE_SECONDS * 1000,
        log: (message) => context.log(message),
        onlyCreatedBy: viewerId,
      });
      payload.filter = {
        onlyMine,
        applied: Boolean(onlyMine && viewerId),
        error: onlyMine && !viewerId ? 'VIEWER_UNKNOWN' : null,
      };
      return { status: 200, headers: { 'Cache-Control': 'no-store' }, jsonBody: payload };
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { error: 'Could not load tasks' } };
    }
  },
});
