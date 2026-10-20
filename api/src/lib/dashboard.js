'use strict';

const { listUserTasks, getPlanTitle, getBucketTitle } = require('./graph');
const { shapeTask, selectTasks } = require('./shape');

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Turns a thrown error into a short, safe description for the browser. */
function describeError(err) {
  if (err && err.code === 'CONFIG') return { code: 'CONFIG', message: err.message };
  if (err && err.code === 'AUTH') return { code: 'AUTH', message: err.message };
  if (err && err.status === 404) return { code: 'USER_NOT_FOUND', message: 'No Planner data found for this user' };
  if (err && err.status === 403) return { code: 'FORBIDDEN', message: 'The app is not allowed to read this user’s tasks' };
  return { code: 'UNKNOWN', message: 'Unexpected error while reading Planner' };
}

async function buildDashboard({ people, completedDays = 14, now = Date.now(), log = () => {} }) {
  const fetched = await mapLimit(people, 3, async (person) => {
    try {
      const raw = await listUserTasks(person.userId || person.email);
      return { person, selected: selectTasks(raw, completedDays, now) };
    } catch (err) {
      log(`Planner lookup failed for ${person.email}: ${err.message}`);
      return { person, error: describeError(err) };
    }
  });

  const planIds = new Set();
  const bucketIds = new Set();
  for (const entry of fetched) {
    for (const task of entry.selected || []) {
      if (task.planId) planIds.add(task.planId);
      if (task.bucketId) bucketIds.add(task.bucketId);
    }
  }

  const planTitles = new Map();
  const bucketTitles = new Map();
  await Promise.all([
    mapLimit([...planIds], 5, async (id) => planTitles.set(id, await getPlanTitle(id))),
    mapLimit([...bucketIds], 5, async (id) => bucketTitles.set(id, await getBucketTitle(id))),
  ]);

  return {
    generatedAt: new Date(now).toISOString(),
    completedDays,
    people: fetched.map(({ person, selected, error }) => ({
      name: person.name || person.email,
      email: person.email,
      error: error || null,
      tasks: (selected || []).map((task) =>
        shapeTask(task, {
          planTitle: planTitles.get(task.planId),
          bucketTitle: bucketTitles.get(task.bucketId),
        })
      ),
    })),
  };
}

module.exports = { buildDashboard, describeError, mapLimit };
