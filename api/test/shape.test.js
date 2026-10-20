'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { priorityLabel, shapeTask, selectTasks } = require('../src/lib/shape');

test('priority ranges match Planner labels', () => {
  assert.equal(priorityLabel(0), 'Urgent');
  assert.equal(priorityLabel(1), 'Urgent');
  assert.equal(priorityLabel(3), 'Important');
  assert.equal(priorityLabel(5), 'Medium');
  assert.equal(priorityLabel(9), 'Low');
  assert.equal(priorityLabel(undefined), 'Medium');
});

test('shapeTask derives status and flattens fields', () => {
  const task = shapeTask(
    { id: 't1', title: 'Order banners', planId: 'p1', percentComplete: 50, priority: 1, assignments: { a: {}, b: {} } },
    { planTitle: 'Events', bucketTitle: 'Print' }
  );
  assert.equal(task.status, 'inProgress');
  assert.equal(task.priorityLabel, 'Urgent');
  assert.equal(task.assigneeCount, 2);
  assert.equal(task.planTitle, 'Events');
  assert.equal(task.bucketTitle, 'Print');
});

test('selectTasks keeps open tasks and recently completed ones only', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const tasks = [
    { id: 'open', percentComplete: 0 },
    { id: 'recent', percentComplete: 100, completedDateTime: '2026-10-15T00:00:00Z' },
    { id: 'old', percentComplete: 100, completedDateTime: '2026-08-01T00:00:00Z' },
    { id: 'nodate', percentComplete: 100 },
  ];
  assert.deepEqual(selectTasks(tasks, 14, now).map((t) => t.id), ['open', 'recent']);
});
