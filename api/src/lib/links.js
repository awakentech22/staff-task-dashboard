'use strict';

/**
 * Builds the Planner web links for a task and its plan.
 *
 * The plan format comes from a real Planner link:
 *   https://planner.cloud.microsoft/ui/web/plan/<planId>/view/board?tid=<tenantId>
 * The task format extends the same scheme with /task/<taskId>. If Microsoft
 * changes either, set PLANNER_TASK_URL_TEMPLATE / PLANNER_PLAN_URL_TEMPLATE
 * (use "none" to turn links off). Placeholders: {planId} {taskId} {tenantId}.
 */

const DEFAULT_TASK_TEMPLATE = 'https://planner.cloud.microsoft/ui/web/plan/{planId}/view/board/task/{taskId}?tid={tenantId}';
const DEFAULT_PLAN_TEMPLATE = 'https://planner.cloud.microsoft/ui/web/plan/{planId}/view/board?tid={tenantId}';

function templateFrom(value, fallback) {
  if (value === undefined) return fallback;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'none') return null;
  return trimmed;
}

function fill(template, values) {
  if (!template) return null;
  let missing = false;
  const url = template.replace(/\{(planId|taskId|tenantId)\}/g, (_, name) => {
    if (!values[name]) missing = true;
    return encodeURIComponent(values[name] || '');
  });
  if (missing || !url.startsWith('https://')) return null;
  return url;
}

function buildLinks(task, env = process.env) {
  const values = { planId: task.planId, taskId: task.id, tenantId: env.GRAPH_TENANT_ID };
  return {
    taskUrl: fill(templateFrom(env.PLANNER_TASK_URL_TEMPLATE, DEFAULT_TASK_TEMPLATE), values),
    planUrl: fill(templateFrom(env.PLANNER_PLAN_URL_TEMPLATE, DEFAULT_PLAN_TEMPLATE), values),
  };
}

module.exports = { buildLinks, DEFAULT_TASK_TEMPLATE, DEFAULT_PLAN_TEMPLATE };
