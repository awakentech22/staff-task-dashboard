'use strict';

/**
 * Pure helpers that turn raw Microsoft Graph plannerTask objects into the
 * small, flat shape the dashboard needs. No network access in this file.
 */

// Planner stores priority as 0-10. The Planner UI maps ranges to four labels.
function priorityLabel(priority) {
  const p = Number.isFinite(priority) ? priority : 5;
  if (p <= 1) return 'Urgent';
  if (p <= 4) return 'Important';
  if (p <= 7) return 'Medium';
  return 'Low';
}

function statusFor(percentComplete) {
  if (percentComplete >= 100) return 'completed';
  if (percentComplete <= 0) return 'notStarted';
  return 'inProgress';
}

function shapeTask(raw, lookups = {}) {
  const percentComplete = Number.isFinite(raw.percentComplete) ? raw.percentComplete : 0;
  const priority = Number.isFinite(raw.priority) ? raw.priority : 5;
  return {
    id: raw.id,
    title: raw.title || '(untitled task)',
    planId: raw.planId || null,
    planTitle: lookups.planTitle || null,
    bucketTitle: lookups.bucketTitle || null,
    taskUrl: lookups.taskUrl || null,
    planUrl: lookups.planUrl || null,
    dueDateTime: raw.dueDateTime || null,
    startDateTime: raw.startDateTime || null,
    completedDateTime: raw.completedDateTime || null,
    percentComplete,
    status: statusFor(percentComplete),
    priority,
    priorityLabel: priorityLabel(priority),
    checklistItemCount: raw.checklistItemCount || 0,
    activeChecklistItemCount: raw.activeChecklistItemCount || 0,
    assigneeCount: raw.assignments ? Object.keys(raw.assignments).length : 0,
  };
}

/** Keep every open task, plus tasks completed within the last `days` days. */
function selectTasks(rawTasks, days, now = Date.now()) {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return rawTasks.filter((task) => {
    if (!(task.percentComplete >= 100)) return true;
    const done = Date.parse(task.completedDateTime || '');
    return Number.isFinite(done) && done >= cutoff;
  });
}

module.exports = { priorityLabel, statusFor, shapeTask, selectTasks };
