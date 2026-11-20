'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../js/storage.js');

/** Minimal in-memory replacement for window.localStorage. */
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
    data,
  };
}

const task = {
  id: 'a',
  title: 'Saved task',
  notes: '',
  category: 'study',
  priority: 'high',
  dueDate: '2026-12-01',
  completed: false,
  createdAt: '2026-11-20T09:00:00.000Z',
  updatedAt: '2026-11-20T09:00:00.000Z',
  completedAt: null,
};

test('first visit is detected when nothing was saved', () => {
  const r = Store.loadFromLocalStorage(memoryStorage());
  assert.equal(r.firstVisit, true);
  assert.deepEqual(r.tasks, []);
  assert.equal(r.error, null);
});

test('saveToLocalStorage then loadFromLocalStorage returns the same tasks', () => {
  const storage = memoryStorage();
  assert.equal(Store.saveToLocalStorage([task], storage), true);
  const r = Store.loadFromLocalStorage(storage);
  assert.equal(r.firstVisit, false);
  assert.deepEqual(r.tasks, [task]);
});

test('an empty saved list is not treated as a first visit', () => {
  const storage = memoryStorage();
  Store.saveToLocalStorage([], storage);
  const r = Store.loadFromLocalStorage(storage);
  assert.equal(r.firstVisit, false);
  assert.deepEqual(r.tasks, []);
});

test('corrupted JSON is reported instead of crashing', () => {
  const r = Store.loadFromLocalStorage(memoryStorage({ [Store.TASKS_KEY]: '{broken' }));
  assert.equal(r.error, 'corrupted');
  assert.deepEqual(r.tasks, []);
});

test('saving returns false when storage throws (quota or private mode)', () => {
  const failing = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(Store.saveToLocalStorage([task], failing), false);
});

test('preferences are validated on load', () => {
  const storage = memoryStorage();
  Store.savePrefs({ status: 'completed', category: 'work', sort: 'due', theme: 'dark' }, storage);
  assert.deepEqual(Store.loadPrefs(storage), { status: 'completed', category: 'work', sort: 'due', theme: 'dark' });

  const bad = memoryStorage({ [Store.PREFS_KEY]: JSON.stringify({ status: 'x', category: 'y', sort: 'z', theme: 'blue' }) });
  assert.deepEqual(Store.loadPrefs(bad), Store.DEFAULT_PREFS);
});
