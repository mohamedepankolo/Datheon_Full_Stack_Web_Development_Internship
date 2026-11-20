/**
 * Docket - user interface.
 *
 * Holds the in-memory state, renders it to the DOM and wires up events.
 * All business rules live in core.js; persistence lives in storage.js.
 */
(function () {
  'use strict';

  const Core = window.TaskCore;
  const Store = window.TaskStorage;

  const CATEGORY_LABELS = { work: 'Work', personal: 'Personal', study: 'Study' };
  const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };
  const SORT_LABELS = { due: 'due date', priority: 'priority', newest: 'creation date' };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- State ---------- */

  const prefs = Store.loadPrefs();
  const state = {
    tasks: [],
    status: prefs.status,
    category: prefs.category,
    sort: prefs.sort,
    query: '',
    justCompleted: null,
    today: Core.toISODate(new Date()),
  };
  let saveWarningShown = false;

  /* ---------- Elements ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const el = {
    form: $('#task-form'),
    title: $('#task-title'),
    titleError: $('#task-title-error'),
    category: $('#task-category'),
    priority: $('#task-priority'),
    due: $('#task-due'),
    dueError: $('#task-due-error'),
    notes: $('#task-notes'),
    notesDetails: $('#notes-details'),
    list: $('#task-list'),
    template: $('#task-template'),
    hint: $('#list-hint'),
    empty: $('#empty-state'),
    emptyTitle: $('#empty-title'),
    emptyText: $('#empty-text'),
    emptyAction: $('#empty-action'),
    search: $('#search-input'),
    sort: $('#sort-select'),
    statusFilter: $('#status-filter'),
    categoryFilter: $('#category-filter'),
    todayLabel: $('#today-label'),
    stats: {
      total: $('#stat-total'),
      active: $('#stat-active'),
      completed: $('#stat-completed'),
      overdue: $('#stat-overdue'),
    },
    progressBar: $('#progress-bar'),
    progressFill: $('#progress-fill'),
    progressLabel: $('#progress-label'),
    progressNote: $('#progress-note'),
    editDialog: $('#edit-dialog'),
    editForm: $('#edit-form'),
    confirmDialog: $('#confirm-dialog'),
    toast: $('#toast'),
    toastText: $('#toast-text'),
    toastAction: $('#toast-action'),
    announcer: $('#announcer'),
    themeToggle: $('#theme-toggle'),
    exportBtn: $('#export-btn'),
    importBtn: $('#import-btn'),
    importFile: $('#import-file'),
    clearCompletedBtn: $('#clear-completed-btn'),
  };

  /* ---------- Helpers ---------- */

  const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  const dateFormatYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  function parseISO(value) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDue(task) {
    const due = parseISO(task.dueDate);
    const sameYear = task.dueDate.slice(0, 4) === state.today.slice(0, 4);
    const formatted = (sameYear ? dateFormat : dateFormatYear).format(due);
    const diff = Core.daysBetween(state.today, task.dueDate);
    if (task.completed) return `Due ${formatted}`;
    if (diff < 0) return `Overdue · ${formatted}`;
    if (diff === 0) return 'Due today';
    if (diff === 1) return 'Due tomorrow';
    return `Due ${formatted}`;
  }

  function announce(message) {
    el.announcer.textContent = '';
    window.setTimeout(() => {
      el.announcer.textContent = message;
    }, 30);
  }

  let toastTimer = null;
  function showToast(message, undo) {
    window.clearTimeout(toastTimer);
    el.toastText.textContent = message;
    el.toastAction.hidden = !undo;
    el.toastAction.onclick = undo
      ? () => {
          hideToast();
          undo();
        }
      : null;
    el.toast.hidden = false;
    requestAnimationFrame(() => el.toast.classList.add('is-visible'));
    toastTimer = window.setTimeout(hideToast, undo ? 6000 : 3500);
  }

  function hideToast() {
    el.toast.classList.remove('is-visible');
    window.setTimeout(() => {
      if (!el.toast.classList.contains('is-visible')) el.toast.hidden = true;
    }, 200);
  }

  function savePreferences() {
    Store.savePrefs({
      status: state.status,
      category: state.category,
      sort: state.sort,
      theme: document.documentElement.getAttribute('data-theme'),
    });
  }

  /** Single entry point for every change to the task list. */
  function commit(nextTasks, options = {}) {
    state.tasks = nextTasks;
    const saved = Store.saveToLocalStorage(state.tasks);
    if (!saved && !saveWarningShown) {
      saveWarningShown = true;
      showToast('Changes could not be saved in this browser. They will be lost on reload.');
    }
    render(options);
  }

  function visibleTasks() {
    const filtered = Core.filterTasks(state.tasks, {
      status: state.status,
      category: state.category,
      query: state.query,
    });
    return Core.sortTasks(filtered, state.sort);
  }

  /* ---------- Rendering ---------- */

  function renderStats() {
    const stats = Core.getStats(state.tasks, state.today);
    el.stats.total.textContent = stats.total;
    el.stats.active.textContent = stats.active;
    el.stats.completed.textContent = stats.completed;
    el.stats.overdue.textContent = stats.overdue;
    el.stats.overdue.parentElement.classList.toggle('has-alert', stats.overdue > 0);

    el.progressFill.style.width = `${stats.completionRate}%`;
    el.progressLabel.textContent = `${stats.completionRate}%`;
    el.progressBar.setAttribute('aria-valuenow', String(stats.completionRate));
    if (stats.total === 0) {
      el.progressNote.textContent = 'No tasks yet.';
    } else if (stats.completed === stats.total) {
      el.progressNote.textContent = `All ${stats.total} tasks done.`;
    } else {
      const extra = stats.dueToday ? ` · ${stats.dueToday} due today` : '';
      el.progressNote.textContent = `${stats.completed} of ${stats.total} done${extra}`;
    }

    // Category counts are totals; status counts follow the category filter.
    $$('[data-count]', el.categoryFilter).forEach((node) => {
      const key = node.dataset.count;
      node.textContent = key === 'all' ? stats.total : stats.byCategory[key];
    });
    const inCategory = Core.filterTasks(state.tasks, { category: state.category, query: state.query });
    const done = inCategory.filter((t) => t.completed).length;
    const counts = { all: inCategory.length, active: inCategory.length - done, completed: done };
    $$('[data-status-count]', el.statusFilter).forEach((node) => {
      node.textContent = counts[node.dataset.statusCount];
    });

    el.clearCompletedBtn.disabled = stats.completed === 0;
    el.exportBtn.disabled = stats.total === 0;
  }

  function renderFilters() {
    $$('[data-status]', el.statusFilter).forEach((btn) => {
      const on = btn.dataset.status === state.status;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
    });
    $$('[data-category]', el.categoryFilter).forEach((btn) => {
      const on = btn.dataset.category === state.category;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    });
    el.sort.value = state.sort;
  }

  function buildTaskItem(task, canReorder) {
    const node = el.template.content.firstElementChild.cloneNode(true);
    const dueState = Core.getDueState(task, state.today);

    node.dataset.id = task.id;
    node.classList.toggle('is-completed', task.completed);
    node.classList.add(`priority-${task.priority}`);
    if (dueState === 'overdue') node.classList.add('is-overdue');
    if (state.justCompleted === task.id && task.completed) node.classList.add('just-completed');

    const handle = $('.drag-handle', node);
    if (canReorder) {
      handle.setAttribute('aria-label', `Reorder "${task.title}". Use the arrow keys to move it.`);
    } else {
      handle.remove();
    }

    const checkbox = $('.check-input', node);
    checkbox.checked = task.completed;
    checkbox.setAttribute('aria-label', `Mark "${task.title}" as ${task.completed ? 'not completed' : 'completed'}`);

    $('.task-title', node).textContent = task.title;
    const notes = $('.task-notes', node);
    if (task.notes) notes.textContent = task.notes;
    else notes.remove();

    const cat = $('.tag-category', node);
    cat.textContent = CATEGORY_LABELS[task.category];
    cat.classList.add(`tag-${task.category}`);

    const pri = $('.tag-priority', node);
    $('span', pri).textContent = PRIORITY_LABELS[task.priority];
    pri.classList.add(`tag-priority-${task.priority}`);

    const due = $('.tag-due', node);
    if (task.dueDate) {
      $('span', due).textContent = formatDue(task);
      if (dueState) due.classList.add(`due-${dueState}`);
    } else {
      due.remove();
    }

    $('.edit-btn', node).setAttribute('aria-label', `Edit "${task.title}"`);
    $('.delete-btn', node).setAttribute('aria-label', `Delete "${task.title}"`);
    return node;
  }

  function renderList(focus) {
    const visible = visibleTasks();
    const canReorder = state.sort === 'manual' && visible.length > 1;
    const fragment = document.createDocumentFragment();
    visible.forEach((task) => fragment.appendChild(buildTaskItem(task, canReorder)));
    el.list.replaceChildren(fragment);
    el.list.classList.toggle('is-reorderable', canReorder);

    if (visible.length > 1) {
      el.hint.textContent = canReorder
        ? 'Drag the handle to reorder. With a keyboard, focus the handle and use the arrow keys.'
        : `Sorted by ${SORT_LABELS[state.sort]}. Choose "Manual order" to reorder by drag and drop.`;
    } else {
      el.hint.textContent = '';
    }

    const filtersActive = state.status !== 'all' || state.category !== 'all' || state.query.trim() !== '';
    el.empty.hidden = visible.length > 0;
    if (visible.length === 0) {
      if (state.tasks.length === 0) {
        el.emptyTitle.textContent = 'No tasks yet';
        el.emptyText.textContent = 'Add your first task above to get started.';
        el.emptyAction.hidden = true;
      } else if (state.status === 'completed' && !state.query && state.category === 'all') {
        el.emptyTitle.textContent = 'Nothing completed yet';
        el.emptyText.textContent = 'Tick a task when it is done and it will show up here.';
        el.emptyAction.hidden = true;
      } else if (state.status === 'active' && !state.query && state.category === 'all') {
        el.emptyTitle.textContent = 'All caught up';
        el.emptyText.textContent = 'Every task is completed. Nice work.';
        el.emptyAction.hidden = true;
      } else {
        el.emptyTitle.textContent = 'No matching tasks';
        el.emptyText.textContent = 'Try another search or clear the filters.';
        el.emptyAction.hidden = !filtersActive;
      }
    }

    if (focus) {
      const item = el.list.querySelector(`[data-id="${CSS.escape(focus.id)}"]`);
      const target = item && item.querySelector(focus.selector);
      if (target) target.focus();
      else el.title.focus();
    }
  }

  function render(options = {}) {
    renderStats();
    renderFilters();
    renderList(options.focus);
    state.justCompleted = null;
  }

  /* ---------- Create ---------- */

  function setFieldError(input, errorNode, message) {
    errorNode.textContent = message || '';
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function onCreate(event) {
    event.preventDefault();
    const input = {
      title: el.title.value,
      notes: el.notes.value,
      category: el.category.value,
      priority: el.priority.value,
      dueDate: el.due.value,
    };
    const check = Core.validateTaskInput(input, { today: state.today });
    setFieldError(el.title, el.titleError, check.errors.title);
    setFieldError(el.due, el.dueError, check.errors.dueDate);
    if (!check.valid) {
      (check.errors.title ? el.title : el.due).focus();
      return;
    }

    const { tasks, task } = Core.addTask(state.tasks, input);

    // Make sure the new task is visible after adding it.
    if (state.status === 'completed') state.status = 'all';
    if (state.category !== 'all' && state.category !== task.category) state.category = 'all';
    if (state.query && !Core.filterTasks([task], { query: state.query }).length) {
      state.query = '';
      el.search.value = '';
    }
    savePreferences();

    commit(tasks);
    el.title.value = '';
    el.notes.value = '';
    el.due.value = '';
    el.notesDetails.open = false;
    el.title.focus();
    const added = el.list.querySelector(`[data-id="${CSS.escape(task.id)}"]`);
    if (added) {
      added.classList.add('just-added');
    }
    announce(`Task added: ${task.title}`);
  }

  /* ---------- Toggle, delete ---------- */

  function onToggle(id, checkbox) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    const next = Core.toggleTask(state.tasks, id);
    const nowCompleted = !task.completed;
    const item = checkbox.closest('.task');
    const willHide = (state.status === 'active' && nowCompleted) || (state.status === 'completed' && !nowCompleted);

    announce(nowCompleted ? `Completed: ${task.title}` : `Marked as not completed: ${task.title}`);

    if (willHide && !reduceMotion.matches) {
      item.classList.toggle('is-completed', nowCompleted);
      item.classList.add('is-leaving');
      window.setTimeout(() => commit(next), 320);
      return;
    }
    if (nowCompleted) state.justCompleted = id;
    commit(next, { focus: { id, selector: '.check-input' } });
  }

  function onDelete(id) {
    const { tasks, removed, index } = Core.deleteTask(state.tasks, id);
    if (!removed) return;
    commit(tasks);
    showToast(`Deleted "${removed.title}"`, () => {
      commit(Core.restoreTask(state.tasks, removed, index), { focus: { id: removed.id, selector: '.delete-btn' } });
      announce(`Restored: ${removed.title}`);
    });
  }

  async function onClearCompleted() {
    const count = state.tasks.filter((t) => t.completed).length;
    if (!count) return;
    const ok = await confirmAction(
      'Clear completed tasks?',
      `${count} completed ${count === 1 ? 'task' : 'tasks'} will be removed.`,
      'Clear completed'
    );
    if (!ok) return;
    const { tasks, removed } = Core.clearCompleted(state.tasks);
    commit(tasks);
    showToast(`Removed ${removed.length} completed ${removed.length === 1 ? 'task' : 'tasks'}`, () => {
      commit(Core.restoreMany(state.tasks, removed));
    });
  }

  /* ---------- Edit dialog ---------- */

  let editingId = null;

  function openEdit(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    editingId = id;
    const f = el.editForm.elements;
    f.title.value = task.title;
    f.notes.value = task.notes || '';
    f.category.value = task.category;
    f.priority.value = task.priority;
    f.dueDate.value = task.dueDate || '';
    // Keep an existing past date valid; otherwise block past dates.
    f.dueDate.min = task.dueDate && task.dueDate < state.today ? '' : state.today;
    f.completed.checked = task.completed;
    ['title', 'notes', 'due'].forEach((k) => setFieldError(f[k === 'due' ? 'dueDate' : k], $(`#edit-${k}-error`), ''));
    el.editDialog.showModal();
    f.title.focus();
    f.title.select();
  }

  function closeEdit() {
    el.editDialog.close();
  }

  function onEditSubmit(event) {
    event.preventDefault();
    const f = el.editForm.elements;
    const changes = {
      title: f.title.value,
      notes: f.notes.value,
      category: f.category.value,
      priority: f.priority.value,
      dueDate: f.dueDate.value || null,
    };
    try {
      let next = Core.updateTask(state.tasks, editingId, changes);
      const current = next.find((t) => t.id === editingId);
      if (current.completed !== f.completed.checked) {
        next = Core.toggleTask(next, editingId);
      }
      const id = editingId;
      closeEdit();
      commit(next, { focus: { id, selector: '.edit-btn' } });
      announce('Task updated');
      showToast('Task updated');
    } catch (err) {
      if (err instanceof Core.TaskValidationError) {
        setFieldError(f.title, $('#edit-title-error'), err.errors.title);
        setFieldError(f.notes, $('#edit-notes-error'), err.errors.notes);
        setFieldError(f.dueDate, $('#edit-due-error'), err.errors.dueDate);
        (err.errors.title ? f.title : err.errors.dueDate ? f.dueDate : f.notes).focus();
      } else {
        closeEdit();
        showToast('This task no longer exists.');
        render();
      }
    }
  }

  /* ---------- Confirm dialog ---------- */

  function confirmAction(title, text, okLabel) {
    return new Promise((resolve) => {
      $('#confirm-heading').textContent = title;
      $('#confirm-text').textContent = text;
      $('#confirm-ok').textContent = okLabel || 'Confirm';
      el.confirmDialog.returnValue = 'cancel';
      el.confirmDialog.addEventListener(
        'close',
        () => resolve(el.confirmDialog.returnValue === 'confirm'),
        { once: true }
      );
      el.confirmDialog.showModal();
      $('#confirm-ok').focus();
    });
  }

  // Close dialogs when the backdrop is clicked.
  [el.editDialog, el.confirmDialog].forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close('cancel');
    });
  });

  /* ---------- Reordering: pointer drag and keyboard ---------- */

  let drag = null;

  // Move/up listeners live on window: moving the dragged <li> in the DOM
  // would release a pointer capture set on the handle itself.
  function onHandlePointerDown(event, handle) {
    if (state.sort !== 'manual' || event.button !== 0 || drag) return;
    const item = handle.closest('.task');
    event.preventDefault();
    drag = { pointerId: event.pointerId, item, startY: event.clientY, moved: false };
    window.addEventListener('pointermove', onHandlePointerMove);
    window.addEventListener('pointerup', onHandlePointerUp);
    window.addEventListener('pointercancel', onHandlePointerUp);
  }

  function onHandlePointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    if (!drag.moved) {
      if (Math.abs(event.clientY - drag.startY) < 4) return;
      drag.moved = true;
      drag.item.classList.add('is-dragging');
      el.list.classList.add('is-sorting');
    }
    const y = event.clientY;
    const siblings = Array.from(el.list.children).filter((li) => li !== drag.item);
    const before = siblings.find((li) => {
      const rect = li.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    if (before) {
      if (drag.item.nextElementSibling !== before) el.list.insertBefore(drag.item, before);
    } else if (el.list.lastElementChild !== drag.item) {
      el.list.appendChild(drag.item);
    }
    // Scroll the page when dragging near the top or bottom edge.
    const edge = 70;
    if (y < edge) window.scrollBy(0, -12);
    else if (y > window.innerHeight - edge) window.scrollBy(0, 12);
  }

  function onHandlePointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { item, moved } = drag;
    window.removeEventListener('pointermove', onHandlePointerMove);
    window.removeEventListener('pointerup', onHandlePointerUp);
    window.removeEventListener('pointercancel', onHandlePointerUp);
    drag = null;
    item.classList.remove('is-dragging');
    el.list.classList.remove('is-sorting');
    if (!moved) return;
    const order = Array.from(el.list.children).map((li) => li.dataset.id);
    commit(Core.reorderSubset(state.tasks, order));
    const position = order.indexOf(item.dataset.id) + 1;
    announce(`Moved to position ${position} of ${order.length}`);
  }

  function onHandleKeydown(event, handle) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const id = handle.closest('.task').dataset.id;
    const ids = visibleTasks().map((t) => t.id);
    const delta = event.key === 'ArrowUp' ? -1 : 1;
    const next = Core.moveWithin(state.tasks, ids, id, delta);
    if (next === state.tasks) return;
    commit(next, { focus: { id, selector: '.drag-handle' } });
    const order = visibleTasks().map((t) => t.id);
    announce(`Moved to position ${order.indexOf(id) + 1} of ${order.length}`);
  }

  /* ---------- Import / export ---------- */

  function onExport() {
    const blob = new Blob([Core.createBackup(state.tasks)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `docket-backup-${state.today}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${state.tasks.length} ${state.tasks.length === 1 ? 'task' : 'tasks'}`);
  }

  async function onImportFile() {
    const file = el.importFile.files[0];
    el.importFile.value = '';
    if (!file) return;
    let imported;
    try {
      imported = Core.parseBackup(await file.text());
    } catch (err) {
      showToast(err.message);
      return;
    }
    if (!imported.length) {
      showToast('This file does not contain any valid task.');
      return;
    }
    if (state.tasks.length) {
      const ok = await confirmAction(
        'Replace your tasks?',
        `Your ${state.tasks.length} current ${state.tasks.length === 1 ? 'task' : 'tasks'} will be replaced by ${imported.length} ${imported.length === 1 ? 'task' : 'tasks'} from "${file.name}".`,
        'Replace'
      );
      if (!ok) return;
    }
    const previous = state.tasks;
    commit(imported);
    showToast(`Imported ${imported.length} ${imported.length === 1 ? 'task' : 'tasks'}`, () => commit(previous));
  }

  /* ---------- Theme ---------- */

  function syncThemeButton() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    el.themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    el.themeToggle.title = dark ? 'Light theme' : 'Dark theme';
  }

  function toggleTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    syncThemeButton();
    savePreferences();
  }

  /* ---------- Sample data for the very first visit ---------- */

  function sampleTasks() {
    const base = new Date();
    const inDays = (n) => {
      const d = new Date(base);
      d.setDate(d.getDate() + n);
      return Core.toISODate(d);
    };
    const samples = [
      { title: 'Plan the week and set three priorities', category: 'personal', priority: 'medium', dueDate: inDays(0), notes: '' },
      { title: 'Review pull request for the reporting module', category: 'work', priority: 'high', dueDate: inDays(1), notes: 'Check edge cases on empty datasets.' },
      { title: 'Read chapter 4 of the data engineering course', category: 'study', priority: 'low', dueDate: inDays(5), notes: '' },
      { title: 'Try Docket: edit, complete or drag this task', category: 'personal', priority: 'low', dueDate: '', notes: 'Delete the sample tasks whenever you like.' },
    ];
    let list = [];
    samples.reverse().forEach((s) => {
      list = Core.addTask(list, s).tasks;
    });
    return list;
  }

  /* ---------- Events ---------- */

  function bindEvents() {
    el.form.addEventListener('submit', onCreate);
    el.title.addEventListener('input', () => {
      if (el.titleError.textContent) setFieldError(el.title, el.titleError, '');
    });
    el.due.addEventListener('input', () => setFieldError(el.due, el.dueError, ''));

    // Event delegation for every task item.
    el.list.addEventListener('change', (event) => {
      if (event.target.matches('.check-input')) {
        onToggle(event.target.closest('.task').dataset.id, event.target);
      }
    });
    el.list.addEventListener('click', (event) => {
      const item = event.target.closest('.task');
      if (!item) return;
      if (event.target.closest('.edit-btn')) openEdit(item.dataset.id);
      else if (event.target.closest('.delete-btn')) onDelete(item.dataset.id);
    });
    el.list.addEventListener('dblclick', (event) => {
      const title = event.target.closest('.task-title');
      if (title) openEdit(title.closest('.task').dataset.id);
    });

    // Handles are recreated on each render, so bind through delegation.
    el.list.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('.drag-handle');
      if (handle) onHandlePointerDown(event, handle);
    });
    el.list.addEventListener('keydown', (event) => {
      const handle = event.target.closest('.drag-handle');
      if (handle) onHandleKeydown(event, handle);
    });

    el.statusFilter.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-status]');
      if (!btn) return;
      state.status = btn.dataset.status;
      savePreferences();
      render();
    });
    el.statusFilter.addEventListener('keydown', (event) => moveRovingFocus(event, el.statusFilter, '[data-status]'));

    el.categoryFilter.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-category]');
      if (!btn) return;
      state.category = btn.dataset.category;
      savePreferences();
      render();
    });
    el.categoryFilter.addEventListener('keydown', (event) => moveRovingFocus(event, el.categoryFilter, '[data-category]'));

    let searchTimer = null;
    el.search.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        state.query = el.search.value;
        render();
      }, 120);
    });

    el.sort.addEventListener('change', () => {
      state.sort = el.sort.value;
      savePreferences();
      render();
    });

    el.emptyAction.addEventListener('click', () => {
      state.status = 'all';
      state.category = 'all';
      state.query = '';
      el.search.value = '';
      savePreferences();
      render();
      el.title.focus();
    });

    el.editForm.addEventListener('submit', onEditSubmit);
    $$('[data-close]', el.editDialog).forEach((btn) => btn.addEventListener('click', closeEdit));

    el.clearCompletedBtn.addEventListener('click', onClearCompleted);
    el.exportBtn.addEventListener('click', onExport);
    el.importBtn.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', onImportFile);
    el.themeToggle.addEventListener('click', toggleTheme);

    // Keep several open tabs in sync.
    window.addEventListener('storage', (event) => {
      if (event.key === Store.TASKS_KEY) {
        state.tasks = Store.loadFromLocalStorage().tasks;
        render();
      }
    });

    // Refresh "today", "overdue" and similar labels after midnight.
    window.setInterval(() => {
      const today = Core.toISODate(new Date());
      if (today !== state.today) {
        state.today = today;
        updateDateUI();
        render();
      }
    }, 60000);
  }

  /** Arrow-key navigation inside a group of buttons (tabs, radios). */
  function moveRovingFocus(event, group, selector) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const items = $$(selector, group);
    const index = items.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else next = (index + 1) % items.length;
    items[next].click();
    items[next].focus();
  }

  function updateDateUI() {
    el.todayLabel.textContent = longDate.format(new Date());
    el.due.min = state.today;
  }

  /* ---------- Start ---------- */

  function init() {
    const loaded = Store.loadFromLocalStorage();
    if (loaded.firstVisit) {
      state.tasks = sampleTasks();
      Store.saveToLocalStorage(state.tasks);
    } else {
      state.tasks = loaded.tasks;
    }
    updateDateUI();
    syncThemeButton();
    bindEvents();
    render();
    if (loaded.error === 'corrupted') {
      showToast('Saved data could not be read, so the list was reset.');
    } else if (loaded.error === 'unavailable') {
      saveWarningShown = true;
      showToast('Browser storage is unavailable. Tasks will not be kept after reload.');
    }
  }

  init();
})();
