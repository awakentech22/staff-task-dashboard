'use strict';

const { app } = require('@azure/functions');
const { requireTeamsViewer } = require('../lib/auth');
const { peopleResponse } = require('../lib/handlers');

/** Teams version of /api/people. Same token-only gate as teamsTasks. */
app.http('teamsPeople', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'teams/people',
  handler: async (request, context) => {
    const auth = await requireTeamsViewer(request);
    if (!auth.ok) return auth.response;
    return peopleResponse(request, context);
  },
});
