'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');

const NOW = new Date(2026, 10, 20, 9, 0, 0); // 20 Nov 2026, local time
const TODAY = '2026-11-20';

function sample(overrides = {}) {
  return {
    title: 'Write report',
    notes: '',
    category: 'work',
    priority: 'medium',
    dueDate: '',
    ...overrides,
  };
}

function build(list) {
  let tasks = [];
  list.slice().reverse().forEach((item, i) => {
    tasks = Core.addTask(tasks, sample(item), { now: new Date(NOW.getTime() + i * 1000), id: item.id }).tasks;
  });
  return tasks;
}

test('toISODate uses the local calendar date', () => {
  assert.equal(Core.toISODate(NOW), TODAY);
});

test('isValidISODate rejects impossible dates', () => {
  assert.equal(Core.isValidISODate('2026-02-28'), true);
  assert.equal(Core.isValidISODate('2026-02-30'), false);
  assert.equal(Core.isValidISODate('20-11-2026'), false);
  assert.equal(Core.isValidISODate(''), false);
});

test('validateTaskInput trims the title and requires it', () => {
  const ok = Core.validateTaskInput(sample({ title: '   Call   the bank  ' }), { today: TODAY });
  assert.equal(ok.valid, true);
  assert.equal(ok.value.title, 'Call the bank');

  const empty = Core.validateTaskInput(sample({ title: '    ' }), { today: TODAY });
  assert.equal(empty.valid, false);
  assert.match(empty.errors.title, /title/i);
});

test('validateTaskInput enforces limits, category and priority', () => {
  const r = Core.validateTaskInput(
    sample({ title: 'x'.repeat(Core.TITLE_MAX + 1), notes: 'y'.repeat(Core.NOTES_MAX + 1), category: 'misc', priority: 'urgent' }),
    { today: TODAY }
  );
  assert.equal(r.valid, false);
  assert.ok(r.errors.title);
  assert.ok(r.errors.notes);
  assert.ok(r.errors.category);
  assert.ok(r.errors.priority);
});

test('validateTaskInput blocks past due dates unless allowed', () => {
  assert.equal(Core.validateTaskInput(sample({ dueDate: '2026-11-19' }), { today: TODAY }).valid, false);
  assert.equal(Core.validateTaskInput(sample({ dueDate: TODAY }), { today: TODAY }).valid, true);
  assert.equal(
    Core.validateTaskInput(sample({ dueDate: '2026-11-19' }), { today: TODAY, allowPastDue: true }).valid,
    true
  );
  assert.equal(Core.validateTaskInput(sample({ dueDate: '2026-13-01' }), { today: TODAY }).valid, false);
});

test('addTask creates a task at the top without mutating the input', () => {
  const start = build([{ id: 'a', title: 'First' }]);
  const frozen = Object.freeze(start.slice());
  const { tasks, task } = Core.addTask(frozen, sample({ title: 'Second' }), { now: NOW, id: 'b' });
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, 'b');
  assert.equal(task.completed, false);
  assert.equal(task.dueDate, null);
  assert.equal(frozen.length, 1);
});

test('addTask throws a TaskValidationError for bad input', () => {
  assert.throws(
    () => Core.addTask([], sample({ title: '' }), { now: NOW }),
    (err) => err instanceof Core.TaskValidationError && Boolean(err.errors.title)
  );
});

test('updateTask edits fields and keeps an existing past date', () => {
  let tasks = [
    {
      id: 'old',
      title: 'Old task',
      notes: '',
      category: 'study',
      priority: 'low',
      dueDate: '2026-11-01',
      completed: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      completedAt: null,
    },
  ];
  tasks = Core.updateTask(tasks, 'old', { title: 'Renamed', priority: 'high' }, { now: NOW });
  assert.equal(tasks[0].title, 'Renamed');
  assert.equal(tasks[0].priority, 'high');
  assert.equal(tasks[0].dueDate, '2026-11-01');

  assert.throws(() => Core.updateTask(tasks, 'old', { dueDate: '2026-11-02' }, { now: NOW }), Core.TaskValidationError);
  assert.throws(() => Core.updateTask(tasks, 'missing', { title: 'x' }, { now: NOW }), /not found/);
});

