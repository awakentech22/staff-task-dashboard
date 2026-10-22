'use strict';

const { listUserTasks, getPlanInfo, getBucketTitle } = require('./graph');
const { shapeTask, selectTasks } = require('./shape');

const MAX_CACHE_ENTRIES = 200;
const personCache = new Map(); // lowercased key -> { at, promise }

function clearPersonCache() {
  personCache.clear();
}

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

function pruneCache(ttlMs) {
  if (personCache.size <= MAX_CACHE_ENTRIES) return;
  for (const [key, entry] of personCache) {
    if (Date.now() - entry.at >= ttlMs) personCache.delete(key);
  }
}

/** One person's selected tasks, shared between concurrent requests for ttlMs. */
function loadPerson(person, { completedDays, now, ttlMs, log }) {
  const cacheKey = person.key.toLowerCase();
  const hit = personCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise;

  const promise = listUserTasks(person.key)
    .then((raw) => ({ selected: selectTasks(raw, completedDays, now) }))
    .catch((err) => {
      log(`Planner lookup failed for ${person.email || person.key}: ${err.message}`);
      return { error: describeError(err) };
    });
  personCache.set(cacheKey, { at: Date.now(), promise });
  pruneCache(ttlMs);
  return promise;
}

/**
 * people: [{ key, name, email? }] where key is an Entra object ID or an email.
 * onlyCreatedBy: when set (an Entra object ID), only tasks in plans created by
 * that person are returned. Tasks in other plans, or in plans whose creator
 * cannot be determined, are left out and counted in hiddenCount.
 */
async function buildDashboard({ people, completedDays = 14, now = Date.now(), ttlMs = 0, log = () => {}, onlyCreatedBy = null }) {
  const fetched = await mapLimit(people, 3, async (person) => ({
    person,
    ...(await loadPerson(person, { completedDays, now, ttlMs, log })),
  }));

  const planIds = new Set();
  const bucketIds = new Set();
  for (const entry of fetched) {
    for (const task of entry.selected || []) {
      if (task.planId) planIds.add(task.planId);
      if (task.bucketId) bucketIds.add(task.bucketId);
    }
  }

  const planInfos = new Map();
  const bucketTitles = new Map();
  await Promise.all([
    mapLimit([...planIds], 5, async (id) => planInfos.set(id, await getPlanInfo(id))),
    mapLimit([...bucketIds], 5, async (id) => bucketTitles.set(id, await getBucketTitle(id))),
  ]);

  return {
    generatedAt: new Date(now).toISOString(),
    completedDays,
    people: fetched.map(({ person, selected, error }) => {
      const all = selected || [];
      const wanted = onlyCreatedBy ? onlyCreatedBy.toLowerCase() : null;
      const visible = wanted
        ? all.filter((task) => {
            const info = planInfos.get(task.planId);
            return Boolean(info && info.createdById && info.createdById.toLowerCase() === wanted);
          })
        : all;
      const hiddenCount = all.filter((t) => !(t.percentComplete >= 100)).length
        - visible.filter((t) => !(t.percentComplete >= 100)).length;
      return {
        key: person.key,
        name: person.name || person.email || person.key,
        email: person.email || null,
        error: error || null,
        hiddenCount,
        tasks: visible.map((task) => {
          const info = planInfos.get(task.planId);
          return shapeTask(task, {
            planTitle: info && info.title,
            bucketTitle: bucketTitles.get(task.bucketId),
          });
        }),
      };
    }),
  };
}

module.exports = { buildDashboard, describeError, mapLimit, clearPersonCache };
