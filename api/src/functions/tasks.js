'use strict';

const { app } = require('@azure/functions');
const { requireViewer } = require('../lib/auth');
const { tasksResponse } = require('../lib/handlers');

/**
 * Browser version. Static Web Apps has already required a signed-in user; the
 * viewer list is enforced here. Teams uses /api/teams/tasks instead.
 */
app.http('tasks', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'tasks',
  handler: async (request, context) => {
    const auth = requireViewer(request);
    if (!auth.ok) return auth.response;
    return tasksResponse(request, context, auth.principal);
  },
});
