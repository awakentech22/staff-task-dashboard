'use strict';

const { app } = require('@azure/functions');
const { isViewer } = require('../lib/roles');

/**
 * Called by Static Web Apps after sign-in (auth.rolesSource in
 * staticwebapp.config.json). Returns the roles to attach to the session.
 * People not listed in VIEWER_EMAILS get no roles, so every route that
 * requires "viewer" is closed to them.
 */
app.http('GetRoles', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'GetRoles',
  handler: async (request) => {
    let principal = {};
    try {
      principal = await request.json();
    } catch (err) {
      principal = {};
    }
    const roles = isViewer(principal, process.env.VIEWER_EMAILS) ? ['viewer'] : [];
    return { status: 200, jsonBody: { roles } };
  },
});