test('updateTask can remove a due date', () => {
  const tasks = build([{ id: 'a', dueDate: '2026-12-01' }]);
  const next = Core.updateTask(tasks, 'a', { dueDate: null }, { now: NOW });
  assert.equal(next[0].dueDate, null);
});

test('toggleTask flips completion and records the time', () => {
  const tasks = build([{ id: 'a' }]);
  const done = Core.toggleTask(tasks, 'a', { now: NOW });
  assert.equal(done[0].completed, true);
  assert.equal(done[0].completedAt, NOW.toISOString());
  const undone = Core.toggleTask(done, 'a', { now: NOW });
  assert.equal(undone[0].completed, false);
  assert.equal(undone[0].completedAt, null);
});

test('deleteTask and restoreTask round-trip at the same position', () => {
  const tasks = build([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  const { tasks: after, removed, index } = Core.deleteTask(tasks, 'b');
  assert.deepEqual(after.map((t) => t.id), ['a', 'c']);
  assert.equal(index, 1);
  const restored = Core.restoreTask(after, removed, index);
  assert.deepEqual(restored.map((t) => t.id), ['a', 'b', 'c']);
  // Restoring twice does not duplicate.
  assert.equal(Core.restoreTask(restored, removed, index).length, 3);
  // Unknown id is a no-op.
  assert.equal(Core.deleteTask(tasks, 'zzz').removed, null);
});

test('clearCompleted removes done tasks and restoreMany puts them back', () => {
  let tasks = build([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
  tasks = Core.toggleTask(Core.toggleTask(tasks, 'b', { now: NOW }), 'd', { now: NOW });
  const { tasks: kept, removed } = Core.clearCompleted(tasks);
  assert.deepEqual(kept.map((t) => t.id), ['a', 'c']);
  assert.equal(removed.length, 2);
  assert.deepEqual(Core.restoreMany(kept, removed).map((t) => t.id), ['a', 'b', 'c', 'd']);
});

test('reorderSubset reorders visible tasks and leaves hidden ones in place', () => {
  const tasks = build([{ id: 'a' }, { id: 'h1' }, { id: 'b' }, { id: 'h2' }, { id: 'c' }]);
  const next = Core.reorderSubset(tasks, ['c', 'a', 'b']);
  assert.deepEqual(next.map((t) => t.id), ['c', 'h1', 'a', 'h2', 'b']);
});

test('moveWithin moves one step and ignores moves past the edges', () => {
  const tasks = build([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(Core.moveWithin(tasks, ids, 'c', -1).map((t) => t.id), ['a', 'c', 'b']);
  assert.deepEqual(Core.moveWithin(tasks, ids, 'a', 1).map((t) => t.id), ['b', 'a', 'c']);
  assert.equal(Core.moveWithin(tasks, ids, 'a', -1), tasks);
  assert.equal(Core.moveWithin(tasks, ids, 'c', 1), tasks);
});

test('getDueState classifies dates relative to today', () => {
  const t = (dueDate, completed = false) => ({ dueDate, completed });
  assert.equal(Core.getDueState(t(null), TODAY), null);
  assert.equal(Core.getDueState(t('2026-11-19'), TODAY), 'overdue');
  assert.equal(Core.getDueState(t(TODAY), TODAY), 'today');
  assert.equal(Core.getDueState(t('2026-11-23'), TODAY), 'soon');
  assert.equal(Core.getDueState(t('2026-12-15'), TODAY), 'later');
  assert.equal(Core.getDueState(t('2026-11-01', true), TODAY), 'done');
});

test('filterTasks combines status, category and search', () => {
  let tasks = build([
    { id: 'a', title: 'Prepare slides', category: 'work' },
    { id: 'b', title: 'Buy groceries', category: 'personal', notes: 'milk and bread' },
    { id: 'c', title: 'Revise SQL joins', category: 'study' },
  ]);
  tasks = Core.toggleTask(tasks, 'a', { now: NOW });

  const ids = (f) => Core.filterTasks(tasks, f).map((t) => t.id);
  assert.deepEqual(ids({ status: 'active' }), ['b', 'c']);
  assert.deepEqual(ids({ status: 'completed' }), ['a']);
  assert.deepEqual(ids({ category: 'study' }), ['c']);
  assert.deepEqual(ids({ query: 'BREAD' }), ['b']);
  assert.deepEqual(ids({ query: 'revise joins' }), ['c']);
  assert.deepEqual(ids({ query: 'work' }), ['a']);
  assert.deepEqual(ids({ status: 'active', category: 'work' }), []);
});

test('sortTasks supports due date, priority, newest and manual order', () => {
  const tasks = build([
    { id: 'a', priority: 'low', dueDate: '2026-12-10' },
    { id: 'b', priority: 'high', dueDate: '' },
    { id: 'c', priority: 'medium', dueDate: '2026-11-25' },
    { id: 'd', priority: 'high', dueDate: '2026-11-25' },
  ]);
  const ids = (mode) => Core.sortTasks(tasks, mode).map((t) => t.id);
  assert.deepEqual(ids('manual'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids('due'), ['c', 'd', 'a', 'b']);
  assert.deepEqual(ids('priority'), ['b', 'd', 'c', 'a']);
  // build() gives the first item the newest timestamp.
  assert.deepEqual(ids('newest'), ['a', 'b', 'c', 'd']);
  // Sorting never mutates the source.
  assert.deepEqual(tasks.map((t) => t.id), ['a', 'b', 'c', 'd']);
});

test('getStats counts totals, overdue and completion rate', () => {
  let tasks = [
    { id: '1', title: 'a', category: 'work', priority: 'low', dueDate: '2026-11-10', completed: false },
    { id: '2', title: 'b', category: 'work', priority: 'low', dueDate: TODAY, completed: false },
    { id: '3', title: 'c', category: 'study', priority: 'low', dueDate: null, completed: true },
  ];
  const s = Core.getStats(tasks, TODAY);
  assert.equal(s.total, 3);
  assert.equal(s.active, 2);
  assert.equal(s.completed, 1);
  assert.equal(s.overdue, 1);
  assert.equal(s.dueToday, 1);
  assert.equal(s.completionRate, 33);
  assert.deepEqual(s.byCategory, { work: 2, personal: 0, study: 1 });
  assert.equal(Core.getStats([], TODAY).completionRate, 0);
});

test('normalizeTasks cleans untrusted data and drops invalid entries', () => {
  const list = Core.normalizeTasks([
    { id: 'x', title: '  Valid  ', category: 'WORK', priority: 'High', dueDate: '2026-02-31', completed: 'yes' },
    { id: 'x', title: 'Duplicate id' },
    { title: '' },
    null,
    42,
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].title, 'Valid');
  assert.equal(list[0].category, 'work');
  assert.equal(list[0].priority, 'high');
  assert.equal(list[0].dueDate, null);
  assert.equal(list[0].completed, false);
  assert.notEqual(list[1].id, 'x');
  assert.equal(list[1].category, 'personal');
  assert.deepEqual(Core.normalizeTasks('nope'), []);
});

test('createBackup and parseBackup round-trip', () => {
  const tasks = build([{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }]);
  const text = Core.createBackup(tasks, NOW);
  const parsed = Core.parseBackup(text);
  assert.deepEqual(parsed.map((t) => t.id), ['a', 'b']);
  assert.deepEqual(Core.parseBackup(JSON.stringify(tasks)).length, 2);
  assert.throws(() => Core.parseBackup('{oops'), /not valid JSON/);
  assert.throws(() => Core.parseBackup('{"items": []}'), /No task list/);
});

test('generateId returns unique ids', () => {
  const ids = new Set(Array.from({ length: 200 }, () => Core.generateId()));
  assert.equal(ids.size, 200);
});
