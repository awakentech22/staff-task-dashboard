'use strict';

const { app } = require('@azure/functions');
const { requireViewer } = require('../lib/auth');
const { searchUsers } = require('../lib/graph');

/** GET /api/people?q=term -> up to 10 matching people from the directory. */
app.http('people', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'people',
  handler: async (request, context) => {
    const auth = requireViewer(request);
    if (!auth.ok) return auth.response;

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
  },
});
