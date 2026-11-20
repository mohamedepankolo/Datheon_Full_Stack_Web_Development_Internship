/**
 * Docket - localStorage persistence.
 *
 * The storage object is injectable so the same code runs in the browser
 * (window.localStorage) and in Node tests (an in-memory stub).
 */
(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./core.js') : root.TaskCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TaskStorage = api;
  }
})(typeof self !== 'undefined' ? self : this, function (TaskCore) {
  'use strict';

  const TASKS_KEY = 'docket.tasks.v1';
  const PREFS_KEY = 'docket.prefs.v1';

  const DEFAULT_PREFS = {
    status: 'all',
    category: 'all',
    sort: 'manual',
    theme: null,
  };

  function getStorage(storage) {
    if (storage) return storage;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
      // Some privacy modes throw on access.
      return null;
    }
  }

  /**
   * Loads tasks. `firstVisit` is true only when nothing was ever saved,
   * so sample tasks are offered once and never come back after the user
   * deletes everything.
   */
  function loadFromLocalStorage(storage) {
    const store = getStorage(storage);
    if (!store) {
      return { tasks: [], firstVisit: false, error: 'unavailable' };
    }
    let raw;
    try {
      raw = store.getItem(TASKS_KEY);
    } catch (e) {
      return { tasks: [], firstVisit: false, error: 'unavailable' };
    }
    if (raw === null) {
      return { tasks: [], firstVisit: true, error: null };
    }
    try {
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : data && data.tasks;
      return { tasks: TaskCore.normalizeTasks(list), firstVisit: false, error: null };
    } catch (e) {
      return { tasks: [], firstVisit: false, error: 'corrupted' };
    }
  }

  /** Saves tasks. Returns false instead of throwing (quota, private mode). */
  function saveToLocalStorage(tasks, storage) {
    const store = getStorage(storage);
    if (!store) return false;
    try {
      store.setItem(TASKS_KEY, JSON.stringify(tasks));
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadPrefs(storage) {
    const store = getStorage(storage);
    const prefs = { ...DEFAULT_PREFS };
    if (!store) return prefs;
    try {
      const data = JSON.parse(store.getItem(PREFS_KEY) || '{}');
      if (TaskCore.STATUSES.includes(data.status)) prefs.status = data.status;
      if (data.category === 'all' || TaskCore.CATEGORIES.includes(data.category)) prefs.category = data.category;
      if (TaskCore.SORT_MODES.includes(data.sort)) prefs.sort = data.sort;
      if (data.theme === 'light' || data.theme === 'dark') prefs.theme = data.theme;
    } catch (e) {
      /* fall back to defaults */
    }
    return prefs;
  }

  function savePrefs(prefs, storage) {
    const store = getStorage(storage);
    if (!store) return false;
    try {
      store.setItem(PREFS_KEY, JSON.stringify(prefs));
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    TASKS_KEY,
    PREFS_KEY,
    DEFAULT_PREFS,
    loadFromLocalStorage,
    saveToLocalStorage,
    loadPrefs,
    savePrefs,
  };
});
