// ---- State ----
const STORAGE_KEY = 'mindset-stack-tracker';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_TASKS = 15;
const MAX_HABITS = 8;
const PRIVACY_LEVELS = ['private', 'followers', 'public'];
const PRIVACY_ICONS = { private: '&#128274;', followers: '&#128101;', public: '&#127760;' };
const PRIVACY_LABELS = { private: 'Private', followers: 'Followers', public: 'Public' };
const HABIT_UNITS = [
  { value: '', label: '—' },
  { value: 'min', label: 'min' },
  { value: 'reps', label: 'reps' },
  { value: 'steps', label: 'steps' },
  { value: 'l', label: 'l' },
  { value: 'p.', label: 'p.' },
  { value: 'km', label: 'km' },
  { value: 'cal', label: 'cal' },
  { value: 'ml', label: 'ml' },
  { value: 'hrs', label: 'hrs' }
];

function generateId() {
  return 'h_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

function dateToStr(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  return dateToStr(d);
}

function getCurrentMonday() {
  return getMonday(new Date());
}

function getDefaultWeekData(habitDefs) {
  const habitChecks = {};
  habitDefs.forEach(h => {
    habitChecks[h.id] = Array(7).fill(h.target > 0 ? 0 : false);
  });
  return {
    habitChecks,
    days: Array.from({ length: 7 }, () => ({ tasks: [] }))
  };
}

function getDefaultState() {
  return {
    currentWeek: getCurrentMonday(),
    habitDefs: [],
    weeks: {},
    profile: { firstName: '', lastName: '', dob: '', email: '', photoURL: '', nickname: '', country: '' },
    achievements: []
  };
}

// Migrate old single-week format to new multi-week format
function migrateState(data) {
  if (data.weeks && data.habitDefs) return data;

  const newState = {
    currentWeek: data.weekStart || getCurrentMonday(),
    habitDefs: [],
    weeks: {}
  };

  const habitChecks = {};
  if (data.habits && data.habits.length > 0) {
    data.habits.forEach(h => {
      const id = generateId();
      newState.habitDefs.push({ id, name: h.name || '', target: h.target || 0, unit: h.unit || '' });
      habitChecks[id] = h.checks || Array(7).fill(h.target > 0 ? 0 : false);
    });
  }

  const days = (data.days || []).map(d => ({ tasks: d.tasks || [] }));
  while (days.length < 7) days.push({ tasks: [] });

  newState.weeks[newState.currentWeek] = { habitChecks, days };
  return newState;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      let data = JSON.parse(raw);
      data = migrateState(data);
      data.habitDefs.forEach(h => {
        if (h.target === undefined) h.target = 0;
        if (h.unit === undefined) h.unit = '';
        if (!h.privacy) h.privacy = 'followers';
      });
      // Migrate tasks: add privacy field
      Object.values(data.weeks || {}).forEach(wd => {
        (wd.days || []).forEach(day => {
          (day.tasks || []).forEach(t => {
            if (!t.privacy) t.privacy = 'followers';
          });
        });
      });
      if (!data.profile) data.profile = { firstName: '', lastName: '', dob: '', email: '', photoURL: '' };
      if (!data.profile.nickname) data.profile.nickname = '';
      if (!data.profile.country) data.profile.country = '';
      if (!data.achievements) data.achievements = [];
      return data;
    }
  } catch (e) { /* ignore */ }
  return getDefaultState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (window.firebaseSync) window.firebaseSync();
}

// Save to localStorage only (used by firebase-sync to avoid circular push)
function saveStateLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Carry forward incomplete tasks from yesterday to today
function carryForwardIncompleteTasks() {
  const today = new Date();
  const todayStr = dateToStr(today);

  // Only carry forward once per day
  if (state.lastCarryForward === todayStr) return;

  // Get yesterday
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const yesterdayWeekStart = getMonday(yesterday);
  const yesterdayDayIndex = (yesterday.getDay() + 6) % 7;

  // Check if yesterday's week data exists (don't create it)
  const yesterdayWeekData = state.weeks[yesterdayWeekStart];
  if (!yesterdayWeekData || !yesterdayWeekData.days[yesterdayDayIndex]) {
    state.lastCarryForward = todayStr;
    saveState();
    return;
  }

  const yesterdayTasks = yesterdayWeekData.days[yesterdayDayIndex].tasks || [];
  const incompleteTasks = yesterdayTasks.filter(t => !t.done && t.text.trim());

  if (incompleteTasks.length === 0) {
    state.lastCarryForward = todayStr;
    saveState();
    return;
  }

  // Get today's week data (create if needed)
  const todayWeekStart = getMonday(today);
  const todayDayIndex = (today.getDay() + 6) % 7;
  const todayWeekData = getWeekData(todayWeekStart);
  const todayTasks = todayWeekData.days[todayDayIndex].tasks;

  // Move incomplete tasks to today (skip duplicates, respect max)
  incompleteTasks.forEach(task => {
    const alreadyExists = todayTasks.some(t => t.text === task.text);
    if (!alreadyExists && todayTasks.length < MAX_TASKS) {
      todayTasks.push({ text: task.text, done: false, privacy: task.privacy });
    }
  });

  // Remove carried-forward tasks from yesterday
  yesterdayWeekData.days[yesterdayDayIndex].tasks = yesterdayTasks.filter(
    t => t.done || !t.text.trim()
  );

  state.lastCarryForward = todayStr;
  saveState();
}

// Get or create week data for a given week start date
function getWeekData(weekStart) {
  if (!state.weeks[weekStart]) {
    state.weeks[weekStart] = getDefaultWeekData(state.habitDefs);
  }
  const wd = state.weeks[weekStart];
  // Ensure all current habits have check entries
  state.habitDefs.forEach(h => {
    if (!wd.habitChecks[h.id]) {
      wd.habitChecks[h.id] = Array(7).fill(h.target > 0 ? 0 : false);
    }
  });
  while (wd.days.length < 7) wd.days.push({ tasks: [] });
  return wd;
}

function currentWeekData() {
  return getWeekData(state.currentWeek);
}

let state = loadState();
let navState = { category: 'habits', scope: 'daily' };
let viewingDate = new Date();
let viewingMonth = new Date(); // for monthly views

// ---- Helpers ----
function getWeekDates(startStr) {
  const start = new Date(startStr + 'T00:00:00');
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// ---- Render: Header ----
function initHeader() {
  const input = document.getElementById('week-start');
  input.value = state.currentWeek;

  input.addEventListener('change', (e) => {
    // Snap to Monday of the selected week
    const picked = new Date(e.target.value + 'T00:00:00');
    state.currentWeek = getMonday(picked);
    viewingDate = new Date(state.currentWeek + 'T00:00:00');
    input.value = state.currentWeek;
    saveState();
    renderAll();
  });

  // Reset button — context-aware
  const resetBtn = document.getElementById('reset-day-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (navState.scope === 'weekly') {
        showConfirm(
          'Reset Week?',
          'This will uncheck all habits and tasks for the entire week.',
          resetWholeWeek
        );
      } else {
        const dayName = DAY_NAMES[viewingDate.getDay()];
        showConfirm(
          'Reset Day?',
          `This will uncheck all habits and tasks for ${dayName}.`,
          resetCurrentDay
        );
      }
    });
  }
}

// ---- Notification Panel ----
let notifData = [];
let notifPanelOpen = false;

window.onNotifsUpdate = function(notifs) {
  notifData = notifs || [];
  updateBellBadge();
  if (notifPanelOpen) renderNotifList();
};

function updateBellBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const unread = notifData.filter(n => !n.read).length;
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function openNotifPanel() {
  notifPanelOpen = true;
  document.getElementById('notif-overlay').classList.add('visible');
  renderNotifList();
}

function closeNotifPanel() {
  notifPanelOpen = false;
  document.getElementById('notif-overlay').classList.remove('visible');
}

function formatNotifTime(createdAt) {
  if (!createdAt) return '';
  const ts = createdAt.toDate ? createdAt.toDate() : new Date(createdAt.seconds ? createdAt.seconds * 1000 : createdAt);
  const now = Date.now();
  const diff = now - ts.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getNotifIcon(type) {
  switch (type) {
    case 'welcome': return '🎉';
    case 'challenge_invite': return '⚔️';
    case 'new_follower': return '👤';
    case 'successful_day': return '🏆';
    case 'habit_reminder': return '🔔';
    default: return '📣';
  }
}

function renderNotifList() {
  const list = document.getElementById('notif-list');
  const empty = document.getElementById('notif-empty');
  if (!list) return;

  if (notifData.length === 0) {
    list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
    return;
  }

  let html = '';
  notifData.forEach(n => {
    const icon = getNotifIcon(n.type);
    const time = formatNotifTime(n.createdAt);
    const unreadCls = n.read ? '' : ' unread';
    let actionsHtml = '';

    if (n.type === 'challenge_invite' && !n.read) {
      actionsHtml = `
        <div class="notif-actions">
          <button class="notif-accept-btn" data-notif-id="${n.id}" data-action="accept" data-challenge-id="${n.data?.challengeId || ''}">Accept</button>
          <button class="notif-decline-btn" data-notif-id="${n.id}" data-action="decline">Decline</button>
        </div>
      `;
    }

    html += `
      <div class="notif-item${unreadCls}" data-notif-id="${n.id}">
        <div class="notif-icon">${icon}</div>
        <div class="notif-content">
          <div class="notif-title">${escapeHtml(n.title || '')}</div>
          <div class="notif-body">${escapeHtml(n.body || '')}</div>
          ${actionsHtml}
          <div class="notif-time">${time}</div>
        </div>
      </div>
    `;
  });

  list.innerHTML = html;

  // Accept / Decline handlers
  list.querySelectorAll('.notif-accept-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const notifId = btn.dataset.notifId;
      const challengeId = btn.dataset.challengeId;
      btn.disabled = true;
      btn.textContent = 'Joining...';
      try {
        if (challengeId && window.challengeSync) {
          await window.challengeSync.joinChallenge(challengeId);
        }
        if (window.notifSync) await window.notifSync.markNotificationRead(notifId);
        // Refresh challenges view if visible
        if (typeof renderMyChallenges === 'function') renderMyChallenges();
      } catch (err) {
        console.error('[notif] accept invite failed:', err);
        btn.textContent = 'Failed';
      }
    });
  });

  list.querySelectorAll('.notif-decline-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const notifId = btn.dataset.notifId;
      btn.disabled = true;
      btn.textContent = 'Removing...';
      try {
        if (window.notifSync) await window.notifSync.deleteNotification(notifId);
      } catch (err) {
        console.error('[notif] decline invite failed:', err);
        btn.textContent = 'Failed';
      }
    });
  });

  // Clicking a non-invite notification marks it as read
  list.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', () => {
      const notifId = item.dataset.notifId;
      const n = notifData.find(x => x.id === notifId);
      if (n && !n.read && n.type !== 'challenge_invite' && window.notifSync) {
        window.notifSync.markNotificationRead(notifId).catch(() => {});
      }
    });
  });
}

function initNotifPanel() {
  const bellBtn = document.getElementById('notif-bell-btn');
  const closeBtn = document.getElementById('notif-close-btn');
  const markAllBtn = document.getElementById('notif-mark-all-btn');
  const overlay = document.getElementById('notif-overlay');

  if (bellBtn) bellBtn.addEventListener('click', openNotifPanel);
  if (closeBtn) closeBtn.addEventListener('click', closeNotifPanel);
  // Backdrop click
  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeNotifPanel();
  });
  // Mark all read
  if (markAllBtn) markAllBtn.addEventListener('click', () => {
    if (window.notifSync) {
      window.notifSync.markAllNotificationsRead().catch(e => console.error('[notif] mark all read failed:', e));
    }
  });
}

// ---- Confirm Overlay ----
let confirmCallback = null;

function showConfirm(title, msg, onConfirm) {
  const overlay = document.getElementById('confirm-overlay');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  confirmCallback = onConfirm;
  overlay.classList.add('visible');
}

function hideConfirm() {
  document.getElementById('confirm-overlay').classList.remove('visible');
  confirmCallback = null;
}

document.getElementById('confirm-cancel').addEventListener('click', hideConfirm);
document.getElementById('confirm-ok').addEventListener('click', () => {
  if (confirmCallback) confirmCallback();
  hideConfirm();
});
document.getElementById('confirm-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideConfirm();
});

function resetCurrentDay() {
  const di = getViewingDayIndex();
  const wd = currentWeekData();
  state.habitDefs.forEach(h => {
    if (wd.habitChecks[h.id]) {
      wd.habitChecks[h.id][di] = h.target > 0 ? 0 : false;
    }
  });
  wd.days[di].tasks.forEach(t => { t.done = false; });
  saveState();
  renderAll();
}

function resetWholeWeek() {
  const wd = currentWeekData();
  state.habitDefs.forEach(h => {
    if (wd.habitChecks[h.id]) {
      wd.habitChecks[h.id] = wd.habitChecks[h.id].map(() => h.target > 0 ? 0 : false);
    }
  });
  wd.days.forEach(day => { day.tasks.forEach(t => { t.done = false; }); });
  saveState();
  renderAll();
}

// ---- Progress ----
function getHabitProgress(habit, checks) {
  const isNumeric = habit.target > 0;
  if (isNumeric) {
    const weeklyGoal = habit.target * 7;
    const weeklyDone = checks.reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
    const pct = weeklyGoal > 0 ? Math.min(Math.round((weeklyDone / weeklyGoal) * 100), 100) : 0;
    return { pct, weeklyDone, weeklyGoal, isNumeric: true };
  } else {
    const completed = checks.filter(Boolean).length;
    const pct = Math.round((completed / 7) * 100);
    return { pct, completed, isNumeric: false };
  }
}

