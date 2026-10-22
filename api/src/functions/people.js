'use strict';

const { app } = require('@azure/functions');
const { requireViewer } = require('../lib/auth');
const { peopleResponse } = require('../lib/handlers');

/** GET /api/people?q=term -> up to 10 matching people from the directory. */
app.http('people', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'people',
  handler: async (request, context) => {
    const auth = requireViewer(request);
    if (!auth.ok) return auth.response;
    return peopleResponse(request, context);
  },
});
