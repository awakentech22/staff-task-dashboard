'use strict';

const { app } = require('@azure/functions');
const { requireTeamsViewer } = require('../lib/auth');
const { tasksResponse } = require('../lib/handlers');

/**
 * Teams version of /api/tasks. The route is open to anonymous callers in
 * staticwebapp.config.json because Teams has no Static Web Apps cookie, so
 * requireTeamsViewer (a verified Teams token plus the viewer list) is the gate.
 */
app.http('teamsTasks', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'teams/tasks',
  handler: async (request, context) => {
    const auth = await requireTeamsViewer(request);
    if (!auth.ok) return auth.response;
    return tasksResponse(request, context, auth.principal);
  },
});