// ---- Canvas Helpers ----
function drawDonut(canvas, pct, emptyText, size) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  size = size || 140;

  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const margin = Math.max(6, Math.min(12, size * 0.1));
  const r = size / 2 - margin;
  const lineWidth = Math.max(3, Math.round(size * 0.07));

  ctx.clearRect(0, 0, size, size);

  if (pct < 0) {
    // No data state
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    ctx.fillStyle = '#6b7084';
    ctx.font = `500 ${Math.round(size * 0.1)}px DM Sans, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emptyText || '—', cx, cy);
    return;
  }

  // Background arc (subtle track)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  // Fill arc (accent green gradient via two-tone)
  if (pct > 0) {
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (Math.PI * 2 * Math.min(pct, 1));
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = '#00d4aa';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Glow effect
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(0, 212, 170, 0.15)';
    ctx.lineWidth = lineWidth + 6;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Center text
  ctx.fillStyle = '#e8eaf0';
  ctx.font = `700 ${Math.round(size * 0.18)}px DM Sans, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(pct * 100)}%`, cx, cy);
}

// Calculate weekly progress across all 7 days
function calculateWeeklyProgress() {
  const weekData = currentWeekData();

  // Tasks across entire week
  let totalTasks = 0;
  let completedTasks = 0;
  weekData.days.forEach(day => {
    totalTasks += day.tasks.length;
    completedTasks += day.tasks.filter(t => t.done).length;
  });
  const tasksPct = totalTasks > 0 ? completedTasks / totalTasks : -1;

  // Habits across entire week
  let habitPctSum = 0;
  let habitCount = 0;
  state.habitDefs.forEach(habit => {
    const checks = weekData.habitChecks[habit.id] || Array(7).fill(habit.target > 0 ? 0 : false);
    const prog = getHabitProgress(habit, checks);
    habitPctSum += prog.pct;
    habitCount++;
  });
  const habitsPct = habitCount > 0 ? habitPctSum / (habitCount * 100) : -1;

  return { tasksPct, habitsPct };
}

function computeOverall(tasksPct, habitsPct) {
  const hasTasks = tasksPct >= 0;
  const hasHabits = habitsPct >= 0;
  if (hasTasks && hasHabits) return (tasksPct + habitsPct) / 2;
  if (hasTasks) return tasksPct;
  if (hasHabits) return habitsPct;
  return -1;
}

function roundedRect(ctx, x, y, w, h, r) {
  if (h <= 0) return;
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Daily View Helpers ----
function getViewingDayIndex() {
  return (viewingDate.getDay() + 6) % 7; // 0=Mon, 6=Sun
}

function syncViewingWeek() {
  const newWeek = getMonday(viewingDate);
  if (newWeek !== state.currentWeek) {
    state.currentWeek = newWeek;
    document.getElementById('week-start').value = state.currentWeek;
    saveState();
  }
}

function navigateViewDay(offset) {
  // Animate the hero section transition
  const hero = document.querySelector('.daily-hero');
  if (hero) {
    hero.classList.add('navigating');
    setTimeout(() => hero.classList.remove('navigating'), 150);
  }
  triggerHaptic('light');

  viewingDate.setDate(viewingDate.getDate() + offset);
  syncViewingWeek();
  renderAll();
}

// ---- Render: Daily Hero ----
function renderDailyHero() {
  // Delegate to the correct hero based on current nav context
  if (navState.category === 'habits') {
    renderDailyHeroHabitsOnly();
  } else if (navState.category === 'tasks') {
    renderDailyHeroTasksOnly();
  }
}

// ---- Render: Daily Habits List ----
let habitsEditMode = false;

function renderDailyHabits() {
  const container = document.getElementById('daily-habits-list');
  const di = getViewingDayIndex();
  const weekData = currentWeekData();

  container.innerHTML = '';

  // Update edit button state
  const editBtn = document.getElementById('habits-edit-btn');
  if (editBtn) {
    editBtn.classList.toggle('active', habitsEditMode);
    editBtn.innerHTML = habitsEditMode ? '&#10003;' : '&#9998;';
  }

  state.habitDefs.forEach((habit, hi) => {
    const checks = weekData.habitChecks[habit.id] || Array(7).fill(habit.target > 0 ? 0 : false);
    const val = checks[di];
    const isNumeric = habit.target > 0;
    const isDone = isNumeric ? (typeof val === 'number' && val >= habit.target) : !!val;

    const row = document.createElement('div');
    row.className = 'daily-list-row';

    if (habitsEditMode && habit.name) {
      // Edit mode — delete button, editable name, target, unit, privacy
      const unitOptions = HABIT_UNITS.map(u =>
        `<option value="${u.value}"${habit.unit === u.value ? ' selected' : ''}>${u.label}</option>`
      ).join('');
      const prv = habit.privacy || 'followers';
      const privacyOptions = PRIVACY_LEVELS.map(l =>
        `<option value="${l}"${prv === l ? ' selected' : ''}>${l === 'private' ? '🔒 Private' : l === 'followers' ? '👥 Followers' : '🌐 Public'}</option>`
      ).join('');
      row.innerHTML = `
        <button class="habit-delete-btn" data-hi="${hi}" title="Delete">&times;</button>
        <input type="text" class="daily-habit-name-input" value="${escapeHtml(habit.name)}" data-hi="${hi}">
        <div class="daily-habit-goal-group">
          <input type="number" class="daily-habit-target-input" value="${habit.target || ''}" placeholder="0" min="0" data-hi="${hi}">
          <select class="daily-habit-unit-select" data-hi="${hi}">${unitOptions}</select>
        </div>
        <select class="privacy-select" data-hi="${hi}">${privacyOptions}</select>
      `;
    } else if (!habit.name) {
      // New habit — checkbox + name + target + unit + privacy
      const unitOptions = HABIT_UNITS.map(u =>
        `<option value="${u.value}"${habit.unit === u.value ? ' selected' : ''}>${u.label}</option>`
      ).join('');
      const prv = habit.privacy || 'followers';
      const privacyOptions = PRIVACY_LEVELS.map(l =>
        `<option value="${l}"${prv === l ? ' selected' : ''}>${l === 'private' ? '🔒 Private' : l === 'followers' ? '👥 Followers' : '🌐 Public'}</option>`
      ).join('');
      row.innerHTML = `
        <div class="daily-list-check ${isDone ? 'checked' : ''}" data-habit-id="${habit.id}" data-di="${di}"></div>
        <input type="text" class="daily-habit-name-input" value="" placeholder="Habit name..." data-hi="${hi}">
        <div class="daily-habit-goal-group">
          <input type="number" class="daily-habit-target-input" value="${habit.target || ''}" placeholder="0" min="0" data-hi="${hi}">
          <select class="daily-habit-unit-select" data-hi="${hi}">${unitOptions}</select>
        </div>
        <select class="privacy-select" data-hi="${hi}">${privacyOptions}</select>
      `;
    } else {
      // Normal mode — checkbox + name + unit badge + drag handle (right)
      const unitLabel = isNumeric && habit.unit ? `${habit.target}${habit.unit}/day` : '';
      row.innerHTML = `
        <div class="daily-list-check ${isDone ? 'checked' : ''}" data-habit-id="${habit.id}" data-di="${di}"></div>
        <span class="daily-list-name">${escapeHtml(habit.name)}${unitLabel ? `<span class="daily-habit-unit-badge">${unitLabel}</span>` : ''}</span>
        <div class="drag-handle" title="Drag to reorder">⠿</div>
      `;
    }

    container.appendChild(row);
  });

  // Checkbox toggles
  container.querySelectorAll('.daily-list-check').forEach(check => {
    check.addEventListener('click', () => {
      const habitId = check.dataset.habitId;
      const dIdx = +check.dataset.di;
      const habit = state.habitDefs.find(h => h.id === habitId);
      const wd = currentWeekData();
      const hChecks = wd.habitChecks[habitId];

      let wasComplete, isNowComplete;
      if (habit.target > 0) {
        const cur = typeof hChecks[dIdx] === 'number' ? hChecks[dIdx] : 0;
        wasComplete = cur >= habit.target;
        hChecks[dIdx] = wasComplete ? 0 : habit.target;
        isNowComplete = !wasComplete;
      } else {
        wasComplete = !!hChecks[dIdx];
        hChecks[dIdx] = !hChecks[dIdx];
        isNowComplete = !wasComplete;
      }

      animateCheckCompletion(check, isNowComplete);
      saveState();
      renderDailyHabits();
      renderDailyHero();
      if (isNowComplete) checkAllDoneToday();
    });
  });

  // Delete buttons (edit mode)
  container.querySelectorAll('.habit-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const hi = +btn.dataset.hi;
      const habit = state.habitDefs[hi];
      showConfirm(
        'Delete Habit?',
        `Remove "${escapeHtml(habit.name)}" from all weeks?`,
        () => {
          // Remove from all weeks
          Object.values(state.weeks).forEach(wd => {
            delete wd.habitChecks[habit.id];
          });
          state.habitDefs.splice(hi, 1);
          saveState();
          renderDailyHabits();
          renderDailyHero();
        }
      );
    });
  });

  // Name inputs — save on blur/Enter
  container.querySelectorAll('.daily-habit-name-input').forEach(input => {
    function commitHabit(e) {
      const hi = +e.target.dataset.hi;
      const name = e.target.value.trim();
      state.habitDefs[hi].name = name;
      saveState();
      // In edit mode, don't collapse; for new habits, collapse when name is filled
      if (!habitsEditMode && name) renderDailyHabits();
    }
    input.addEventListener('blur', commitHabit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
  });

  // Target inputs — save silently
  container.querySelectorAll('.daily-habit-target-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const hi = +e.target.dataset.hi;
      const val = parseInt(e.target.value) || 0;
      state.habitDefs[hi].target = val;
      const wd = currentWeekData();
      const hId = state.habitDefs[hi].id;
      if (val > 0) {
        wd.habitChecks[hId] = wd.habitChecks[hId].map(v => typeof v === 'number' ? v : 0);
      } else {
        wd.habitChecks[hId] = wd.habitChecks[hId].map(v => typeof v === 'boolean' ? v : false);
      }
      saveState();
    });
  });

  // Unit selects — save silently
  container.querySelectorAll('.daily-habit-unit-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const hi = +e.target.dataset.hi;
      state.habitDefs[hi].unit = e.target.value;
      saveState();
    });
  });

  // Privacy dropdowns
  container.querySelectorAll('.privacy-select').forEach(select => {
    select.addEventListener('change', () => {
      const hi = +select.dataset.hi;
      state.habitDefs[hi].privacy = select.value;
      saveState();
    });
  });

  // Auto-focus last new habit input (only for new/unnamed habits)
  if (!habitsEditMode) {
    const newInputs = container.querySelectorAll('.daily-habit-name-input');
    if (newInputs.length) {
      const last = newInputs[newInputs.length - 1];
      if (!last.value) setTimeout(() => last.focus(), 50);
    }
  }

  // Button visibility
  const addBtn = document.getElementById('daily-add-habit-btn');
  if (addBtn) addBtn.style.display = state.habitDefs.length >= MAX_HABITS ? 'none' : '';
}

// ---- Render: Daily Tasks List ----
function renderDailyTasksList() {
  const container = document.getElementById('daily-tasks-list');
  const di = getViewingDayIndex();
  const weekData = currentWeekData();
  const day = weekData.days[di];

  container.innerHTML = '';

  day.tasks.forEach((task, ti) => {
    const row = document.createElement('div');
    row.className = `daily-list-row${task.done ? ' completed' : ''}`;
    const prv = task.privacy || 'followers';
    const privacyOptions = PRIVACY_LEVELS.map(l =>
      `<option value="${l}"${prv === l ? ' selected' : ''}>${l === 'private' ? '🔒 Private' : l === 'followers' ? '👥 Followers' : '🌐 Public'}</option>`
    ).join('');
    row.innerHTML = `
      <div class="daily-list-check ${task.done ? 'checked' : ''}" data-di="${di}" data-ti="${ti}"></div>
      <input type="text" class="daily-task-input" value="${escapeHtml(task.text)}" placeholder="Task name..." data-di="${di}" data-ti="${ti}">
      <select class="privacy-select task-privacy-select" data-di="${di}" data-ti="${ti}">${privacyOptions}</select>
      <button class="daily-task-delete" data-di="${di}" data-ti="${ti}" title="Remove">&times;</button>
      <div class="drag-handle" title="Drag to reorder">⠿</div>
    `;
    container.appendChild(row);
  });

  // Checkbox toggles
  container.querySelectorAll('.daily-list-check').forEach(check => {
    check.addEventListener('click', () => {
      const dIdx = +check.dataset.di;
      const tIdx = +check.dataset.ti;
      const wd = currentWeekData();
      const wasComplete = wd.days[dIdx].tasks[tIdx].done;
      wd.days[dIdx].tasks[tIdx].done = !wasComplete;
      const isNowComplete = !wasComplete;

      animateCheckCompletion(check, isNowComplete);
      saveState();
      renderDailyTasksList();
      renderDailyHero();
      if (isNowComplete) checkAllDoneToday();
    });
  });

  // Task text
  container.querySelectorAll('.daily-task-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const dIdx = +e.target.dataset.di;
      const tIdx = +e.target.dataset.ti;
      currentWeekData().days[dIdx].tasks[tIdx].text = e.target.value;
      saveState();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const dIdx = +e.target.dataset.di;
        const wd = currentWeekData();
        if (wd.days[dIdx].tasks.length < MAX_TASKS) {
          wd.days[dIdx].tasks.push({ text: '', done: false, privacy: 'followers' });
          saveState();
          renderDailyTasksList();
          renderDailyHero();
          const inputs = container.querySelectorAll('.daily-task-input');
          if (inputs.length) inputs[inputs.length - 1].focus();
        }
      }
    });
  });

  // Delete buttons
  container.querySelectorAll('.daily-task-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const dIdx = +btn.dataset.di;
      const tIdx = +btn.dataset.ti;
      currentWeekData().days[dIdx].tasks.splice(tIdx, 1);
      saveState();
      renderDailyTasksList();
      renderDailyHero();
    });
  });

  // Task privacy dropdowns
  container.querySelectorAll('.task-privacy-select').forEach(select => {
    select.addEventListener('change', () => {
      const dIdx = +select.dataset.di;
      const tIdx = +select.dataset.ti;
      currentWeekData().days[dIdx].tasks[tIdx].privacy = select.value;
      saveState();
    });
  });

  // Button visibility
  const addBtn = document.getElementById('daily-add-task-btn');
  if (addBtn) addBtn.style.display = day.tasks.length >= MAX_TASKS ? 'none' : '';
}

// ---- Init: Daily View ----
// (initDailyView removed — replaced by wireHabitsDailyEvents/wireTasksDailyEvents)

// ===== WEEKLY VIEW =====

// ---- Render: Weekly Hero ----
function renderWeeklyHero() {
  // Delegate to the correct hero based on current nav context
  if (navState.category === 'habits') {
    renderWeeklyHeroHabitsOnly();
  } else if (navState.category === 'tasks') {
    renderWeeklyHeroTasksOnly();
  }
}

// ---- Render: Weekly Habits Grid ----
function renderWeeklyHabitsGrid() {
  const container = document.getElementById('weekly-habits-grid');
  const dates = getWeekDates(state.currentWeek);
  const weekData = currentWeekData();
  const todayStr = dateToStr(new Date());

  container.innerHTML = '';

  // Day header row
  const header = document.createElement('div');
  header.className = 'weekly-habits-header';
  header.innerHTML = '<div></div>' + dates.map(d =>
    `<div class="weekly-habits-header-day">${DAY_SHORT[d.getDay()]}</div>`
  ).join('');
  container.appendChild(header);

  // Habit rows
  state.habitDefs.forEach((habit, hi) => {
    const checks = weekData.habitChecks[habit.id] || Array(7).fill(habit.target > 0 ? 0 : false);
    const isNumeric = habit.target > 0;

    if (!habit.name) {
      // New unnamed habit — show inline input row
      const unitOptions = HABIT_UNITS.map(u =>
        `<option value="${u.value}"${habit.unit === u.value ? ' selected' : ''}>${u.label}</option>`
      ).join('');
      const row = document.createElement('div');
      row.className = 'weekly-habit-new-row';
      row.innerHTML = `
        <input type="text" class="weekly-habit-new-input" value="" placeholder="Habit name..." data-hi="${hi}">
        <div class="daily-habit-goal-group">
          <input type="number" class="daily-habit-target-input" value="${habit.target || ''}" placeholder="0" min="0" data-hi="${hi}">
          <select class="daily-habit-unit-select" data-hi="${hi}">${unitOptions}</select>
        </div>
      `;
      container.appendChild(row);
      return;
    }

    const unitLabel = isNumeric && habit.unit ? `${habit.target}${habit.unit}` : '';

    const row = document.createElement('div');
    row.className = 'weekly-habit-row';

    // Name cell
    const nameHtml = `<div class="weekly-habit-name">${escapeHtml(habit.name)}${unitLabel ? `<span class="weekly-habit-unit">${unitLabel}</span>` : ''}</div>`;

    // Day cells
    const cellsHtml = checks.map((val, di) => {
      const isDone = isNumeric ? (typeof val === 'number' && val >= habit.target) : !!val;
      const isToday = dateToStr(dates[di]) === todayStr;
      return `<div class="weekly-habit-cell ${isDone ? 'checked' : ''} ${isToday ? 'today' : ''}" data-habit-id="${habit.id}" data-di="${di}"><div class="cell-box"></div></div>`;
    }).join('');

    row.innerHTML = nameHtml + cellsHtml;
    container.appendChild(row);
  });

  // Click handlers for cells
  container.querySelectorAll('.weekly-habit-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const habitId = cell.dataset.habitId;
      const di = +cell.dataset.di;
      const habit = state.habitDefs.find(h => h.id === habitId);
      const wd = currentWeekData();
      const hChecks = wd.habitChecks[habitId];

      if (habit.target > 0) {
        const cur = typeof hChecks[di] === 'number' ? hChecks[di] : 0;
        hChecks[di] = cur >= habit.target ? 0 : habit.target;
      } else {
        hChecks[di] = !hChecks[di];
      }

      saveState();
      renderWeeklyHabitsGrid();
      renderWeeklyHero();
      renderWeeklyBarChart();
    });
  });

  // New habit name inputs — commit on blur
  container.querySelectorAll('.weekly-habit-new-input').forEach(input => {
    function commitHabit(e) {
      const hi = +e.target.dataset.hi;
      const name = e.target.value.trim();
      state.habitDefs[hi].name = name;
      saveState();
      if (name) renderWeeklyHabitsGrid();
    }
    input.addEventListener('blur', commitHabit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
  });

  // New habit target inputs
  container.querySelectorAll('.daily-habit-target-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const hi = +e.target.dataset.hi;
      const val = parseInt(e.target.value) || 0;
      state.habitDefs[hi].target = val;
      const wd = currentWeekData();
      const hId = state.habitDefs[hi].id;
      if (val > 0) {
        wd.habitChecks[hId] = wd.habitChecks[hId].map(v => typeof v === 'number' ? v : 0);
      } else {
        wd.habitChecks[hId] = wd.habitChecks[hId].map(v => typeof v === 'boolean' ? v : false);
      }
      saveState();
    });
  });

  // New habit unit selects
  container.querySelectorAll('.daily-habit-unit-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const hi = +e.target.dataset.hi;
      state.habitDefs[hi].unit = e.target.value;
      saveState();
    });
  });

  // Auto-focus last new habit input
  const newInputs = container.querySelectorAll('.weekly-habit-new-input');
  if (newInputs.length) {
    const last = newInputs[newInputs.length - 1];
    if (!last.value) setTimeout(() => last.focus(), 50);
  }

  // Button visibility
  const addBtn = document.getElementById('weekly-add-habit-btn');
  if (addBtn) addBtn.style.display = state.habitDefs.length >= MAX_HABITS ? 'none' : '';
}

// ---- Render: Weekly Bar Chart ----
function renderWeeklyBarChart() {
  const canvas = document.getElementById('weekly-bar-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const weekData = currentWeekData();

  const w = canvas.parentElement.clientWidth;
  const h = window.innerWidth <= 600 ? 180 : 220;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);

  const dates = getWeekDates(state.currentWeek);
  const padding = { top: 20, right: 20, bottom: 44, left: 40 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  ctx.clearRect(0, 0, w, h);

  // Build per-day data
  const data = weekData.days.map((day, di) => {
    const totalTasks = day.tasks.length;
    const doneTasks = day.tasks.filter(t => t.done).length;
    const taskPct = totalTasks > 0 ? doneTasks / totalTasks : -1;

    let habitTotal = 0, habitDone = 0;
    state.habitDefs.forEach(habit => {
      const checks = weekData.habitChecks[habit.id];
      if (!checks) return;
      habitTotal++;
      const val = checks[di];
      if (habit.target > 0) {
        habitDone += Math.min((typeof val === 'number' ? val : 0) / habit.target, 1);
      } else {
        habitDone += val ? 1 : 0;
      }
    });
    const habitPct = habitTotal > 0 ? habitDone / habitTotal : -1;
    return { taskPct, habitPct };
  });

  const barGroupWidth = chartW / 7;
  const barWidth = barGroupWidth * 0.28;
  const gap = 3;

  // Grid lines
  ctx.strokeStyle = '#2e3345';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#8b8fa3';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= 5; i++) {
    const y = padding.top + chartH - (i / 5) * chartH;
    const val = Math.round((i / 5) * 100);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
    ctx.fillText(val + '%', padding.left - 8, y);
  }

  // Draw bars
  data.forEach((d, i) => {
    const centerX = padding.left + i * barGroupWidth + barGroupWidth / 2;

    // Habits bar (left)
    if (d.habitPct >= 0) {
      const hx = centerX - barWidth - gap / 2;
      ctx.fillStyle = 'rgba(97, 175, 239, 0.15)';
      roundedRect(ctx, hx, padding.top, barWidth, chartH, 4);
      const fillH = d.habitPct * chartH;
      if (fillH > 0) {
        ctx.fillStyle = 'rgba(97, 175, 239, 0.8)';
        roundedRect(ctx, hx, padding.top + chartH - fillH, barWidth, fillH, 4);
      }
    }

    // Tasks bar (right)
    if (d.taskPct >= 0) {
      const tx = centerX + gap / 2;
      ctx.fillStyle = 'rgba(224, 108, 117, 0.15)';
      roundedRect(ctx, tx, padding.top, barWidth, chartH, 4);
      const fillH = d.taskPct * chartH;
      if (fillH > 0) {
        ctx.fillStyle = '#00d4aa';
        roundedRect(ctx, tx, padding.top + chartH - fillH, barWidth, fillH, 4);
      }
    }

    // Day label
    ctx.fillStyle = '#8b8fa3';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(DAY_SHORT[dates[i].getDay()], centerX, padding.top + chartH + 8);
  });

  // Legend
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const legendY = h - 10;
  ctx.fillStyle = 'rgba(97, 175, 239, 0.8)';
  ctx.fillRect(padding.left, legendY - 5, 10, 10);
  ctx.fillStyle = '#8b8fa3';
  ctx.fillText('Habits', padding.left + 14, legendY);
  ctx.fillStyle = '#00d4aa';
  ctx.fillRect(padding.left + 65, legendY - 5, 10, 10);
  ctx.fillStyle = '#8b8fa3';
  ctx.fillText('Tasks', padding.left + 79, legendY);
}

// ---- Render: Weekly Tasks Grid ----
function renderWeeklyTasksGrid() {
  const container = document.getElementById('weekly-tasks-grid');
  const dates = getWeekDates(state.currentWeek);
  const weekData = currentWeekData();
  const todayStr = dateToStr(new Date());

  container.innerHTML = '';

  dates.forEach((date, di) => {
    const day = weekData.days[di];
    const isToday = dateToStr(date) === todayStr;

    const col = document.createElement('div');
    col.className = 'weekly-day-col';

    const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    let tasksHtml = day.tasks.map((task, ti) => `
      <div class="weekly-task-item ${task.done ? 'completed' : ''}">
        <div class="weekly-task-check ${task.done ? 'checked' : ''}" data-di="${di}" data-ti="${ti}"></div>
        <input type="text" class="weekly-task-input" value="${escapeHtml(task.text)}" placeholder="Task name..." data-di="${di}" data-ti="${ti}">
      </div>
    `).join('');

    col.innerHTML = `
      <div class="weekly-day-header ${isToday ? 'is-today' : ''}">
        <div class="weekly-day-header-name">${DAY_SHORT[date.getDay()]}</div>
        <div class="weekly-day-header-date">${monthDay}</div>
      </div>
      <div class="weekly-day-tasks">${tasksHtml}</div>
      ${day.tasks.length < MAX_TASKS ? `<button class="weekly-day-add" data-di="${di}">+ Add</button>` : ''}
    `;

    container.appendChild(col);
  });

  // Task check toggles
  container.querySelectorAll('.weekly-task-check').forEach(check => {
    check.addEventListener('click', () => {
      const di = +check.dataset.di;
      const ti = +check.dataset.ti;
      const wd = currentWeekData();
      wd.days[di].tasks[ti].done = !wd.days[di].tasks[ti].done;
      saveState();
      renderWeeklyTasksGrid();
      renderWeeklyHero();
      renderWeeklyBarChart();
    });
  });

  // Task text inputs
  container.querySelectorAll('.weekly-task-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const di = +e.target.dataset.di;
      const ti = +e.target.dataset.ti;
      currentWeekData().days[di].tasks[ti].text = e.target.value;
      saveState();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
  });

  // Add task buttons
  container.querySelectorAll('.weekly-day-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const di = +btn.dataset.di;
      const wd = currentWeekData();
      wd.days[di].tasks.push({ text: '', done: false, privacy: 'followers' });
      saveState();
      renderWeeklyTasksGrid();
      renderWeeklyHero();
      renderWeeklyBarChart();
      // Focus the newly added input
      const inputs = container.querySelectorAll(`.weekly-task-input[data-di="${di}"]`);
      if (inputs.length) setTimeout(() => inputs[inputs.length - 1].focus(), 50);
    });
  });
}

// ---- Init: Weekly View ----
// (initWeeklyView + renderWeeklyView removed — replaced by renderHabitsWeekly/renderTasksWeekly)

// ===== NEW SEPARATED VIEW RENDERERS =====

// -- Habits Daily --
function renderHabitsDaily() {
  const vc = document.getElementById('view-container');
  vc.innerHTML = `
    <div class="daily-hero">
      <button class="hero-nav-btn" id="hero-prev">&#8249;</button>
      <div class="hero-info">
        <div class="hero-day-name" id="hero-day-name">MONDAY</div>
        <div class="hero-day-date" id="hero-day-date">MAR 9</div>
        <div class="hero-bars">
          <div class="hero-bar-row"><span class="hero-bar-label">Habits</span><div class="hero-bar"><div class="hero-bar-fill" id="hero-habits-bar"></div></div></div>
        </div>
      </div>
      <div class="hero-donut-wrap">
        <canvas id="daily-overall-donut" width="100" height="100"></canvas>
      </div>
      <button class="hero-nav-btn" id="hero-next">&#8250;</button>
    </div>
    <div class="daily-card">
      <div class="daily-card-header">
        <div class="daily-card-title">Habits</div>
        <button class="card-edit-btn" id="habits-edit-btn" title="Edit habits">&#9998;</button>
      </div>
      <div class="daily-list" id="daily-habits-list"></div>
      <button class="daily-add-btn" id="daily-add-habit-btn">+ Add Habit</button>
    </div>
    <div class="daily-bottom-nav">
      <button class="bottom-nav-arrow" id="bottom-prev">&#8592;</button>
      <span class="bottom-nav-day" id="bottom-nav-day">Monday</span>
      <button class="bottom-nav-arrow" id="bottom-next">&#8594;</button>
    </div>
  `;
  wireHabitsDailyEvents();
  renderDailyHeroHabitsOnly();
  renderDailyHabits();
}

function wireHabitsDailyEvents() {
  document.getElementById('hero-prev').addEventListener('click', () => navigateViewDay(-1));
  document.getElementById('hero-next').addEventListener('click', () => navigateViewDay(1));
  document.getElementById('bottom-prev').addEventListener('click', () => navigateViewDay(-1));
  document.getElementById('bottom-next').addEventListener('click', () => navigateViewDay(1));
  document.getElementById('habits-edit-btn').addEventListener('click', () => {
    habitsEditMode = !habitsEditMode;
    renderDailyHabits();
  });
  document.getElementById('daily-add-habit-btn').addEventListener('click', () => {
    if (state.habitDefs.length >= MAX_HABITS) return;
    habitsEditMode = false;
    const id = generateId();
    state.habitDefs.push({ id, name: '', target: 0, unit: '', privacy: 'followers' });
    const wd = currentWeekData();
    wd.habitChecks[id] = Array(7).fill(false);
    saveState();
    renderDailyHabits();
  });
  initDragAndDrop(
    document.getElementById('daily-habits-list'),
    () => state.habitDefs,
    (items) => { state.habitDefs = items; },
    (fromIdx, toIdx) => {
      const item = state.habitDefs.splice(fromIdx, 1)[0];
      state.habitDefs.splice(toIdx, 0, item);
      saveState();
      renderDailyHabits();
    }
  );
}

function renderDailyHeroHabitsOnly() {
  const di = getViewingDayIndex();
  const weekData = currentWeekData();
  document.getElementById('hero-day-name').textContent = DAY_NAMES[viewingDate.getDay()].toUpperCase();
  const monthShort = viewingDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  document.getElementById('hero-day-date').textContent = `${monthShort} ${viewingDate.getDate()}`;
  const navDay = document.getElementById('bottom-nav-day');
  if (navDay) navDay.textContent = DAY_NAMES[viewingDate.getDay()];

  let habitsDone = 0, habitsTotal = 0;
  state.habitDefs.forEach(habit => {
    const checks = weekData.habitChecks[habit.id];
    if (!checks) return;
    habitsTotal++;
    const val = checks[di];
    if (habit.target > 0) {
      habitsDone += Math.min((typeof val === 'number' ? val : 0) / habit.target, 1);
    } else {
      habitsDone += val ? 1 : 0;
    }
  });
  const habitsPct = habitsTotal > 0 ? habitsDone / habitsTotal : 0;
  document.getElementById('hero-habits-bar').style.width = `${Math.round(habitsPct * 100)}%`;

  const canvas = document.getElementById('daily-overall-donut');
  if (canvas) drawDonut(canvas, habitsTotal > 0 ? habitsPct : -1, '—', 100);
}

// -- Tasks Daily --
function renderTasksDaily() {
  const vc = document.getElementById('view-container');
  vc.innerHTML = `
    <div class="daily-hero">
      <button class="hero-nav-btn" id="hero-prev">&#8249;</button>
      <div class="hero-info">
        <div class="hero-day-name" id="hero-day-name">MONDAY</div>
        <div class="hero-day-date" id="hero-day-date">MAR 9</div>
        <div class="hero-bars">
          <div class="hero-bar-row"><span class="hero-bar-label">Tasks</span><div class="hero-bar"><div class="hero-bar-fill" id="hero-tasks-bar"></div></div></div>
        </div>
      </div>
      <div class="hero-donut-wrap">
        <canvas id="daily-overall-donut" width="100" height="100"></canvas>
      </div>
      <button class="hero-nav-btn" id="hero-next">&#8250;</button>
    </div>
    <div class="daily-card">
      <div class="daily-card-title">Tasks</div>
      <div class="daily-list" id="daily-tasks-list"></div>
      <button class="daily-add-btn" id="daily-add-task-btn">+ Add Task</button>
    </div>
    <div class="daily-bottom-nav">
      <button class="bottom-nav-arrow" id="bottom-prev">&#8592;</button>
      <span class="bottom-nav-day" id="bottom-nav-day">Monday</span>
      <button class="bottom-nav-arrow" id="bottom-next">&#8594;</button>
    </div>
  `;
  wireTasksDailyEvents();
  renderDailyHeroTasksOnly();
  renderDailyTasksList();
}

function wireTasksDailyEvents() {
  document.getElementById('hero-prev').addEventListener('click', () => navigateViewDay(-1));
  document.getElementById('hero-next').addEventListener('click', () => navigateViewDay(1));
  document.getElementById('bottom-prev').addEventListener('click', () => navigateViewDay(-1));
  document.getElementById('bottom-next').addEventListener('click', () => navigateViewDay(1));
  document.getElementById('daily-add-task-btn').addEventListener('click', () => {
    const di = getViewingDayIndex();
    const wd = currentWeekData();
    if (wd.days[di].tasks.length >= MAX_TASKS) return;
    wd.days[di].tasks.push({ text: '', done: false, privacy: 'followers' });
    saveState();
    renderDailyTasksList();
    renderDailyHeroTasksOnly();
    const inputs = document.querySelectorAll('#daily-tasks-list .daily-task-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  initDragAndDrop(
    document.getElementById('daily-tasks-list'),
    () => { const di = getViewingDayIndex(); return currentWeekData().days[di].tasks; },
    (items) => { const di = getViewingDayIndex(); currentWeekData().days[di].tasks = items; },
    (fromIdx, toIdx) => {
      const di = getViewingDayIndex();
      const tasks = currentWeekData().days[di].tasks;
      const item = tasks.splice(fromIdx, 1)[0];
      tasks.splice(toIdx, 0, item);
      saveState();
      renderDailyTasksList();
    }
  );
}

function renderDailyHeroTasksOnly() {
  const di = getViewingDayIndex();
  const weekData = currentWeekData();
  const day = weekData.days[di];
  document.getElementById('hero-day-name').textContent = DAY_NAMES[viewingDate.getDay()].toUpperCase();
  const monthShort = viewingDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  document.getElementById('hero-day-date').textContent = `${monthShort} ${viewingDate.getDate()}`;
  const navDay = document.getElementById('bottom-nav-day');
  if (navDay) navDay.textContent = DAY_NAMES[viewingDate.getDay()];

  const totalTasks = day.tasks.length;
  const completedTasks = day.tasks.filter(t => t.done).length;
  const tasksPct = totalTasks > 0 ? completedTasks / totalTasks : 0;
  document.getElementById('hero-tasks-bar').style.width = `${Math.round(tasksPct * 100)}%`;

  const canvas = document.getElementById('daily-overall-donut');
  if (canvas) drawDonut(canvas, totalTasks > 0 ? tasksPct : -1, '—', 100);
}

// -- Habits Weekly --
function renderHabitsWeekly() {
  const vc = document.getElementById('view-container');
  vc.innerHTML = `
    <div class="week-hero">
      <button class="hero-nav-btn" id="week-prev">&#8249;</button>
      <div class="week-hero-info">
        <div class="week-hero-label" id="week-hero-label">WEEK OF MAR 2</div>
        <div class="week-hero-bars">
          <div class="hero-bar-row"><span class="hero-bar-label">Habits</span><div class="hero-bar"><div class="hero-bar-fill" id="week-habits-bar"></div></div></div>
        </div>
      </div>
      <div class="hero-donut-wrap">
        <canvas id="weekly-overall-donut" width="100" height="100"></canvas>
      </div>
      <button class="hero-nav-btn" id="week-next">&#8250;</button>
    </div>
    <div class="weekly-card">
      <div class="weekly-card-title">Habits</div>
      <div class="weekly-habits-grid" id="weekly-habits-grid"></div>
      <button class="daily-add-btn" id="weekly-add-habit-btn">+ Add Habit</button>
    </div>
    <div class="weekly-card">
      <div class="weekly-card-title">Weekly Overview</div>
      <div class="weekly-chart-wrap">
        <canvas id="weekly-bar-chart"></canvas>
      </div>
    </div>
  `;
  wireWeekNavEvents();
  document.getElementById('weekly-add-habit-btn').addEventListener('click', () => {
    if (state.habitDefs.length >= MAX_HABITS) return;
    const id = generateId();
    state.habitDefs.push({ id, name: '', target: 0, unit: '', privacy: 'followers' });
    const wd = currentWeekData();
    wd.habitChecks[id] = Array(7).fill(false);
    saveState();
    renderWeeklyHabitsGrid();
    renderWeeklyHeroHabitsOnly();
  });
  renderWeeklyHeroHabitsOnly();
  renderWeeklyHabitsGrid();
  renderWeeklyBarChart();
}

function wireWeekNavEvents() {
  document.getElementById('week-prev').addEventListener('click', () => {
    const d = new Date(state.currentWeek + 'T00:00:00');
    d.setDate(d.getDate() - 7);
    state.currentWeek = dateToStr(d);
    viewingDate = new Date(state.currentWeek + 'T00:00:00');
    document.getElementById('week-start').value = state.currentWeek;
    saveState();
    renderAll();
  });
  document.getElementById('week-next').addEventListener('click', () => {
    const d = new Date(state.currentWeek + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    state.currentWeek = dateToStr(d);
    viewingDate = new Date(state.currentWeek + 'T00:00:00');
    document.getElementById('week-start').value = state.currentWeek;
    saveState();
    renderAll();
  });
}

function renderWeeklyHeroHabitsOnly() {
  const dates = getWeekDates(state.currentWeek);
  const startDate = dates[0];
  const monthShort = startDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  document.getElementById('week-hero-label').textContent = `WEEK OF ${monthShort} ${startDate.getDate()}`;

  const weekly = calculateWeeklyProgress();
  document.getElementById('week-habits-bar').style.width =
    weekly.habitsPct >= 0 ? `${Math.round(weekly.habitsPct * 100)}%` : '0%';

  const canvas = document.getElementById('weekly-overall-donut');
  if (canvas) drawDonut(canvas, weekly.habitsPct >= 0 ? weekly.habitsPct : -1, '—', 100);
}

// -- Tasks Weekly --
function renderTasksWeekly() {
  const vc = document.getElementById('view-container');
  vc.innerHTML = `
    <div class="week-hero">
      <button class="hero-nav-btn" id="week-prev">&#8249;</button>
      <div class="week-hero-info">
        <div class="week-hero-label" id="week-hero-label">WEEK OF MAR 2</div>
        <div class="week-hero-bars">
          <div class="hero-bar-row"><span class="hero-bar-label">Tasks</span><div class="hero-bar"><div class="hero-bar-fill" id="week-tasks-bar"></div></div></div>
        </div>
      </div>
      <div class="hero-donut-wrap">
        <canvas id="weekly-overall-donut" width="100" height="100"></canvas>
      </div>
      <button class="hero-nav-btn" id="week-next">&#8250;</button>
    </div>
    <div class="weekly-card">
      <div class="weekly-card-title">Tasks</div>
      <div class="weekly-tasks-grid" id="weekly-tasks-grid"></div>
    </div>
  `;
  wireWeekNavEvents();
  renderWeeklyHeroTasksOnly();
  renderWeeklyTasksGrid();
}

function renderWeeklyHeroTasksOnly() {
  const dates = getWeekDates(state.currentWeek);
  const startDate = dates[0];
  const monthShort = startDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  document.getElementById('week-hero-label').textContent = `WEEK OF ${monthShort} ${startDate.getDate()}`;

  const weekly = calculateWeeklyProgress();
  document.getElementById('week-tasks-bar').style.width =
    weekly.tasksPct >= 0 ? `${Math.round(weekly.tasksPct * 100)}%` : '0%';

  const canvas = document.getElementById('weekly-overall-donut');
  if (canvas) drawDonut(canvas, weekly.tasksPct >= 0 ? weekly.tasksPct : -1, '—', 100);
}

// -- Challenges View (reuses existing) --
function renderChallengesView() {
  const vc = document.getElementById('view-container');
  vc.innerHTML = `
    <div class="ch-sub-tabs">
      <button class="ch-sub-tab ${chSubView === 'my' ? 'active' : ''}" data-ch-view="my">My Challenges</button>
      <button class="ch-sub-tab ${chSubView === 'browse' ? 'active' : ''}" data-ch-view="browse">Browse</button>
    </div>
    <div class="ch-section ${chSubView === 'my' ? 'active' : ''}" id="ch-my-section">
      <div class="ch-list" id="ch-my-list"></div>
      <div class="ch-empty" id="ch-my-empty">No active challenges yet</div>
      <button class="ch-create-btn" id="ch-create-btn">+ Create Challenge</button>
    </div>
    <div class="ch-section ${chSubView === 'browse' ? 'active' : ''}" id="ch-browse-section">
      <div class="social-search-wrap">
        <input type="text" class="social-search-input" id="ch-browse-search" placeholder="Search challenges..." autocomplete="off">
      </div>
      <div class="ch-list" id="ch-browse-list"></div>
      <div class="ch-empty" id="ch-browse-empty" style="display:none">No public challenges found</div>
    </div>
  `;
  wireChallengesViewEvents();
  renderChallengesTab();
}

function wireChallengesViewEvents() {
  document.querySelectorAll('.ch-sub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      chSubView = tab.dataset.chView;
      document.querySelectorAll('.ch-sub-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.ch-section').forEach(s => s.classList.remove('active'));
      document.getElementById(chSubView === 'my' ? 'ch-my-section' : 'ch-browse-section').classList.add('active');
      collapseAllChallengeCards();
      if (chSubView === 'my') renderMyChallenges();
      else renderBrowseChallenges();
    });
  });
  document.getElementById('ch-create-btn').addEventListener('click', openChallengeCreate);
  const browseSearch = document.getElementById('ch-browse-search');
  if (browseSearch) {
    browseSearch.addEventListener('input', (e) => {
      clearTimeout(chSearchTimer);
      const q = e.target.value.trim();
      chSearchTimer = setTimeout(() => renderBrowseChallenges(q), 400);
    });
  }
}

function renderChallengesMonthlyView() {
  const vc = document.getElementById('view-container');
  const year = viewingMonth.getFullYear();
  const month = viewingMonth.getMonth();
  const monthName = viewingMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();

  vc.innerHTML = `
    <div class="month-hero">
      <button class="hero-nav-btn" id="month-prev">&#8249;</button>
      <div class="month-hero-label">${monthName}</div>
      <button class="hero-nav-btn" id="month-next">&#8250;</button>
    </div>
    <div class="daily-card" style="padding:16px">
      <div class="daily-card-title" style="margin-bottom:12px">Challenges This Month</div>
      <div id="ch-month-list"></div>
    </div>
  `;
  wireMonthNavEvents();
  renderChallengesMonthContent();
}

async function renderChallengesMonthContent() {
  const container = document.getElementById('ch-month-list');
  if (!container || !window.challengeSync) return;
  container.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:8px 0">Loading...</div>';
  try {
    const challenges = await window.challengeSync.loadMyChallenges();
    const monthStr = dateToStr(viewingMonth).substring(0, 7);
    const active = challenges.filter(c => {
      const start = (c.startDate || '').substring(0, 7);
      const end = (c.endDate || '').substring(0, 7);
      return start <= monthStr && end >= monthStr;
    });
    if (active.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:8px 0">No challenges this month</div>';
      return;
    }
    container.innerHTML = active.map(c => `
      <div class="dash-challenge-item">
        <div class="dash-challenge-title">${escapeHtml(c.title || '')}</div>
        <div class="dash-challenge-meta">${formatShortDate(c.startDate)} - ${formatShortDate(c.endDate)}</div>
      </div>
    `).join('');
  } catch(e) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:13px">Could not load challenges</div>';
  }
}

// ===== MONTHLY VIEWS =====

function getMonthData(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const result = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const weekStart = getMonday(date);
    const dayIndex = (date.getDay() + 6) % 7;
    const weekData = getWeekData(weekStart);
    result.push({
      date,
      dayIndex,
      weekStart,
      weekData,
      tasks: weekData.days[dayIndex] ? weekData.days[dayIndex].tasks : []
    });
  }
  return result;
}

function wireMonthNavEvents() {
  document.getElementById('month-prev').addEventListener('click', () => {
    viewingMonth.setMonth(viewingMonth.getMonth() - 1);
    renderAll();
  });
  document.getElementById('month-next').addEventListener('click', () => {
    viewingMonth.setMonth(viewingMonth.getMonth() + 1);
    renderAll();
  });
}

function wireMonthCellClicks() {
  document.querySelectorAll('.month-cal-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.dataset.date;
      viewingDate = new Date(dateStr + 'T00:00:00');
      syncViewingWeek();
      navState.scope = 'daily';
      updateNavActiveStates();
      triggerHaptic('light');
      renderAll();
    });
  });
}

function renderHabitsMonthly() {
  const vc = document.getElementById('view-container');
  const year = viewingMonth.getFullYear();
  const month = viewingMonth.getMonth();
  const monthName = viewingMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  const monthData = getMonthData(year, month);
  const todayStr = dateToStr(new Date());

  // Stats
  let perfectDays = 0, totalPct = 0, trackedDays = 0;
  monthData.forEach(d => {
    if (state.habitDefs.length === 0) return;
    let done = 0;
    state.habitDefs.forEach(h => {
      const checks = d.weekData.habitChecks[h.id];
      if (!checks) return;
      const val = checks[d.dayIndex];
      if (h.target > 0) { done += Math.min((typeof val === 'number' ? val : 0) / h.target, 1); }
      else { done += val ? 1 : 0; }
    });
    const pct = done / state.habitDefs.length;
    totalPct += pct;
    trackedDays++;
    if (pct >= 1) perfectDays++;
  });
  const avgPct = trackedDays > 0 ? Math.round((totalPct / trackedDays) * 100) : 0;

  // Calendar grid
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = monthData.length;
  const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  let cellsHtml = '';
  for (let i = 0; i < startOffset; i++) cellsHtml += '<div class="month-cal-cell empty"></div>';
  monthData.forEach((d, idx) => {
    const dayNum = idx + 1;
    const dateStr = dateToStr(d.date);
    const isToday = dateStr === todayStr;
    let cls = 'month-cal-cell';
    if (isToday) cls += ' today';
    let pct = 0;
    if (state.habitDefs.length > 0) {
      let done = 0;
      state.habitDefs.forEach(h => {
        const checks = d.weekData.habitChecks[h.id];
        if (!checks) return;
        const val = checks[d.dayIndex];
        if (h.target > 0) { done += (typeof val === 'number' && val >= h.target) ? 1 : 0; }
        else { done += val ? 1 : 0; }
      });
      pct = Math.round((done / state.habitDefs.length) * 100);
      cls += ' has-data';
      if (done === state.habitDefs.length) cls += ' done-all';
      else if (done > 0) cls += ' done-partial';
      else cls += ' done-none';
    }
    // SVG progress ring: r=15.915 → circumference ≈ 100
    const dash = pct;
    const gap = 100 - dash;
    const ringColor = pct >= 100 ? 'var(--accent)' : pct > 0 ? 'var(--yellow)' : 'var(--border-hover)';
    const ringHtml = `<svg class="month-cal-ring" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="15.915" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="2.5"/>
      ${pct > 0 ? `<circle cx="18" cy="18" r="15.915" fill="none" stroke="${ringColor}" stroke-width="2.5" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="25" stroke-linecap="round" transform="rotate(-90 18 18)"/>` : ''}
    </svg>`;
    cellsHtml += `<div class="${cls}" data-date="${dateStr}">${ringHtml}<span class="month-cal-num">${dayNum}</span></div>`;
  });

  vc.innerHTML = `
    <div class="month-hero">
      <button class="hero-nav-btn" id="month-prev">&#8249;</button>
      <div class="month-hero-label">${monthName}</div>
      <button class="hero-nav-btn" id="month-next">&#8250;</button>
    </div>
    <div class="month-summary">
      <div class="month-stat"><div class="month-stat-value">${perfectDays}</div><div class="month-stat-label">Perfect Days</div></div>
      <div class="month-stat"><div class="month-stat-value">${avgPct}%</div><div class="month-stat-label">Avg Completion</div></div>
    </div>
    <div class="month-calendar">
      <div class="month-cal-header">${dayLabels.map(d => `<div class="month-cal-day-label">${d}</div>`).join('')}</div>
      <div class="month-cal-grid">${cellsHtml}</div>
    </div>
  `;
  wireMonthNavEvents();
  wireMonthCellClicks();
}

function renderTasksMonthly() {
  const vc = document.getElementById('view-container');
  const year = viewingMonth.getFullYear();
  const month = viewingMonth.getMonth();
  const monthName = viewingMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  const monthData = getMonthData(year, month);
  const todayStr = dateToStr(new Date());

  // Stats
  let totalDone = 0, totalAll = 0;
  monthData.forEach(d => {
    totalDone += d.tasks.filter(t => t.done).length;
    totalAll += d.tasks.length;
  });
  const pct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0;

  // Calendar grid
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  let cellsHtml = '';
  for (let i = 0; i < startOffset; i++) cellsHtml += '<div class="month-cal-cell empty"></div>';
  monthData.forEach((d, idx) => {
    const dayNum = idx + 1;
    const dateStr = dateToStr(d.date);
    const isToday = dateStr === todayStr;
    const done = d.tasks.filter(t => t.done).length;
    const total = d.tasks.length;
    let cls = 'month-cal-cell';
    if (isToday) cls += ' today';
    let dayPct = 0;
    if (total > 0) {
      dayPct = Math.round((done / total) * 100);
      cls += ' has-data';
      if (done === total) cls += ' done-all';
      else if (done > 0) cls += ' done-partial';
      else cls += ' done-none';
    }
    // SVG progress ring
    const dash = dayPct;
    const gap = 100 - dash;
    const ringColor = dayPct >= 100 ? 'var(--accent)' : dayPct > 0 ? 'var(--yellow)' : 'var(--border-hover)';
    const ringHtml = `<svg class="month-cal-ring" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="15.915" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="2.5"/>
      ${dayPct > 0 ? `<circle cx="18" cy="18" r="15.915" fill="none" stroke="${ringColor}" stroke-width="2.5" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="25" stroke-linecap="round" transform="rotate(-90 18 18)"/>` : ''}
    </svg>`;
    const badge = total > 0 ? `<span class="month-cal-badge">${done}/${total}</span>` : '';
    cellsHtml += `<div class="${cls}" data-date="${dateStr}">${ringHtml}<span class="month-cal-num">${dayNum}</span>${badge}</div>`;
  });

  vc.innerHTML = `
    <div class="month-hero">
      <button class="hero-nav-btn" id="month-prev">&#8249;</button>
      <div class="month-hero-label">${monthName}</div>
      <button class="hero-nav-btn" id="month-next">&#8250;</button>
    </div>
    <div class="month-summary">
      <div class="month-stat"><div class="month-stat-value">${totalDone}/${totalAll}</div><div class="month-stat-label">Tasks Done</div></div>
      <div class="month-stat"><div class="month-stat-value">${pct}%</div><div class="month-stat-label">Completion</div></div>
    </div>
    <div class="month-calendar">
      <div class="month-cal-header">${dayLabels.map(d => `<div class="month-cal-day-label">${d}</div>`).join('')}</div>
      <div class="month-cal-grid">${cellsHtml}</div>
    </div>
  `;
  wireMonthNavEvents();
  wireMonthCellClicks();
}

// ---- Navigation ----
function initNav() {
  // Bottom nav (mobile)
  document.querySelectorAll('.bottom-nav-item[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      navState.category = btn.dataset.category;
      updateNavActiveStates();
      renderAll();
    });
  });

  // Bottom nav avatar
  const bottomAvatar = document.getElementById('bottom-nav-avatar');
  if (bottomAvatar) {
    bottomAvatar.addEventListener('click', openDashboard);
  }

  // Side panel nav (desktop)
  document.querySelectorAll('.side-nav-item[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      navState.category = btn.dataset.category;
      updateNavActiveStates();
      renderAll();
    });
  });

  // Side panel avatar
  const sideAvatar = document.getElementById('side-panel-avatar');
  if (sideAvatar) {
    sideAvatar.addEventListener('click', openDashboard);
  }

  // Scope tabs
  document.querySelectorAll('.scope-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      navState.scope = tab.dataset.scope;
      document.querySelectorAll('.scope-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderAll();
    });
  });
}

function updateNavActiveStates() {
  // Bottom nav
  document.querySelectorAll('.bottom-nav-item[data-category]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === navState.category);
  });
  // Side panel
  document.querySelectorAll('.side-nav-item[data-category]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === navState.category);
  });
  // Scope tabs
  document.querySelectorAll('.scope-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.scope === navState.scope);
  });
}

// ---- Render All ----
function renderAll() {
  const key = navState.category + '_' + navState.scope;
  switch (key) {
    case 'habits_daily':
      syncViewingWeek();
      renderHabitsDaily();
      break;
    case 'habits_weekly':
      renderHabitsWeekly();
      break;
    case 'habits_monthly':
      renderHabitsMonthly();
      break;
    case 'tasks_daily':
      syncViewingWeek();
      renderTasksDaily();
      break;
    case 'tasks_weekly':
      renderTasksWeekly();
      break;
    case 'tasks_monthly':
      renderTasksMonthly();
      break;
    case 'challenges_daily':
    case 'challenges_weekly':
      renderChallengesView();
      break;
    case 'challenges_monthly':
      renderChallengesMonthlyView();
      break;
    default:
      document.getElementById('view-container').innerHTML = '';
  }
}

// ---- Dashboard ----
let dashboardOpen = false;
let dashSocialListMode = 'following';

function initDashboard() {
  const profileBtn = document.getElementById('profile-btn');
  const overlay = document.getElementById('dashboard-overlay');
  const closeBtn = document.getElementById('dashboard-back');

  profileBtn.addEventListener('click', openDashboard);
  closeBtn.addEventListener('click', closeDashboard);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDashboard();
  });

  updateProfileButton();
}

function openDashboard() {
  dashboardOpen = true;
  renderDashboard();
  document.getElementById('dashboard-overlay').classList.add('visible');
}

function closeDashboard() {
  dashboardOpen = false;
  document.getElementById('dashboard-overlay').classList.remove('visible');
}

async function renderDashboard() {
  const user = window.firebaseUser;
  const p = state.profile || {};

  const photoURL = (user && user.photoURL) || p.photoURL || '';
  const displayName = (user && user.displayName) || ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
  const initial = (displayName || '?').charAt(0).toUpperCase();
  const nickname = p.nickname || '';
  const country = p.country || '';

  // Compute age from dob
  let ageStr = '';
  if (p.dob) {
    const birth = new Date(p.dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    if (age > 0) ageStr = age + ' y/o';
  }

  // Photo
  const photoEl = document.getElementById('dashboard-photo');
  if (photoURL) {
    photoEl.innerHTML = '<img src="' + photoURL + '" alt="" referrerpolicy="no-referrer">';
  } else {
    photoEl.innerHTML = '<span class="dashboard-photo-initial">' + initial + '</span>';
  }

  document.getElementById('dashboard-name').textContent = displayName || '';
  document.getElementById('dashboard-nickname').textContent = nickname ? '@' + nickname : '';

  const metaParts = [];
  if (ageStr) metaParts.push(ageStr);
  if (country) metaParts.push(country);
  document.getElementById('dashboard-meta').textContent = metaParts.join(' · ');

  // Social stats
  if (window.socialSync) {
    try {
      const counts = await window.socialSync.getMyProfileCounts();
      document.getElementById('dash-followers-count').textContent = Math.max(0, counts.followersCount);
      document.getElementById('dash-following-count').textContent = Math.max(0, counts.followingCount);
    } catch(e) {}
  }

  // Wire social stat buttons
  const followersBtn = document.getElementById('dash-followers-btn');
  const followingBtn = document.getElementById('dash-following-btn');
  followersBtn.onclick = () => { dashSocialListMode = 'followers'; renderDashSocialList(); };
  followingBtn.onclick = () => { dashSocialListMode = 'following'; renderDashSocialList(); };

  // Edit profile button
  document.getElementById('dashboard-edit-btn').onclick = toggleDashEditForm;

  // Search
  const searchInput = document.getElementById('dash-search');
  searchInput.value = '';
  document.getElementById('dash-search-results').innerHTML = '';
  searchInput.oninput = () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { document.getElementById('dash-search-results').innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      if (!window.socialSync) return;
      const results = await window.socialSync.searchUsers(q);
      renderDashSearchResults(results);
    }, 400);
  };

  // Challenges
  renderDashChallenges();

  // Achievements
  renderDashAchievements();

  // Feed
  renderDashFeed();
}

function renderDashSearchResults(results) {
  const container = document.getElementById('dash-search-results');
  container.innerHTML = '';
  if (results.length === 0) {
    container.innerHTML = '<div class="social-search-empty">No users found</div>';
    return;
  }
  results.forEach(u => {
    const row = createUserRow(u.uid, u.displayName || u.email, u.photoURL, true);
    container.appendChild(row);
  });
}

async function renderDashSocialList() {
  const container = document.getElementById('dash-social-list');
  const listEl = document.getElementById('dashboard-social-list');
  const titleEl = document.getElementById('dash-social-list-title');
  listEl.style.display = '';
  titleEl.textContent = dashSocialListMode === 'following' ? 'Following' : 'Followers';
  container.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:8px">Loading...</div>';

  if (!window.socialSync || !window.firebaseUser) return;
  const list = dashSocialListMode === 'following'
    ? await window.socialSync.loadFollowing(window.firebaseUser.uid)
    : await window.socialSync.loadFollowers(window.firebaseUser.uid);

  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:8px">' +
      (dashSocialListMode === 'following' ? 'Not following anyone yet' : 'No followers yet') + '</div>';
    return;
  }
  list.forEach(u => {
    container.appendChild(createUserRow(u.uid, u.displayName, u.photoURL, false));
  });
}

async function renderDashChallenges() {
  const container = document.getElementById('dash-challenges-list');
  if (!container) return;
  if (!window.challengeSync) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:13px">Sign in to see challenges</div>';
    return;
  }
  try {
    const challenges = await window.challengeSync.loadMyChallenges();
    const active = challenges.filter(c => {
      const status = computeChallengeStatus(c.startDate, c.endDate);
      return status === 'active' || status === 'upcoming';
    });
    if (active.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:13px">No active challenges</div>';
      return;
    }
    container.innerHTML = active.slice(0, 5).map(c => `
      <div class="dash-challenge-item">
        <div class="dash-challenge-title">${escapeHtml(c.title || '')}</div>
        <div class="dash-challenge-meta">${formatShortDate(c.startDate)} - ${formatShortDate(c.endDate)} · ${c.role || 'participant'}</div>
      </div>
    `).join('');
  } catch(e) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:13px">Could not load</div>';
  }
}

// ---- Achievements ----
const ACHIEVEMENTS = [
  { id: 'first_habit', name: 'First Habit', icon: '&#x1f331;', desc: 'Create your first habit', check: () => state.habitDefs.length > 0 },
  { id: 'five_habits', name: '5 Habits', icon: '&#x1f4aa;', desc: 'Have 5 habits at once', check: () => state.habitDefs.filter(h => h.name).length >= 5 },
  { id: 'perfect_day', name: 'Perfect Day', icon: '&#x2b50;', desc: 'Complete all habits in a day', check: () => checkPerfectDay() },
  { id: 'week_warrior', name: 'Week Warrior', icon: '&#x1f525;', desc: 'Complete all habits for a full week', check: () => checkPerfectWeek() },
  { id: 'task_master', name: 'Task Master', icon: '&#x2705;', desc: 'Complete 10+ tasks in a day', check: () => checkTaskMaster() },
  { id: 'challenger', name: 'Challenger', icon: '&#x1f3c6;', desc: 'Join a challenge', check: () => (state.achievements || []).includes('challenger') },
];

function checkPerfectDay() {
  if (state.habitDefs.length === 0) return false;
  const weekData = currentWeekData();
  for (let di = 0; di < 7; di++) {
    let allDone = true;
    state.habitDefs.forEach(h => {
      const checks = weekData.habitChecks[h.id];
      if (!checks) { allDone = false; return; }
      const val = checks[di];
      if (h.target > 0) { if (typeof val !== 'number' || val < h.target) allDone = false; }
      else { if (!val) allDone = false; }
    });
    if (allDone) return true;
  }
  return false;
}

function checkPerfectWeek() {
  if (state.habitDefs.length === 0) return false;
  const weekData = currentWeekData();
  for (let di = 0; di < 7; di++) {
    let allDone = true;
    state.habitDefs.forEach(h => {
      const checks = weekData.habitChecks[h.id];
      if (!checks) { allDone = false; return; }
      const val = checks[di];
      if (h.target > 0) { if (typeof val !== 'number' || val < h.target) allDone = false; }
      else { if (!val) allDone = false; }
    });
    if (!allDone) return false;
  }
  return true;
}

function checkTaskMaster() {
  const weekData = currentWeekData();
  for (let di = 0; di < 7; di++) {
    const tasks = weekData.days[di].tasks;
    if (tasks.length >= 10 && tasks.every(t => t.done)) return true;
  }
  return false;
}

function computeAchievements() {
  if (!state.achievements) state.achievements = [];
  let changed = false;
  ACHIEVEMENTS.forEach(a => {
    if (!state.achievements.includes(a.id) && a.check()) {
      state.achievements.push(a.id);
      changed = true;
    }
  });
  if (changed) saveState();
}

function renderDashAchievements() {
  computeAchievements();
  const container = document.getElementById('dash-achievements-grid');
  if (!container) return;
  container.innerHTML = ACHIEVEMENTS.map(a => {
    const earned = (state.achievements || []).includes(a.id);
    return `
      <div class="achievement-badge ${earned ? 'earned' : ''}" title="${a.desc}">
        <span class="achievement-badge-icon">${earned ? a.icon : '&#x2753;'}</span>
        <span class="achievement-badge-name">${a.name}</span>
      </div>
    `;
  }).join('');
}

function renderDashFeed() {
  const container = document.getElementById('dash-feed');
  if (!container) return;
  const items = [];

  // Recent achievements
  (state.achievements || []).forEach(aId => {
    const a = ACHIEVEMENTS.find(x => x.id === aId);
    if (a) items.push({ icon: a.icon, text: 'Earned: ' + a.name, time: '' });
  });

  if (items.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:13px">No recent activity</div>';
    return;
  }

  container.innerHTML = items.slice(0, 10).map(i => `
    <div class="dash-feed-item">
      <span class="dash-feed-icon">${i.icon}</span>
      <span class="dash-feed-text">${escapeHtml(i.text)}</span>
      ${i.time ? `<span class="dash-feed-time">${i.time}</span>` : ''}
    </div>
  `).join('');
}

function toggleDashEditForm() {
  const form = document.getElementById('dashboard-edit-form');
  if (form.style.display === 'none') {
    const p = state.profile || {};
    form.style.display = '';
    form.innerHTML = `
      <div class="ch-form-group">
        <div class="ch-form-label">First Name</div>
        <input class="ch-form-input" id="edit-firstName" value="${escapeHtml(p.firstName || '')}">
      </div>
      <div class="ch-form-group">
        <div class="ch-form-label">Last Name</div>
        <input class="ch-form-input" id="edit-lastName" value="${escapeHtml(p.lastName || '')}">
      </div>
      <div class="ch-form-group">
        <div class="ch-form-label">Nickname</div>
        <input class="ch-form-input" id="edit-nickname" value="${escapeHtml(p.nickname || '')}" placeholder="your_handle">
      </div>
      <div class="ch-form-group">
        <div class="ch-form-label">Date of Birth</div>
        <input class="ch-form-input" id="edit-dob" type="date" value="${p.dob || ''}">
      </div>
      <div class="ch-form-group">
        <div class="ch-form-label">Country</div>
        <input class="ch-form-input" id="edit-country" value="${escapeHtml(p.country || '')}" placeholder="e.g. United States">
      </div>
      <button class="ch-form-submit" id="edit-profile-save" style="margin-top:8px">Save</button>
    `;
    document.getElementById('edit-profile-save').addEventListener('click', saveDashProfile);
  } else {
    form.style.display = 'none';
  }
}

function saveDashProfile() {
  state.profile.firstName = document.getElementById('edit-firstName').value.trim();
  state.profile.lastName = document.getElementById('edit-lastName').value.trim();
  state.profile.nickname = document.getElementById('edit-nickname').value.trim();
  state.profile.dob = document.getElementById('edit-dob').value;
  state.profile.country = document.getElementById('edit-country').value.trim();
  saveState();
  if (window.socialSync) window.socialSync.syncUserProfile();
  document.getElementById('dashboard-edit-form').style.display = 'none';
  renderDashboard();
  updateProfileButton();
  updateSidebarAvatar();
  updateBottomNavAvatar();
}

function updateProfileButton() {
  const user = window.firebaseUser;
  const p = state.profile || {};
  const btn = document.getElementById('profile-btn');

  const photoURL = (user && user.photoURL) || p.photoURL || '';
  const displayName = (user && user.displayName) || p.firstName || '?';
  const initial = displayName.charAt(0).toUpperCase();

  if (photoURL) {
    btn.innerHTML = '<img src="' + photoURL + '" alt="" class="profile-btn-img" referrerpolicy="no-referrer">';
  } else {
    btn.innerHTML = '<span class="profile-btn-initial">' + initial + '</span>';
  }

  updateSidebarAvatar();
  updateBottomNavAvatar();
}

function updateSidebarAvatar() {
  const user = window.firebaseUser;
  const p = state.profile || {};
  const photoURL = (user && user.photoURL) || p.photoURL || '';
  const displayName = (user && user.displayName) || ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || '?';
  const initial = displayName.charAt(0).toUpperCase();

  const avatarEl = document.getElementById('side-panel-avatar-img');
  const nameEl = document.getElementById('side-panel-user-name');
  if (avatarEl) {
    if (photoURL) {
      avatarEl.innerHTML = '<img src="' + photoURL + '" alt="" referrerpolicy="no-referrer">';
    } else {
      avatarEl.textContent = initial;
    }
  }
  if (nameEl) nameEl.textContent = displayName;
}

function updateBottomNavAvatar() {
  const user = window.firebaseUser;
  const p = state.profile || {};
  const photoURL = (user && user.photoURL) || p.photoURL || '';
  const initial = ((user && user.displayName) || p.firstName || '?').charAt(0).toUpperCase();

  const avatarEl = document.getElementById('bottom-nav-avatar-img');
  if (avatarEl) {
    if (photoURL) {
      avatarEl.innerHTML = '<img src="' + photoURL + '" alt="" referrerpolicy="no-referrer">';
    } else {
      avatarEl.textContent = initial;
    }
  }
}

// ===== SOCIAL =====

let searchTimer = null;

function initSocialOverlays() {
  // User view overlay
  document.getElementById('user-view-back').addEventListener('click', closeUserView);
  document.getElementById('user-view-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeUserView();
  });
}


function createUserRow(uid, name, photoURL, showFollow, isFollowing, profileData) {
  const row = document.createElement('div');
  row.className = 'social-user-row';

  const initial = (name || '?').charAt(0).toUpperCase();
  const photoHtml = photoURL
    ? `<img src="${photoURL}" alt="" class="social-user-photo" referrerpolicy="no-referrer">`
    : `<div class="social-user-initial">${initial}</div>`;

  let followHtml = '';
  if (showFollow) {
    followHtml = isFollowing
      ? `<button class="social-follow-btn following" data-uid="${uid}">Following</button>`
      : `<button class="social-follow-btn" data-uid="${uid}">Follow</button>`;
  }

  row.innerHTML = `
    <div class="social-user-left" data-uid="${uid}">
      ${photoHtml}
      <span class="social-user-name">${escapeHtml(name || 'Unknown')}</span>
    </div>
    ${followHtml}
  `;

  // Click name/photo → open user view
  row.querySelector('.social-user-left').addEventListener('click', () => openUserView(uid));

  // Follow/unfollow button
  if (showFollow) {
    const btn = row.querySelector('.social-follow-btn');
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!window.socialSync) return;
      if (isFollowing) {
        await window.socialSync.unfollowUser(uid);
      } else {
        await window.socialSync.followUser(uid, profileData || { firstName: name, photoURL });
      }
      // Refresh search results
      const searchEl = document.getElementById('dash-search');
      const q = searchEl ? searchEl.value.trim() : '';
      if (q.length >= 2) {
        const results = await window.socialSync.searchUsers(q);
        renderDashSearchResults(results);
      }
      if (dashboardOpen) renderDashboard();
    });
  }

  return row;
}

// ---- User View Overlay ----

let viewingUserData = null;

async function openUserView(uid) {
  if (!window.socialSync) return;
  const overlay = document.getElementById('user-view-overlay');
  overlay.classList.add('visible');
  document.getElementById('user-view-body').innerHTML = '<div class="social-loading">Loading...</div>';

  const data = await window.socialSync.fetchUserView(uid);
  if (!data) {
    document.getElementById('user-view-body').innerHTML = '<div class="social-search-empty">User not found</div>';
    return;
  }
  viewingUserData = data;
  renderUserView(data);
}

function closeUserView() {
  document.getElementById('user-view-overlay').classList.remove('visible');
  viewingUserData = null;
}

function renderUserView(data) {
  const p = data.profile || {};
  const name = p.displayName || ((p.firstName || '') + ' ' + (p.lastName || '')).trim() || 'Unknown';
  const initial = name.charAt(0).toUpperCase();

  // Header
  const photoEl = document.getElementById('user-view-photo');
  if (p.photoURL) {
    photoEl.innerHTML = `<img src="${p.photoURL}" alt="" class="profile-photo-img" referrerpolicy="no-referrer">`;
  } else {
    photoEl.innerHTML = `<span class="profile-photo-initial">${initial}</span>`;
  }
  document.getElementById('user-view-name').textContent = name;
  document.getElementById('user-view-counts').textContent =
    `${Math.max(0, data.followersCount)} followers · ${Math.max(0, data.followingCount)} following`;

  // Follow button
  const followBtn = document.getElementById('user-view-follow-btn');
  followBtn.textContent = data.isFollowing ? 'Following' : 'Follow';
  followBtn.className = 'user-view-follow-btn' + (data.isFollowing ? ' following' : '');
  followBtn.onclick = async () => {
    if (!window.socialSync) return;
    if (data.isFollowing) {
      await window.socialSync.unfollowUser(data.uid);
      data.isFollowing = false;
      data.followersCount = Math.max(0, data.followersCount - 1);
    } else {
      await window.socialSync.followUser(data.uid, data.profile);
      data.isFollowing = true;
      data.followersCount++;
    }
    renderUserView(data);
    renderSocialTab();
  };

  // Body — habits + tasks
  const body = document.getElementById('user-view-body');
  let html = '';

  // Habits section
  if (data.habitDefs.length > 0 && data.weekData) {
    const dates = getWeekDates(data.currentWeek);
    const todayStr = dateToStr(new Date());
    html += '<div class="user-view-section-title">Habits</div>';
    html += '<div class="user-view-habits-grid">';
    html += '<div class="weekly-habits-header"><div></div>' +
      dates.map(d => `<div class="weekly-habits-header-day">${DAY_SHORT[d.getDay()]}</div>`).join('') + '</div>';

    data.habitDefs.forEach(h => {
      const checks = data.weekData.habitChecks[h.id] || Array(7).fill(h.target > 0 ? 0 : false);
      const isNumeric = h.target > 0;
      const unitLabel = isNumeric && h.unit ? `${h.target}${h.unit}` : '';
      html += '<div class="weekly-habit-row">';
      html += `<div class="weekly-habit-name">${escapeHtml(h.name)}${unitLabel ? `<span class="weekly-habit-unit">${unitLabel}</span>` : ''}</div>`;
      checks.forEach((val, di) => {
        const isDone = isNumeric ? (typeof val === 'number' && val >= h.target) : !!val;
        const isToday = dateToStr(dates[di]) === todayStr;
        html += `<div class="weekly-habit-cell ${isDone ? 'checked' : ''} ${isToday ? 'today' : ''} readonly"><div class="cell-box"></div></div>`;
      });
      html += '</div>';
    });
    html += '</div>';
  }

  // Tasks section
  if (data.weekData) {
    const dates = getWeekDates(data.currentWeek);
    const hasTasks = data.weekData.days.some(d => d.tasks.length > 0);
    if (hasTasks) {
      html += '<div class="user-view-section-title">Tasks</div>';
      html += '<div class="user-view-tasks">';
      data.weekData.days.forEach((day, di) => {
        if (day.tasks.length === 0) return;
        const d = dates[di];
        const dayName = DAY_SHORT[d.getDay()];
        html += `<div class="user-view-day-header">${dayName} ${d.getDate()}</div>`;
        day.tasks.forEach(t => {
          html += `<div class="user-view-task ${t.done ? 'done' : ''}">${t.done ? '&#10003;' : '&#9711;'} ${escapeHtml(t.text)}</div>`;
        });
      });
      html += '</div>';
    }
  }

  if (!html) {
    html = '<div class="social-search-empty">No visible habits or tasks</div>';
  }

  body.innerHTML = html;
}

// ===== CHALLENGES =====

const MAX_CHALLENGE_ITEMS = 10;
let chSubView = 'my';          // 'my' | 'browse'
let chSearchTimer = null;
let viewingChallenge = null;    // currently open challenge detail
let expandedChallengeId = null; // accordion: which card is expanded

function generateChallengeId() {
  return 'ch_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

function computeChallengeStatus(startDate, endDate) {
  const today = dateToStr(new Date());
  if (today < startDate) return 'upcoming';
  if (today > endDate) return 'completed';
  return 'active';
}

function getDaysRemaining(endDate) {
  const end = new Date(endDate + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((end - now) / 86400000));
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

// ---- Init ----
function initChallengesView() {
  // Create overlay (static in HTML)
  document.getElementById('ch-create-back').addEventListener('click', closeChallengeCreate);
  document.getElementById('ch-create-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeChallengeCreate();
  });
}

// ---- Challenges Tab ----
function renderChallengesTab() {
  if (chSubView === 'my') renderMyChallenges();
  else renderBrowseChallenges();
}

async function renderMyChallenges() {
  if (!window.challengeSync) return;
  const container = document.getElementById('ch-my-list');
  const emptyEl = document.getElementById('ch-my-empty');
  container.innerHTML = '<div class="social-loading">Loading...</div>';
  emptyEl.style.display = 'none';

  try {
    const list = await window.challengeSync.loadMyChallenges();
    container.innerHTML = '';
    if (list.length === 0) {
      emptyEl.style.display = '';
      return;
    }
    list.forEach(ch => container.appendChild(createChallengeCard(ch)));

    // Asynchronously load progress for each challenge
    const uid = window.firebaseUser ? window.firebaseUser.uid : null;
    if (uid) {
      list.forEach(async (ch) => {
        try {
          const challengeId = ch.challengeId || ch.id;
          const data = await window.challengeSync.loadChallengeDetail(challengeId);
          if (!data) return;
          const myData = data.participants.find(p => p.uid === uid) || { weeks: {} };
          const progress = calculateChallengeProgress(data, myData);
          const fill = container.querySelector(`[data-progress-for="${challengeId}"]`);
          if (fill) {
            fill.style.width = progress + '%';
            fill.style.transition = 'width 0.6s ease';
          }
        } catch (e) {
          console.error('[challenges] progress calc failed:', e);
        }
      });
    }
  } catch (e) {
    console.error('[challenges] load failed:', e);
    container.innerHTML = '<div class="ch-empty">Failed to load challenges</div>';
  }
}

async function renderBrowseChallenges(query) {
  if (!window.challengeSync) return;
  const container = document.getElementById('ch-browse-list');
  const emptyEl = document.getElementById('ch-browse-empty');
  container.innerHTML = '<div class="social-loading">Loading...</div>';
  emptyEl.style.display = 'none';

  try {
    const list = await window.challengeSync.browseChallenges(query || '');
    container.innerHTML = '';
    if (list.length === 0) {
      emptyEl.style.display = '';
      return;
    }
    list.forEach(ch => container.appendChild(createChallengeCard(ch)));
  } catch (e) {
    console.error('[challenges] browse failed:', e);
    container.innerHTML = '<div class="ch-empty">Failed to browse challenges</div>';
  }
}

function createChallengeCard(ch) {
  const card = document.createElement('div');
  card.className = 'ch-card';
  const challengeId = ch.challengeId || ch.id;
  card.dataset.challengeId = challengeId;

  const status = computeChallengeStatus(ch.startDate, ch.endDate);
  const daysLeft = getDaysRemaining(ch.endDate);
  let badgeHtml = '';
  if (status === 'active') badgeHtml = `<span class="ch-status-badge active">${daysLeft}d left</span>`;
  else if (status === 'upcoming') badgeHtml = `<span class="ch-status-badge upcoming">Starts ${formatShortDate(ch.startDate)}</span>`;
  else badgeHtml = `<span class="ch-status-badge completed">Completed</span>`;

  const itemCount = ch.itemCount || (ch.items ? ch.items.length : 0);
  const pCount = ch.participantCount || 0;

  card.innerHTML = `
    <div class="ch-card-summary">
      <div class="ch-card-summary-left">
        <div class="ch-card-top">
          <div class="ch-card-title">${escapeHtml(ch.title)}</div>
          ${badgeHtml}
        </div>
        <div class="ch-card-meta">
          <span>${ch.mode === 'group' ? pCount + ' participant' + (pCount !== 1 ? 's' : '') : 'Solo'}</span>
          <span>${itemCount} item${itemCount !== 1 ? 's' : ''} · ${formatShortDate(ch.startDate)} – ${formatShortDate(ch.endDate)}</span>
        </div>
        <div class="ch-card-progress"><div class="hero-bar"><div class="hero-bar-fill" data-progress-for="${challengeId}" style="width:0%"></div></div></div>
      </div>
      <div class="ch-card-chevron">›</div>
    </div>
    <div class="ch-card-detail"></div>
  `;

  card.querySelector('.ch-card-summary').addEventListener('click', () => {
    toggleChallengeCard(card, challengeId);
  });
  return card;
}

// ---- Accordion Expand / Collapse ----
function collapseAllChallengeCards() {
  document.querySelectorAll('.ch-card.expanded').forEach(c => {
    c.classList.remove('expanded');
    const detail = c.querySelector('.ch-card-detail');
    if (detail) detail.innerHTML = '';
  });
  expandedChallengeId = null;
  viewingChallenge = null;
}

async function toggleChallengeCard(card, challengeId) {
  // If this card is already expanded, collapse it
  if (card.classList.contains('expanded')) {
    card.classList.remove('expanded');
    const detail = card.querySelector('.ch-card-detail');
    if (detail) setTimeout(() => { detail.innerHTML = ''; }, 300);
    expandedChallengeId = null;
    viewingChallenge = null;
    return;
  }

  // Collapse any other expanded card
  collapseAllChallengeCards();

  // Expand this card
  card.classList.add('expanded');
  expandedChallengeId = challengeId;

  const detail = card.querySelector('.ch-card-detail');
  detail.innerHTML = '<div class="social-loading" style="padding:24px;text-align:center">Loading...</div>';

  try {
    const data = await window.challengeSync.loadChallengeDetail(challengeId);
    if (!data) {
      detail.innerHTML = '<div class="ch-empty">Challenge not found</div>';
      return;
    }
    viewingChallenge = data;
    renderChallengeDetailInline(card, data);

    // Smooth scroll card into view
    setTimeout(() => {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  } catch (e) {
    console.error('[challenges] load detail failed:', e);
    detail.innerHTML = '<div class="ch-empty">Failed to load challenge</div>';
  }
}

function renderChallengeDetailInline(card, data) {
  const detail = card.querySelector('.ch-card-detail');
  if (!detail) return;

  const uid = window.firebaseUser ? window.firebaseUser.uid : null;
  const isParticipant = data.participants.some(p => p.uid === uid);
  const isCreator = data.creatorUid === uid;
  const status = computeChallengeStatus(data.startDate, data.endDate);

  let html = '';

  // Description + Meta
  html += '<div class="ch-inline-header">';
  if (data.description) {
    html += `<div class="ch-detail-desc">${escapeHtml(data.description)}</div>`;
  }
  html += `<div class="ch-detail-meta">
    <span>📅 ${formatShortDate(data.startDate)} – ${formatShortDate(data.endDate)}</span>
    <span>👤 ${data.participantCount || data.participants.length} participant${(data.participantCount || data.participants.length) !== 1 ? 's' : ''}</span>
    <span>${data.mode === 'group' ? '👥 Group' : '🧘 Solo'}</span>
  </div>`;

  // Action buttons
  html += '<div class="ch-detail-actions">';
  if (!isParticipant && status !== 'completed') {
    html += '<button class="ch-join-btn" data-action="join">Join Challenge</button>';
  }
  if (isParticipant && !isCreator) {
    html += '<button class="ch-leave-btn" data-action="leave">Leave</button>';
  }
  if (isCreator && status !== 'completed') {
    html += '<button class="ch-edit-btn" data-action="edit">Edit</button>';
  }
  if (isCreator) {
    html += '<button class="ch-delete-btn" data-action="delete">Delete</button>';
  }
  html += '</div>';
  // Invite button (creator only, not completed)
  if (isCreator && status !== 'completed') {
    html += '<button class="ch-existing-invite-btn" data-action="invite-toggle">+ Invite People</button>';
    html += '<div class="ch-existing-invite-panel" id="ch-existing-invite-panel" style="display:none"></div>';
  }
  html += '</div>';

  // Week grid
  if (isParticipant && data.items && data.items.length > 0) {
    const myData = data.participants.find(p => p.uid === uid) || { weeks: {} };
    html += renderChallengeWeekGrid(data, myData, status);
  }

  // Leaderboard
  if (data.mode === 'group' && data.participants.length > 0) {
    html += renderLeaderboard(data);
  }

  if (!html || html === '<div class="ch-inline-header"></div>') {
    html = '<div class="ch-empty">No items in this challenge yet</div>';
  }

  detail.innerHTML = html;

  // Stop clicks inside detail from toggling accordion
  detail.addEventListener('click', (e) => e.stopPropagation());

  // Join button
  const joinBtn = detail.querySelector('[data-action="join"]');
  if (joinBtn) {
    joinBtn.addEventListener('click', async () => {
      joinBtn.disabled = true;
      joinBtn.textContent = 'Joining...';
      try {
        await window.challengeSync.joinChallenge(data.id);
        const updated = await window.challengeSync.loadChallengeDetail(data.id);
        viewingChallenge = updated;
        renderChallengeDetailInline(card, updated);
        renderMyChallenges();
      } catch (e) {
        console.error('[challenges] join failed:', e);
        joinBtn.textContent = 'Failed';
      }
    });
  }

  // Leave button
  const leaveBtn = detail.querySelector('[data-action="leave"]');
  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
      showConfirm('Leave Challenge?', 'You will lose your progress in this challenge.', async () => {
        try {
          await window.challengeSync.leaveChallenge(data.id);
          collapseAllChallengeCards();
          renderMyChallenges();
        } catch (e) { console.error('[challenges] leave failed:', e); }
      });
    });
  }

  // Edit button (creator only)
  const editBtn = detail.querySelector('[data-action="edit"]');
  if (editBtn) {
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openChallengeEdit(data);
    });
  }

  // Delete button (creator only)
  const deleteBtn = detail.querySelector('[data-action="delete"]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showConfirm(
        'Delete Challenge?',
        'This will permanently delete the challenge and remove all participants. This cannot be undone.',
        async () => {
          try {
            await window.challengeSync.deleteChallenge(data.id);
            collapseAllChallengeCards();
            renderMyChallenges();
          } catch (err) {
            console.error('[challenges] delete failed:', err);
          }
        }
      );
    });
  }

  // Check handlers for week grid
  if (isParticipant && status !== 'completed') {
    detail.querySelectorAll('.ch-week-cell:not(.readonly)').forEach(cell => {
      cell.addEventListener('click', async () => {
        const itemId = cell.dataset.item;
        const dayIdx = +cell.dataset.day;
        const weekStart = cell.dataset.week;
        const item = data.items.find(i => i.id === itemId);
        if (!item) return;

        const myData = data.participants.find(p => p.uid === uid);
        if (!myData) return;

        const wk = (myData.weeks || {})[weekStart] || { checks: {} };
        const checks = wk.checks || {};
        const arr = checks[itemId] || Array(7).fill(item.target > 0 ? 0 : false);

        let newVal;
        if (item.target > 0) {
          newVal = (typeof arr[dayIdx] === 'number' && arr[dayIdx] >= item.target) ? 0 : item.target;
        } else {
          newVal = !arr[dayIdx];
        }

        // Optimistic update
        arr[dayIdx] = newVal;
        if (!myData.weeks) myData.weeks = {};
        if (!myData.weeks[weekStart]) myData.weeks[weekStart] = { checks: {} };
        if (!myData.weeks[weekStart].checks) myData.weeks[weekStart].checks = {};
        myData.weeks[weekStart].checks[itemId] = arr;

        renderChallengeDetailInline(card, data);

        // Update progress bar in card summary
        const progress = calculateChallengeProgress(data, myData);
        const challengeId = data.id || data.challengeId;
        const fill = card.querySelector(`[data-progress-for="${challengeId}"]`);
        if (fill) {
          fill.style.width = progress + '%';
          fill.style.transition = 'width 0.3s ease';
        }

        // Persist
        try {
          await window.challengeSync.updateChallengeCheck(data.id, weekStart, itemId, dayIdx, newVal);
        } catch (e) {
          console.error('[challenges] update check failed:', e);
        }
      });
    });
  }

  // Invite toggle (creator only)
  const inviteToggle = detail.querySelector('[data-action="invite-toggle"]');
  const invitePanel = detail.querySelector('#ch-existing-invite-panel');
  if (inviteToggle && invitePanel) {
    inviteToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (invitePanel.style.display === 'none') {
        invitePanel.style.display = '';
        inviteToggle.textContent = '− Hide Invite';
        renderExistingChallengeInvitePanel(invitePanel, data.id, data.title);
      } else {
        invitePanel.style.display = 'none';
        inviteToggle.textContent = '+ Invite People';
      }
    });
  }
}

function renderExistingChallengeInvitePanel(container, challengeId, challengeTitle) {
  container.innerHTML = `
    <input class="ch-invite-search" placeholder="Search by name or email..." autocomplete="off">
    <div class="ch-invite-results"></div>
  `;

  let timer = null;
  const input = container.querySelector('.ch-invite-search');
  const resultsDiv = container.querySelector('.ch-invite-results');
  const sentUids = new Set();

  input.addEventListener('click', (e) => e.stopPropagation());

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { resultsDiv.classList.remove('open'); resultsDiv.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      if (!window.socialSync) return;
      try {
        const results = await window.socialSync.searchUsers(q);
        const myUid = window.firebaseUser ? window.firebaseUser.uid : null;
        const filtered = results.filter(r => r.uid !== myUid);

        if (filtered.length === 0) {
          resultsDiv.innerHTML = '<div style="padding:12px 14px;color:var(--text-dim);font-size:13px;">No users found</div>';
          resultsDiv.classList.add('open');
          return;
        }

        resultsDiv.innerHTML = filtered.map(r => {
          const isSent = sentUids.has(r.uid);
          const photoHtml = r.photoURL
            ? `<img class="ch-invite-result-photo" src="${r.photoURL}" alt="">`
            : `<span class="ch-invite-result-initial">${(r.displayName || '?')[0].toUpperCase()}</span>`;
          return `<div class="ch-invite-result" data-uid="${r.uid}">
            ${photoHtml}
            <div class="ch-invite-result-info">
              <div class="ch-invite-result-name">${escapeHtml(r.displayName || 'User')}</div>
              <div class="ch-invite-result-email">${escapeHtml(r.email || '')}</div>
            </div>
            <button class="ch-invite-add-btn${isSent ? ' added' : ''}" data-uid="${r.uid}">${isSent ? 'Sent' : 'Invite'}</button>
          </div>`;
        }).join('');

        resultsDiv.classList.add('open');

        resultsDiv.querySelectorAll('.ch-invite-add-btn:not(.added)').forEach(btn => {
          btn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const uid = btn.dataset.uid;
            btn.disabled = true;
            btn.textContent = 'Sending...';
            try {
              if (window.notifSync) {
                await window.notifSync.sendChallengeInvites(challengeId, challengeTitle, [uid]);
              }
              sentUids.add(uid);
              btn.classList.add('added');
              btn.textContent = 'Sent';
            } catch (err) {
              console.error('[invite] send failed:', err);
              btn.textContent = 'Failed';
              btn.disabled = false;
            }
          });
        });
      } catch (e) { console.error('[invite] search failed:', e); }
    }, 300);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { resultsDiv.classList.remove('open'); }, 200);
  });

  // Focus the search input
  setTimeout(() => input.focus(), 50);
}

// ---- Challenge Create ----
let challengeForm = null;
let editingChallengeId = null;

function resetChallengeForm() {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 30);
  challengeForm = {
    title: '',
    description: '',
    startDate: dateToStr(today),
    endDate: dateToStr(end),
    mode: 'solo',
    visibility: 'public',
    items: [],
    invitedUsers: []
  };
}

function openChallengeCreate() {
  resetChallengeForm();
  document.getElementById('ch-create-overlay').classList.add('visible');
  renderChallengeCreateForm();
}

function closeChallengeCreate() {
  document.getElementById('ch-create-overlay').classList.remove('visible');
  challengeForm = null;
  editingChallengeId = null;
}

function openChallengeEdit(challengeData) {
  editingChallengeId = challengeData.id;
  challengeForm = {
    title: challengeData.title || '',
    description: challengeData.description || '',
    startDate: challengeData.startDate || '',
    endDate: challengeData.endDate || '',
    mode: challengeData.mode || 'solo',
    visibility: challengeData.visibility || 'public',
    items: (challengeData.items || []).map(item => ({ ...item })),
    invitedUsers: []
  };
  document.getElementById('ch-create-overlay').classList.add('visible');
  renderChallengeCreateForm();
}

function renderChallengeCreateForm() {
  const f = challengeForm;
  const body = document.getElementById('ch-create-body');
  const isEditing = !!editingChallengeId;

  // Update header title
  const headerTitle = document.getElementById('ch-create-title');
  if (headerTitle) headerTitle.textContent = isEditing ? 'Edit Challenge' : 'Create Challenge';

  let itemsHtml = f.items.map((item, i) => `
    <div class="ch-item-row" data-idx="${i}">
      <input class="ch-item-name" placeholder="Item name" value="${escapeHtml(item.name)}" data-field="name">
      <input class="ch-item-freq" type="number" min="1" max="7" placeholder="x/wk" value="${item.frequency}" data-field="frequency" title="Times per week">
      <input class="ch-item-target" type="number" min="0" placeholder="Goal" value="${item.target || ''}" data-field="target" title="Daily target (0=checkbox)">
      <select class="ch-item-unit" data-field="unit">
        <option value="">—</option>
        <option value="min" ${item.unit==='min'?'selected':''}>min</option>
        <option value="km" ${item.unit==='km'?'selected':''}>km</option>
        <option value="reps" ${item.unit==='reps'?'selected':''}>reps</option>
        <option value="l" ${item.unit==='l'?'selected':''}>l</option>
        <option value="cal" ${item.unit==='cal'?'selected':''}>cal</option>
        <option value="hrs" ${item.unit==='hrs'?'selected':''}>hrs</option>
        <option value="p." ${item.unit==='p.'?'selected':''}>p.</option>
        <option value="ml" ${item.unit==='ml'?'selected':''}>ml</option>
      </select>
      <button class="ch-item-del" data-idx="${i}">&times;</button>
    </div>
  `).join('');

  body.innerHTML = `
    <div class="ch-form-group">
      <div class="ch-form-label">Title</div>
      <input class="ch-form-input" id="ch-f-title" placeholder="e.g. 30-Day Morning Routine" value="${escapeHtml(f.title)}" maxlength="60">
    </div>
    <div class="ch-form-group">
      <div class="ch-form-label">Description (optional)</div>
      <textarea class="ch-form-input ch-form-textarea" id="ch-f-desc" placeholder="What's this challenge about?" maxlength="200">${escapeHtml(f.description)}</textarea>
    </div>
    <div class="ch-form-row">
      <div class="ch-form-group">
        <div class="ch-form-label">Start</div>
        <input class="ch-form-input" type="date" id="ch-f-start" value="${f.startDate}">
      </div>
      <div class="ch-form-group">
        <div class="ch-form-label">End</div>
        <input class="ch-form-input" type="date" id="ch-f-end" value="${f.endDate}">
      </div>
    </div>
    <div class="ch-form-row">
      <div class="ch-form-group">
        <div class="ch-form-label">Mode</div>
        <div class="ch-toggle-group" id="ch-f-mode">
          <button class="ch-toggle-btn ${f.mode==='solo'?'active':''}" data-val="solo">Solo</button>
          <button class="ch-toggle-btn ${f.mode==='group'?'active':''}" data-val="group">Group</button>
        </div>
      </div>
      <div class="ch-form-group">
        <div class="ch-form-label">Visibility</div>
        <div class="ch-toggle-group" id="ch-f-vis">
          <button class="ch-toggle-btn ${f.visibility==='public'?'active':''}" data-val="public">🌐</button>
          <button class="ch-toggle-btn ${f.visibility==='followers'?'active':''}" data-val="followers">👥</button>
          <button class="ch-toggle-btn ${f.visibility==='private'?'active':''}" data-val="private">🔒</button>
        </div>
      </div>
    </div>
    <div class="ch-form-group">
      <div class="ch-form-label">Items (${f.items.length}/${MAX_CHALLENGE_ITEMS})</div>
      <div id="ch-f-items">${itemsHtml}</div>
      ${f.items.length < MAX_CHALLENGE_ITEMS ? '<button class="ch-add-item-btn" id="ch-f-add-item">+ Add Item</button>' : ''}
    </div>
    <div class="ch-form-group ch-invite-section">
      <div class="ch-form-label">Invite People${f.invitedUsers.length > 0 ? ' (' + f.invitedUsers.length + ')' : ''}</div>
      <div class="ch-invite-chips" id="ch-f-invite-chips"></div>
      <div class="ch-invite-search-wrap">
        <input class="ch-invite-search" id="ch-f-invite-search" placeholder="Search by name or email..." autocomplete="off">
        <div class="ch-invite-results" id="ch-f-invite-results"></div>
      </div>
    </div>
    <button class="ch-submit-btn" id="ch-f-submit" ${!f.title.trim() || f.items.length === 0 ? 'disabled' : ''}>${isEditing ? 'Save Changes' : 'Create Challenge'}</button>
  `;

  // Event listeners
  body.querySelector('#ch-f-title').addEventListener('input', (e) => {
    f.title = e.target.value;
    const btn = body.querySelector('#ch-f-submit');
    btn.disabled = !f.title.trim() || f.items.length === 0;
  });
  body.querySelector('#ch-f-desc').addEventListener('input', (e) => { f.description = e.target.value; });
  body.querySelector('#ch-f-start').addEventListener('change', (e) => { f.startDate = e.target.value; });
  body.querySelector('#ch-f-end').addEventListener('change', (e) => { f.endDate = e.target.value; });

  // Mode toggle
  body.querySelector('#ch-f-mode').addEventListener('click', (e) => {
    const btn = e.target.closest('.ch-toggle-btn');
    if (!btn) return;
    f.mode = btn.dataset.val;
    renderChallengeCreateForm();
  });

  // Visibility toggle
  body.querySelector('#ch-f-vis').addEventListener('click', (e) => {
    const btn = e.target.closest('.ch-toggle-btn');
    if (!btn) return;
    f.visibility = btn.dataset.val;
    renderChallengeCreateForm();
  });

  // Item fields
  body.querySelectorAll('.ch-item-row').forEach(row => {
    const idx = +row.dataset.idx;
    row.querySelectorAll('input, select').forEach(inp => {
      inp.addEventListener('change', () => {
        const field = inp.dataset.field;
        if (field === 'frequency') f.items[idx].frequency = Math.max(1, Math.min(7, +inp.value || 1));
        else if (field === 'target') f.items[idx].target = Math.max(0, +inp.value || 0);
        else if (field === 'name') f.items[idx].name = inp.value;
        else if (field === 'unit') f.items[idx].unit = inp.value;
      });
      if (inp.dataset.field === 'name') {
        inp.addEventListener('input', () => {
          f.items[idx].name = inp.value;
          const btn = body.querySelector('#ch-f-submit');
          btn.disabled = !f.title.trim() || f.items.length === 0;
        });
      }
    });
  });

  // Delete item
  body.querySelectorAll('.ch-item-del').forEach(btn => {
    btn.addEventListener('click', () => {
      f.items.splice(+btn.dataset.idx, 1);
      renderChallengeCreateForm();
    });
  });

  // Add item
  const addBtn = body.querySelector('#ch-f-add-item');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      f.items.push({ id: generateChallengeId(), name: '', frequency: 7, target: 0, unit: '' });
      renderChallengeCreateForm();
      // Focus the new item's name input
      setTimeout(() => {
        const inputs = body.querySelectorAll('.ch-item-name');
        if (inputs.length) inputs[inputs.length - 1].focus();
      }, 50);
    });
  }

  // Submit
  body.querySelector('#ch-f-submit').addEventListener('click', submitChallengeCreate);

  // Invite chips
  renderInviteChips();

  // Invite search
  let inviteSearchTimer = null;
  const inviteSearchInput = body.querySelector('#ch-f-invite-search');
  const inviteResultsDiv = body.querySelector('#ch-f-invite-results');
  if (inviteSearchInput) {
    inviteSearchInput.addEventListener('input', () => {
      clearTimeout(inviteSearchTimer);
      const q = inviteSearchInput.value.trim();
      if (q.length < 2) { inviteResultsDiv.classList.remove('open'); inviteResultsDiv.innerHTML = ''; return; }
      inviteSearchTimer = setTimeout(async () => {
        if (!window.socialSync) return;
        try {
          const results = await window.socialSync.searchUsers(q);
          renderInviteSearchResults(results, inviteResultsDiv);
        } catch (e) { console.error('[invite] search failed:', e); }
      }, 300);
    });
    // Close results on blur (with delay to allow clicks)
    inviteSearchInput.addEventListener('blur', () => {
      setTimeout(() => { inviteResultsDiv.classList.remove('open'); }, 200);
    });
  }
}

function renderInviteChips() {
  const f = challengeForm;
  if (!f) return;
  const container = document.getElementById('ch-f-invite-chips');
  if (!container) return;

  if (f.invitedUsers.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = f.invitedUsers.map((u, i) => {
    const photoHtml = u.photoURL
      ? `<img class="ch-invite-chip-photo" src="${u.photoURL}" alt="">`
      : `<span class="ch-invite-chip-initial">${(u.displayName || '?')[0].toUpperCase()}</span>`;
    return `<div class="ch-invite-chip">
      ${photoHtml}
      <span>${escapeHtml(u.displayName || u.email || 'User')}</span>
      <button class="ch-invite-chip-remove" data-idx="${i}">&times;</button>
    </div>`;
  }).join('');

  container.querySelectorAll('.ch-invite-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      f.invitedUsers.splice(+btn.dataset.idx, 1);
      renderInviteChips();
      // Update the label
      const label = document.querySelector('.ch-invite-section .ch-form-label');
      if (label) label.textContent = 'Invite People' + (f.invitedUsers.length > 0 ? ' (' + f.invitedUsers.length + ')' : '');
    });
  });
}

function renderInviteSearchResults(results, container) {
  const f = challengeForm;
  if (!f) return;
  const myUid = window.firebaseUser ? window.firebaseUser.uid : null;

  // Filter out self
  const filtered = results.filter(r => r.uid !== myUid);
  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding:12px 14px;color:var(--text-dim);font-size:13px;">No users found</div>';
    container.classList.add('open');
    return;
  }

  container.innerHTML = filtered.map(r => {
    const isAdded = f.invitedUsers.some(u => u.uid === r.uid);
    const photoHtml = r.photoURL
      ? `<img class="ch-invite-result-photo" src="${r.photoURL}" alt="">`
      : `<span class="ch-invite-result-initial">${(r.displayName || '?')[0].toUpperCase()}</span>`;
    return `<div class="ch-invite-result" data-uid="${r.uid}">
      ${photoHtml}
      <div class="ch-invite-result-info">
        <div class="ch-invite-result-name">${escapeHtml(r.displayName || 'User')}</div>
        <div class="ch-invite-result-email">${escapeHtml(r.email || '')}</div>
      </div>
      <button class="ch-invite-add-btn${isAdded ? ' added' : ''}" data-uid="${r.uid}">${isAdded ? 'Added' : 'Invite'}</button>
    </div>`;
  }).join('');

  container.classList.add('open');

  container.querySelectorAll('.ch-invite-add-btn:not(.added)').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const uid = btn.dataset.uid;
      const user = filtered.find(r => r.uid === uid);
      if (user && !f.invitedUsers.some(u => u.uid === uid)) {
        f.invitedUsers.push({ uid: user.uid, displayName: user.displayName, email: user.email, photoURL: user.photoURL });
        btn.classList.add('added');
        btn.textContent = 'Added';
        renderInviteChips();
        const label = document.querySelector('.ch-invite-section .ch-form-label');
        if (label) label.textContent = 'Invite People (' + f.invitedUsers.length + ')';
      }
    });
  });
}

async function submitChallengeCreate() {
  if (!window.challengeSync || !challengeForm) return;
  const f = challengeForm;
  if (!f.title.trim()) return;

  // Filter out items with empty names
  f.items = f.items.filter(i => i.name.trim());
  if (f.items.length === 0) return;

  const btn = document.querySelector('#ch-f-submit');
  btn.disabled = true;

  if (editingChallengeId) {
    // --- Edit mode ---
    btn.textContent = 'Saving...';
    try {
      await window.challengeSync.updateChallenge(editingChallengeId, {
        title: f.title,
        description: f.description,
        startDate: f.startDate,
        endDate: f.endDate,
        mode: f.mode,
        visibility: f.visibility,
        items: f.items
      });
      closeChallengeCreate();
      // Refresh the expanded card if still open
      if (expandedChallengeId === editingChallengeId) {
        const card = document.querySelector(`.ch-card[data-id="${expandedChallengeId}"]`);
        if (card) {
          const updated = await window.challengeSync.loadChallengeDetail(expandedChallengeId);
          if (updated) {
            viewingChallenge = updated;
            renderChallengeDetailInline(card, updated);
          }
        }
      }
      renderMyChallenges();
    } catch (e) {
      console.error('[challenges] update failed:', e);
      btn.textContent = 'Failed — Try Again';
      btn.disabled = false;
    }
  } else {
    // --- Create mode ---
    btn.textContent = 'Creating...';

    // Collect invited UIDs
    if (f.invitedUsers && f.invitedUsers.length > 0) {
      f.invitedUids = f.invitedUsers.map(u => u.uid);
    }

    try {
      await window.challengeSync.createChallenge(f);
      closeChallengeCreate();
      renderMyChallenges();
    } catch (e) {
      console.error('[challenges] create failed:', e);
      btn.textContent = 'Failed — Try Again';
      btn.disabled = false;
    }
  }
}

// ---- Challenge Detail (inline accordion — old overlay functions removed) ----

function renderChallengeWeekGrid(data, myData, status) {
  const today = new Date();
  const weekStart = getMonday(today);
  const dates = getWeekDates(weekStart);
  const todayStr = dateToStr(today);

  const wk = (myData.weeks || {})[weekStart] || { checks: {} };
  const checks = wk.checks || {};

  let html = '<div class="ch-week-section">';
  html += '<div class="ch-section-title">This Week</div>';
  html += '<div class="ch-week-grid">';

  // Header row
  html += '<div class="ch-week-header"><div></div>';
  dates.forEach(d => {
    html += `<div class="ch-week-header-day">${DAY_SHORT[d.getDay()]}</div>`;
  });
  html += '</div>';

  // Item rows
  data.items.forEach(item => {
    const itemChecks = checks[item.id] || Array(7).fill(item.target > 0 ? 0 : false);
    const completed = itemChecks.filter((v, i) => {
      if (item.target > 0) return typeof v === 'number' && v >= item.target;
      return !!v;
    }).length;

    html += '<div class="ch-week-row">';
    html += `<div class="ch-week-item-info">
      <div class="ch-week-item-name">${escapeHtml(item.name)}</div>
      <div class="ch-week-item-freq">${completed}/${item.frequency}x/wk${item.target > 0 ? ' · ' + item.target + (item.unit || '') : ''}</div>
    </div>`;

    dates.forEach((d, di) => {
      const dStr = dateToStr(d);
      const isToday = dStr === todayStr;
      const isFuture = dStr > todayStr;
      const isBeforeStart = dStr < data.startDate;
      const isAfterEnd = dStr > data.endDate;
      const readonly = isFuture || isBeforeStart || isAfterEnd || status === 'completed';

      const val = itemChecks[di];
      let checked = false;
      let displayVal = '';
      if (item.target > 0) {
        checked = typeof val === 'number' && val >= item.target;
        if (typeof val === 'number' && val > 0) displayVal = val;
      } else {
        checked = !!val;
      }

      html += `<div class="ch-week-cell ${checked ? 'checked' : ''} ${isToday ? 'today' : ''} ${readonly ? 'readonly' : ''}"
                    data-item="${item.id}" data-day="${di}" data-week="${weekStart}">
        <div class="cell-box">${checked ? '✓' : (displayVal || '')}</div>
      </div>`;
    });
    html += '</div>';
  });

  html += '</div></div>';
  return html;
}

function calculateChallengeProgress(challengeData, participantData) {
  const start = new Date(challengeData.startDate + 'T00:00:00');
  const end = new Date(challengeData.endDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = today < end ? today : end;

  if (!challengeData.items || challengeData.items.length === 0) return 0;
  if (today < start) return 0;

  let totalTarget = 0;
  let totalCompleted = 0;

  // Iterate week by week
  const cur = new Date(start);
  while (cur <= endDate) {
    const wkStart = getMonday(cur);
    const wk = (participantData.weeks || {})[wkStart];
    const checks = wk ? (wk.checks || {}) : {};

    // For each item, count completions this week
    challengeData.items.forEach(item => {
      const freq = item.frequency || 7;
      totalTarget += freq;

      const arr = checks[item.id] || [];
      let completed = 0;
      for (let di = 0; di < 7; di++) {
        const dayDate = new Date(new Date(wkStart + 'T00:00:00'));
        dayDate.setDate(dayDate.getDate() + di);
        if (dayDate < start || dayDate > endDate) continue;

        const val = arr[di];
        if (item.target > 0) {
          if (typeof val === 'number' && val >= item.target) completed++;
        } else {
          if (val) completed++;
        }
      }
      totalCompleted += Math.min(completed, freq);
    });

    // Move to next week
    cur.setDate(cur.getDate() + 7);
    // Align to Monday
    const day = cur.getDay();
    const diff = day === 0 ? 1 : (day === 1 ? 0 : 8 - day);
    cur.setDate(cur.getDate() + diff - (day === 0 ? 0 : 0));
    // Simpler: just break after advancing past end
    if (cur > endDate) break;
  }

  return totalTarget > 0 ? Math.round((totalCompleted / totalTarget) * 100) : 0;
}

function renderLeaderboard(data) {
  const ranked = data.participants.map(p => ({
    ...p,
    progress: calculateChallengeProgress(data, p)
  })).sort((a, b) => b.progress - a.progress);

  const uid = window.firebaseUser ? window.firebaseUser.uid : null;

  let html = '<div class="ch-week-section">';
  html += '<div class="ch-section-title">Leaderboard</div>';
  html += '<div class="ch-leaderboard">';

  ranked.forEach((p, i) => {
    const isMe = p.uid === uid;
    const photoHtml = p.photoURL
      ? `<img src="${p.photoURL}" alt="" class="social-user-photo" referrerpolicy="no-referrer">`
      : `<div class="social-user-initial">${(p.displayName || '?').charAt(0).toUpperCase()}</div>`;

    html += `
      <div class="ch-lb-row ${isMe ? 'ch-lb-me' : ''}">
        <span class="ch-lb-rank">${i + 1}</span>
        ${photoHtml}
        <span class="social-user-name">${escapeHtml(p.displayName || 'Unknown')}</span>
        <div class="ch-lb-bar">
          <div class="hero-bar"><div class="hero-bar-fill" style="width:${p.progress}%"></div></div>
          <span class="ch-lb-pct">${p.progress}%</span>
        </div>
      </div>
    `;
  });

  html += '</div></div>';
  return html;
}

// ---- Auth Gate ----
let appInitialized = false;

window.onAuthReady = function (signedIn) {
  const gate = document.getElementById('auth-gate');
  const app  = document.querySelector('.app');

  if (signedIn) {
    gate.style.display = 'none';
    app.style.display  = '';
    if (!appInitialized) {
      initHeader();
      initNav();
      initSocialOverlays();
      initChallengesView();
      initDashboard();
      initReminders();
      initNotifPanel();
      appInitialized = true;
    }
    carryForwardIncompleteTasks();
    renderAll();
    updateProfileButton();
  } else {
    gate.style.display = '';
    app.style.display  = 'none';
  }
};

// Redraw on resize (including orientation change)
window.addEventListener('resize', () => {
  if (!appInitialized) return;
  renderAll();
});

// ===== PUSH NOTIFICATIONS / REMINDERS =====

const REMINDER_KEY = 'mindset-stack-reminders';

function loadReminderSettings() {
  try {
    const raw = localStorage.getItem(REMINDER_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { enabled: false, time: '09:00' };
}

function saveReminderSettings(settings) {
  localStorage.setItem(REMINDER_KEY, JSON.stringify(settings));
  scheduleReminder(settings);
}

function initReminders() {
  const toggle = document.getElementById('reminder-toggle');
  const timeRow = document.getElementById('reminder-time-row');
  const timeInput = document.getElementById('reminder-time');
  const statusEl = document.getElementById('reminder-status');

  const settings = loadReminderSettings();
  toggle.checked = settings.enabled;
  timeInput.value = settings.time || '09:00';
  timeRow.style.display = settings.enabled ? '' : 'none';
  updateReminderStatus(settings);

  toggle.addEventListener('change', async () => {
    if (toggle.checked) {
      // Request notification permission
      const perm = await requestNotificationPermission();
      if (perm !== 'granted') {
        toggle.checked = false;
        statusEl.textContent = 'Notifications blocked. Enable in browser settings.';
        statusEl.style.color = 'var(--red)';
        return;
      }
      timeRow.style.display = '';
      const s = { enabled: true, time: timeInput.value };
      saveReminderSettings(s);
      updateReminderStatus(s);
    } else {
      timeRow.style.display = 'none';
      const s = { enabled: false, time: timeInput.value };
      saveReminderSettings(s);
      updateReminderStatus(s);
    }
  });

  timeInput.addEventListener('change', () => {
    const s = { enabled: toggle.checked, time: timeInput.value };
    saveReminderSettings(s);
    updateReminderStatus(s);
  });

  // Schedule existing reminder on load
  if (settings.enabled) scheduleReminder(settings);
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return await Notification.requestPermission();
}

function updateReminderStatus(settings) {
  const el = document.getElementById('reminder-status');
  if (!el) return;
  if (settings.enabled) {
    const [h, m] = settings.time.split(':');
    const hr = +h;
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const hr12 = hr === 0 ? 12 : (hr > 12 ? hr - 12 : hr);
    el.textContent = `Reminder set for ${hr12}:${m} ${ampm} daily`;
    el.style.color = 'var(--accent)';
  } else {
    el.textContent = '';
  }
}

let reminderTimerId = null;

function scheduleReminder(settings) {
  // Clear existing timer
  if (reminderTimerId) { clearTimeout(reminderTimerId); reminderTimerId = null; }
  if (!settings.enabled) return;

  const now = new Date();
  const [h, m] = settings.time.split(':').map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);

  // If time already passed today, schedule for tomorrow
  if (target <= now) target.setDate(target.getDate() + 1);

  const delay = target - now;

  reminderTimerId = setTimeout(() => {
    fireReminder();
    // Schedule next one for tomorrow
    scheduleReminder(settings);
  }, delay);
}

function fireReminder() {
  if (Notification.permission !== 'granted') return;

  // Calculate progress for today
  const di = (new Date().getDay() + 6) % 7;
  const wd = currentWeekData();
  const totalTasks = wd.days[di].tasks.length;
  const doneTasks = wd.days[di].tasks.filter(t => t.done).length;

  let doneHabits = 0;
  state.habitDefs.forEach(h => {
    const checks = wd.habitChecks[h.id] || [];
    const val = checks[di];
    if (h.target > 0) { if (typeof val === 'number' && val >= h.target) doneHabits++; }
    else { if (val) doneHabits++; }
  });
  const totalHabits = state.habitDefs.length;

  let body = '';
  if (totalHabits === 0 && totalTasks === 0) {
    body = "Start your day strong! Add some habits and tasks.";
  } else if (doneHabits === totalHabits && doneTasks === totalTasks) {
    body = "Amazing! You've completed everything today! 🎉";
  } else {
    const parts = [];
    if (totalHabits > 0) parts.push(`Habits: ${doneHabits}/${totalHabits}`);
    if (totalTasks > 0) parts.push(`Tasks: ${doneTasks}/${totalTasks}`);
    body = parts.join(' · ') + " — Keep going!";
  }

  const n = new Notification('GLGL', {
    body,
    icon: '/app/icon-192.png',
    badge: '/app/icon-192.png',
    tag: 'daily-reminder',
    renotify: true
  });

  n.addEventListener('click', () => {
    window.focus();
    n.close();
  });

  // Persist reminder to notification feed
  if (window.notifSync) {
    window.notifSync.addHabitReminderNotification().catch(e => console.error('[notif] reminder notif failed:', e.message));
  }
}

// Also register for service worker push if available
if ('serviceWorker' in navigator && 'Notification' in window) {
  navigator.serviceWorker.ready.then(reg => {
    // Let SW know about reminders on visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const settings = loadReminderSettings();
        if (settings.enabled) scheduleReminder(settings);
      }
    });
  });
}


// ===== DRAG & DROP (Touch + Mouse) =====

function initDragAndDrop(container, getItems, setItems, onReorder) {
  let dragItem = null;
  let dragStartY = 0;
  let dragOrigIdx = -1;
  let placeholder = null;
  let rows = [];

  function getRowElements() {
    return Array.from(container.querySelectorAll('.daily-list-row'));
  }

  function getYCenter(el) {
    const rect = el.getBoundingClientRect();
    return rect.top + rect.height / 2;
  }

  // TOUCH events
  container.addEventListener('touchstart', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const row = handle.closest('.daily-list-row');
    if (!row) return;

    e.preventDefault();
    startDrag(row, e.touches[0].clientY);
  }, { passive: false });

  container.addEventListener('touchmove', (e) => {
    if (!dragItem) return;
    e.preventDefault();
    moveDrag(e.touches[0].clientY);
  }, { passive: false });

  container.addEventListener('touchend', () => {
    if (dragItem) endDrag();
  });

  // MOUSE events
  container.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const row = handle.closest('.daily-list-row');
    if (!row) return;

    e.preventDefault();
    startDrag(row, e.clientY);

    const moveHandler = (ev) => {
      if (!dragItem) return;
      moveDrag(ev.clientY);
    };
    const upHandler = () => {
      endDrag();
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
    };
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
  });

  function startDrag(row, y) {
    rows = getRowElements();
    dragOrigIdx = rows.indexOf(row);
    if (dragOrigIdx === -1) return;

    dragItem = row;
    dragStartY = y;
    dragItem.classList.add('dragging');

    // Haptic feedback on drag start
    triggerHaptic('light');
  }

  function moveDrag(y) {
    if (!dragItem) return;
    const currentRows = getRowElements();

    // Clear all indicators
    currentRows.forEach(r => {
      r.classList.remove('drag-above', 'drag-below');
    });

    // Find drop position
    for (let i = 0; i < currentRows.length; i++) {
      if (currentRows[i] === dragItem) continue;
      const center = getYCenter(currentRows[i]);
      if (y < center) {
        currentRows[i].classList.add('drag-above');
        break;
      } else if (i === currentRows.length - 1 || y < getYCenter(currentRows[i + 1] || currentRows[i])) {
        currentRows[i].classList.add('drag-below');
        break;
      }
    }
  }

  function endDrag() {
    if (!dragItem) return;
    const currentRows = getRowElements();

    // Find the target position
    let targetIdx = dragOrigIdx;
    for (let i = 0; i < currentRows.length; i++) {
      if (currentRows[i].classList.contains('drag-above')) {
        targetIdx = i;
        if (i > dragOrigIdx) targetIdx--;
        break;
      }
      if (currentRows[i].classList.contains('drag-below')) {
        targetIdx = i;
        if (i < dragOrigIdx) targetIdx++;
        break;
      }
    }

    // Clean up classes
    currentRows.forEach(r => {
      r.classList.remove('dragging', 'drag-above', 'drag-below');
    });

    // Actually reorder if position changed
    if (targetIdx !== dragOrigIdx) {
      triggerHaptic('medium');
      onReorder(dragOrigIdx, targetIdx);
    }

    dragItem = null;
    dragOrigIdx = -1;
  }
}


// ===== ANIMATIONS & HAPTIC FEEDBACK =====

function triggerHaptic(style) {
  if (!navigator.vibrate) return;
  switch (style) {
    case 'light':
      navigator.vibrate(10);
      break;
    case 'medium':
      navigator.vibrate(20);
      break;
    case 'success':
      navigator.vibrate([15, 50, 15]);
      break;
    case 'celebration':
      navigator.vibrate([10, 30, 10, 30, 20]);
      break;
    default:
      navigator.vibrate(10);
  }
}

function createCelebrationParticles(element) {
  const rect = element.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ['var(--accent)', 'var(--blue)', 'var(--yellow)', '#e06c75', '#c678dd'];

  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI * 2 * i) / 8;
    const particle = document.createElement('div');
    particle.className = 'celebration-particle';
    particle.style.left = cx + 'px';
    particle.style.top = cy + 'px';
    particle.style.setProperty('--dx', Math.cos(angle) * 12 + 'px');
    particle.style.setProperty('--dy', Math.sin(angle) * 12 + 'px');
    particle.style.background = colors[i % colors.length];
    document.body.appendChild(particle);
    setTimeout(() => particle.remove(), 600);
  }
}

function animateCheckCompletion(checkElement, isCompleting) {
  if (isCompleting) {
    checkElement.classList.add('animate-check');
    createCelebrationParticles(checkElement);
    triggerHaptic('success');

    // Flash the parent row
    const row = checkElement.closest('.daily-list-row');
    if (row) {
      row.classList.add('completion-flash');
      setTimeout(() => row.classList.remove('completion-flash'), 400);
    }

    setTimeout(() => checkElement.classList.remove('animate-check'), 500);
  } else {
    triggerHaptic('light');
  }
}

// Check if ALL tasks+habits are done for today → big celebration
function checkAllDoneToday() {
  const di = getViewingDayIndex();
  const wd = currentWeekData();

  const totalTasks = wd.days[di].tasks.length;
  const doneTasks = wd.days[di].tasks.filter(t => t.done).length;

  let doneHabits = 0;
  state.habitDefs.forEach(h => {
    const checks = wd.habitChecks[h.id] || [];
    const val = checks[di];
    if (h.target > 0) { if (typeof val === 'number' && val >= h.target) doneHabits++; }
    else { if (val) doneHabits++; }
  });
  const totalHabits = state.habitDefs.length;

  if ((totalTasks + totalHabits > 0) && doneTasks === totalTasks && doneHabits === totalHabits) {
    triggerHaptic('celebration');
    // Fire particles from the donut
    const donut = document.getElementById('daily-overall-donut');
    if (donut) {
      for (let burst = 0; burst < 3; burst++) {
        setTimeout(() => createCelebrationParticles(donut), burst * 150);
      }
    }
    // Successful day notification
    if (window.notifSync) {
      window.notifSync.addSuccessfulDayNotification().catch(e => console.error('[notif] successful day failed:', e.message));
    }
  }
}
