'use strict';

const { buildDashboard } = require('./dashboard');
const { parseRequest } = require('./request');
const { resolveViewerId } = require('./viewer');
const { searchUsers } = require('./graph');

function settings() {
  const cacheSeconds = Number(process.env.CACHE_SECONDS) > 0 ? Number(process.env.CACHE_SECONDS) : 60;
  const completedDays = Number(process.env.COMPLETED_DAYS) > 0 ? Number(process.env.COMPLETED_DAYS) : 14;
  return { cacheSeconds, completedDays };
}

/**
 * Shared by /api/tasks (browser) and /api/teams/tasks (Teams). The caller has
 * already been authenticated and checked against the viewer list.
 *
 * There is no default list: the viewer chooses the people. With no people
 * chosen the answer is an empty list, and nothing is read from Planner.
 *
 * POST -> { people: [{ key, name }], onlyMine } (max 8 people)
 * GET  -> an empty list
 */
async function tasksResponse(request, context, principal) {
  let people = null;
  let onlyMine = true;
  if (request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const parsed = parseRequest(body);
    if (parsed.error) return { status: 400, jsonBody: { error: parsed.error } };
    people = parsed.people;
    onlyMine = parsed.onlyMine;
  }

  const { cacheSeconds, completedDays } = settings();
  if (!people || people.length === 0) {
    return {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
      jsonBody: {
        generatedAt: new Date().toISOString(),
        completedDays,
        people: [],
        filter: { onlyMine, applied: false, error: null },
      },
    };
  }

  try {
    let viewerId = null;
    if (onlyMine) {
      try {
        viewerId = await resolveViewerId(principal);
      } catch (err) {
        context.log(`Could not resolve the viewer: ${err.message}`);
      }
    }

    const payload = await buildDashboard({
      people,
      completedDays,
      ttlMs: cacheSeconds * 1000,
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
}

/** Directory search for the people picker. */
async function peopleResponse(request, context) {
  const term = (request.query.get('q') || '').trim();
  if (term.length < 2 || term.length > 64) return { status: 200, jsonBody: { results: [] } };

  try {
    const results = await searchUsers(term);
    return { status: 200, headers: { 'Cache-Control': 'no-store' }, jsonBody: { results } };
  } catch (err) {
    context.error(err);
    const forbidden = err && (err.status === 401 || err.status === 403 || err.code === 'AUTH' || err.code === 'CONFIG');
    return { status: 502, jsonBody: { error: forbidden ? 'GRAPH_FORBIDDEN' : 'SEARCH_FAILED' } };
  }
}

module.exports = { tasksResponse, peopleResponse };
