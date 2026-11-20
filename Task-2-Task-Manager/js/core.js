/**
 * Docket - core task logic.
 *
 * Pure functions only: no DOM, no storage. Every function that changes the
 * task list returns a new array instead of mutating the one it received,
 * which keeps the UI predictable and makes the logic easy to unit test.
 *
 * Works as a classic browser script (exposes window.TaskCore) and as a
 * CommonJS module for the Node test runner.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TaskCore = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = ['work', 'personal', 'study'];
  const PRIORITIES = ['high', 'medium', 'low'];
  const STATUSES = ['all', 'active', 'completed'];
  const SORT_MODES = ['manual', 'due', 'priority', 'newest'];
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  const TITLE_MAX = 120;
  const NOTES_MAX = 500;
  const DUE_SOON_DAYS = 3;

  class TaskValidationError extends Error {
    constructor(errors) {
      super('Task data is not valid.');
      this.name = 'TaskValidationError';
      this.errors = errors;
    }
  }

  /* ---------- Ids and dates ---------- */

  function generateId() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (c && typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
    return 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** Local calendar date as YYYY-MM-DD (no time zone shift). */
  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function isValidISODate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }

  /** Whole days from `from` to `to` (both YYYY-MM-DD). */
  function daysBetween(from, to) {
    const [y1, m1, d1] = from.split('-').map(Number);
    const [y2, m2, d2] = to.split('-').map(Number);
    const a = Date.UTC(y1, m1 - 1, d1);
    const b = Date.UTC(y2, m2 - 1, d2);
    return Math.round((b - a) / 86400000);
  }

  /* ---------- Validation ---------- */

  /**
   * Validates and cleans user input for a task.
   * Past due dates are rejected unless `allowPastDue` is set (used when an
   * existing task keeps the date it already had).
   */
  function validateTaskInput(input, options = {}) {
    const { today = toISODate(new Date()), allowPastDue = false } = options;
    const errors = {};

    const title = String(input.title == null ? '' : input.title).replace(/\s+/g, ' ').trim();
    if (!title) {
      errors.title = 'Please enter a task title.';
    } else if (title.length > TITLE_MAX) {
      errors.title = `Keep the title under ${TITLE_MAX} characters.`;
    }

    const notes = String(input.notes == null ? '' : input.notes).trim();
    if (notes.length > NOTES_MAX) {
      errors.notes = `Keep notes under ${NOTES_MAX} characters.`;
    }

    const category = input.category;
    if (!CATEGORIES.includes(category)) {
      errors.category = 'Choose a category.';
    }

    const priority = input.priority;
    if (!PRIORITIES.includes(priority)) {
      errors.priority = 'Choose a priority.';
    }

    const dueDate = input.dueDate ? String(input.dueDate) : '';
    if (dueDate) {
      if (!isValidISODate(dueDate)) {
        errors.dueDate = 'Enter a valid date.';
      } else if (!allowPastDue && dueDate < today) {
        errors.dueDate = 'The due date cannot be in the past.';
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      value: { title, notes, category, priority, dueDate: dueDate || null },
    };
  }

  /* ---------- CRUD ---------- */

  /** Create: returns the new list with the task added at the top. */
  function addTask(tasks, input, options = {}) {
    const now = options.now || new Date();
    const result = validateTaskInput(input, { today: toISODate(now) });
    if (!result.valid) {
      throw new TaskValidationError(result.errors);
    }
    const task = {
      id: options.id || generateId(),
      ...result.value,
      completed: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
    };
    return { tasks: [task, ...tasks], task };
  }

  /** Update: applies validated changes to one task. */
  function updateTask(tasks, id, changes, options = {}) {
    const now = options.now || new Date();
    const index = tasks.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new Error(`Task ${id} not found.`);
    }
    const current = tasks[index];
    const merged = { ...current, ...changes };
    const keepsOldDate = merged.dueDate === current.dueDate;
    const result = validateTaskInput(merged, {
      today: toISODate(now),
      allowPastDue: keepsOldDate,
    });
    if (!result.valid) {
      throw new TaskValidationError(result.errors);
    }
    const updated = { ...current, ...result.value, updatedAt: now.toISOString() };
    const next = tasks.slice();
    next[index] = updated;
    return next;
  }

  /** Delete: returns the new list plus what is needed to undo. */
  function deleteTask(tasks, id) {
    const index = tasks.findIndex((t) => t.id === id);
    if (index === -1) {
      return { tasks, removed: null, index: -1 };
    }
    const next = tasks.slice();
    const [removed] = next.splice(index, 1);
    return { tasks: next, removed, index };
  }

  /** Puts a deleted task back where it was. */
  function restoreTask(tasks, task, index) {
    if (!task || tasks.some((t) => t.id === task.id)) {
      return tasks;
    }
    const next = tasks.slice();
    const at = Math.max(0, Math.min(index, next.length));
    next.splice(at, 0, task);
    return next;
  }

  function toggleTask(tasks, id, options = {}) {
    const now = options.now || new Date();
    return tasks.map((t) => {
      if (t.id !== id) return t;
      const completed = !t.completed;
      return {
        ...t,
        completed,
        completedAt: completed ? now.toISOString() : null,
        updatedAt: now.toISOString(),
      };
    });
  }

  function clearCompleted(tasks) {
    const removed = [];
    const kept = [];
    tasks.forEach((t, index) => {
      if (t.completed) removed.push({ task: t, index });
      else kept.push(t);
    });
    return { tasks: kept, removed };
  }

  /** Re-inserts tasks removed by clearCompleted, at their original indexes. */
  function restoreMany(tasks, removed) {
    let next = tasks.slice();
    removed
      .slice()
      .sort((a, b) => a.index - b.index)
      .forEach(({ task, index }) => {
        next = restoreTask(next, task, index);
      });
    return next;
  }

  /* ---------- Ordering ---------- */

  /**
   * Applies a new order for a subset of tasks (the ones currently visible)
   * without disturbing hidden tasks: the visible tasks are written back into
   * the slots they already occupied, in the new order.
   */
  function reorderSubset(tasks, orderedIds) {
    const wanted = orderedIds.filter((id) => tasks.some((t) => t.id === id));
    const set = new Set(wanted);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    let cursor = 0;
    return tasks.map((t) => (set.has(t.id) ? byId.get(wanted[cursor++]) : t));
  }

  /** Moves a task one step up (-1) or down (+1) among `visibleIds`. */
  function moveWithin(tasks, visibleIds, id, delta) {
    const from = visibleIds.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= visibleIds.length) {
      return tasks;
    }
    const order = visibleIds.slice();
    order.splice(from, 1);
    order.splice(to, 0, id);
    return reorderSubset(tasks, order);
  }

  /* ---------- Reading: due state, filters, sorting, stats ---------- */

  function getDueState(task, today) {
    if (!task.dueDate) return null;
    const diff = daysBetween(today, task.dueDate);
    if (task.completed) return 'done';
    if (diff < 0) return 'overdue';
    if (diff === 0) return 'today';
    if (diff <= DUE_SOON_DAYS) return 'soon';
    return 'later';
  }

  function matchesQuery(task, query) {
    if (!query) return true;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = `${task.title} ${task.notes || ''} ${task.category} ${task.priority}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  function filterTasks(tasks, filters = {}) {
    const { status = 'all', category = 'all', query = '' } = filters;
    const q = String(query).trim();
    return tasks.filter((t) => {
      if (status === 'active' && t.completed) return false;
      if (status === 'completed' && !t.completed) return false;
      if (category !== 'all' && t.category !== category) return false;
      return matchesQuery(t, q);
    });
  }

  /** Returns a sorted copy. "manual" keeps the user's drag-and-drop order. */
  function sortTasks(tasks, mode = 'manual') {
    const list = tasks.slice();
    const position = new Map(tasks.map((t, i) => [t.id, i]));
    const byPosition = (a, b) => position.get(a.id) - position.get(b.id);

    if (mode === 'due') {
      list.sort((a, b) => {
        if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
          return a.dueDate < b.dueDate ? -1 : 1;
        }
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        return byPosition(a, b);
      });
    } else if (mode === 'priority') {
      list.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byPosition(a, b));
    } else if (mode === 'newest') {
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : byPosition(a, b)));
    }
    return list;
  }

  function getStats(tasks, today) {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.completed).length;
    const active = total - completed;
    const overdue = tasks.filter((t) => getDueState(t, today) === 'overdue').length;
    const dueToday = tasks.filter((t) => getDueState(t, today) === 'today').length;
    const completionRate = total === 0 ? 0 : Math.round((completed / total) * 100);
    const byCategory = {};
    CATEGORIES.forEach((c) => {
      byCategory[c] = tasks.filter((t) => t.category === c).length;
    });
    return { total, active, completed, overdue, dueToday, completionRate, byCategory };
  }

  /* ---------- Loading and import ---------- */

  /**
   * Turns unknown data (from storage or an imported file) into a clean task,
   * or returns null when it cannot be trusted.
   */
  function normalizeTask(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : '';
    if (!title) return null;
    const category = String(raw.category || '').toLowerCase();
    const priority = String(raw.priority || '').toLowerCase();
    const created = typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt))
      ? raw.createdAt
      : new Date().toISOString();
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
      title,
      notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, NOTES_MAX) : '',
      category: CATEGORIES.includes(category) ? category : 'personal',
      priority: PRIORITIES.includes(priority) ? priority : 'medium',
      dueDate: isValidISODate(raw.dueDate) ? raw.dueDate : null,
      completed: raw.completed === true,
      createdAt: created,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : created,
      completedAt: raw.completed === true && typeof raw.completedAt === 'string' ? raw.completedAt : null,
    };
  }

  /** Cleans a list and drops duplicates by id. */
  function normalizeTasks(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    list.forEach((raw) => {
      const task = normalizeTask(raw);
      if (!task) return;
      if (seen.has(task.id)) task.id = generateId();
      seen.add(task.id);
      out.push(task);
    });
    return out;
  }

  /** Reads an exported backup. Accepts { tasks: [...] } or a bare array. */
  function parseBackup(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('This file is not valid JSON.');
    }
    const list = Array.isArray(data) ? data : data && Array.isArray(data.tasks) ? data.tasks : null;
    if (!list) {
      throw new Error('No task list was found in this file.');
    }
    return normalizeTasks(list);
  }

  function createBackup(tasks, now = new Date()) {
    return JSON.stringify({ app: 'docket', version: 1, exportedAt: now.toISOString(), tasks }, null, 2);
  }

  return {
    CATEGORIES,
    PRIORITIES,
    STATUSES,
    SORT_MODES,
    TITLE_MAX,
    NOTES_MAX,
    TaskValidationError,
    generateId,
    toISODate,
    isValidISODate,
    daysBetween,
    validateTaskInput,
    addTask,
    updateTask,
    deleteTask,
    restoreTask,
    toggleTask,
    clearCompleted,
    restoreMany,
    reorderSubset,
    moveWithin,
    getDueState,
    filterTasks,
    sortTasks,
    getStats,
    normalizeTask,
    normalizeTasks,
    parseBackup,
    createBackup,
  };
});
