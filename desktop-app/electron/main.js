const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const db = require('./db/database');
const profileEngine = require('./profile/profileEngine');
const aiService = require('./services/AI_Service');
const guideService = require('./services/guideService');
const timerService = require('./services/timerService');
const settings = require('./settings');
const { getUserDataDir } = require('./paths');

const isDev = process.env.NODE_ENV === 'development';

// The single floating timer widget window (there is only ever one, matching
// the single-active-timer model). Held at module scope so repeated "open
// timer" clicks focus the existing window instead of spawning duplicates.
let widgetWindow = null;

function getProfilePath() {
  return path.join(getUserDataDir(), 'user_profile.json');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// The floating, always-on-top Milestone & Task Timer. Frameless + resizable so
// it reads as a small desktop widget the user can drag (via the CSS
// -webkit-app-region: drag header) and resize.
function createWidgetWindow(milestoneId) {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    if (milestoneId != null) timerService.setMilestone(milestoneId);
    widgetWindow.focus();
    return widgetWindow;
  }

  widgetWindow = new BrowserWindow({
    width: 320,
    height: 380,
    minWidth: 260,
    minHeight: 300,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // "Always on top" native API — 'floating' keeps it above ordinary windows;
  // the second call ensures it also floats over full-screen apps on Windows.
  widgetWindow.setAlwaysOnTop(true, 'floating');
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (milestoneId != null) timerService.setMilestone(milestoneId);

  if (isDev) {
    widgetWindow.loadURL('http://localhost:5173/widget.html');
  } else {
    widgetWindow.loadFile(path.join(__dirname, '..', 'dist', 'widget.html'));
  }

  widgetWindow.on('closed', () => {
    widgetWindow = null;
    // A closed widget commits its running session (spec req 3), then flushes
    // that session->total write to disk immediately for durability.
    timerService.handleWidgetClosed();
    db.persist({ immediate: true });
  });

  return widgetWindow;
}

// Push a timer snapshot to every open window so the widget and the main app
// stay in sync on which task is active.
function broadcastTimerState(snapshot) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('timer:state', snapshot);
  }
}

// Notify every window when the tone (Unga Bunga vs. encouraging) changes, so the
// floating widget swaps its confrontational copy live without a reopen.
function broadcastTone(tone) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('profile:tone', tone);
  }
}

app.whenReady().then(async () => {
  await db.initDatabase(path.join(getUserDataDir(), 'task_control.db'));

  timerService.init({
    onBroadcast: broadcastTimerState,
    // A finished "Tanking Boredom" session is handed back here to log — the
    // timer service is profile-agnostic, so the ledger write lives in main.
    onBoredomEnd: (seconds) => {
      if (seconds <= 0) return;
      const profilePath = getProfilePath();
      const profile = profileEngine.loadProfile(profilePath);
      profileEngine.logBoredom(profile, seconds);
      profileEngine.saveProfile(profilePath, profile);
      db.persist({ immediate: true });
    },
  });

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Force any debounced DB write to disk synchronously before the process exits,
// so a quit never drops the last ≤1.5s of coalesced mutations.
app.on('before-quit', () => {
  try { db.persist({ immediate: true }); } catch { /* nothing better to do on exit */ }
});

function registerIpcHandlers() {
  // Goals
  ipcMain.handle('goals:create', (_e, payload) => db.createGoal(payload));
  ipcMain.handle('goals:list', () => db.getGoals());
  ipcMain.handle('goals:get', (_e, id) => db.getGoalById(id));
  ipcMain.handle('goals:update', (_e, id, fields) => db.updateGoal(id, fields));
  ipcMain.handle('goals:delete', (_e, id) => db.deleteGoal(id));

  // Milestones
  ipcMain.handle('milestones:create', (_e, payload) => db.createMilestone(payload));
  ipcMain.handle('milestones:listByGoal', (_e, goalId) => db.getMilestonesByGoal(goalId));
  ipcMain.handle('milestones:get', (_e, id) => db.getMilestoneById(id));
  ipcMain.handle('milestones:update', (_e, id, fields) => db.updateMilestone(id, fields));
  ipcMain.handle('milestones:delete', (_e, id) => db.deleteMilestone(id));

  // Tasks
  ipcMain.handle('tasks:create', (_e, payload) => db.createTask(payload));
  ipcMain.handle('tasks:listByMilestone', (_e, milestoneId) => db.getTasksByMilestone(milestoneId));
  ipcMain.handle('tasks:activeQueue', () => db.getActiveTaskQueue());
  ipcMain.handle('tasks:update', (_e, id, fields) => db.updateTask(id, fields));
  ipcMain.handle('tasks:delete', (_e, id) => db.deleteTask(id));

  // Complete a task: DB completion + Personalization Engine update, in one
  // round trip so the renderer never has to sequence the two itself.
  ipcMain.handle('tasks:complete', (_e, { taskId, actualMinutes, justification }) => {
    const task = db.completeTask(taskId, actualMinutes);

    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    const { penaltyPending } = profileEngine.recordTaskCompletion(profile, task, { justification });
    profileEngine.saveProfile(profilePath, profile);

    // penaltyPending: a defense-mechanism overrun in Unga Bunga tone — the
    // renderer will show the punishment menu and serve the choice separately.
    return { task, profile, penaltyPending };
  });

  // Timeline shifts
  ipcMain.handle('timeline:shiftTask', (_e, taskId, deltaDays) => db.shiftTaskTimeline(taskId, deltaDays));
  ipcMain.handle('timeline:shiftMilestone', (_e, milestoneId, deltaDays) => db.shiftMilestoneTimeline(milestoneId, deltaDays));

  // Profile
  ipcMain.handle('profile:load', () => profileEngine.loadProfile(getProfilePath()));
  ipcMain.handle('profile:addBigVagueGoal', (_e, goalId, text) => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    profileEngine.addBigVagueGoal(profile, goalId, text);
    profileEngine.saveProfile(profilePath, profile);
    return profile;
  });

  // Unga Bunga mode controls. Each mutates + persists the profile and returns
  // the updated copy so the renderer can re-render from the source of truth.
  ipcMain.handle('profile:setTone', (_e, tone) => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    profileEngine.setTone(profile, tone);
    profileEngine.saveProfile(profilePath, profile);
    broadcastTone(tone);
    return profile;
  });
  ipcMain.handle('profile:setFocusLock', (_e, taskId, reason) => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    profileEngine.setFocusLock(profile, taskId ?? null, reason || 'manual');
    profileEngine.saveProfile(profilePath, profile);
    return profile;
  });
  ipcMain.handle('profile:clearFocusLock', () => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    profileEngine.clearFocusLock(profile);
    profileEngine.saveProfile(profilePath, profile);
    return profile;
  });
  // Serve a punishment chosen from the post-overrun menu. Logs it, and if it's
  // the harsh 'lock' option, arms the single-task penalty lock until tomorrow.
  ipcMain.handle('profile:servePunishment', (_e, punishment) => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    profileEngine.servePunishment(profile, punishment);
    profileEngine.saveProfile(profilePath, profile);
    return profile;
  });

  // AI
  ipcMain.handle('ai:generateMilestonePlan', async (_e, bigVagueGoal) => {
    const profile = profileEngine.loadProfile(getProfilePath());
    return aiService.generateMilestonePlan(bigVagueGoal, profile);
  });

  ipcMain.handle('ai:analyzeCapture', async (_e, rawText, category) => {
    const profile = profileEngine.loadProfile(getProfilePath());
    return aiService.analyzeCapture(rawText, category, profile);
  });

  // Settings (Tavily key). The raw key is never returned to the renderer —
  // it can only check presence or set a new one.
  ipcMain.handle('settings:hasTavilyKey', () => settings.hasTavilyKey());
  ipcMain.handle('settings:setTavilyKey', (_e, key) => {
    settings.setTavilyKey(key);
    return settings.hasTavilyKey();
  });

  // Almighty Guide — the live-web RAG pipeline. Builds context from the task's
  // own row + its milestone + goal, then runs the agentic loop, streaming
  // phase progress back to the requesting window on 'guide:progress'.
  ipcMain.handle('guide:generate', async (event, taskId) => {
    const task = db.getTaskById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);
    const milestone = db.getMilestoneById(task.milestone_id);
    const goal = db.getGoalById(milestone.goal_id);

    const ctx = {
      goalTitle: goal.title,
      goalCategory: goal.category, // frames the search (Self-Improvement / Creative / Project Idea)
      goalAction: goal.action,
      goalArtifact: goal.artifact,
      goalDescription: goal.description,
      milestoneTitle: milestone.title,
      stepTitle: task.title,
      stepAction: task.action,
      stepArtifact: task.artifact,
    };

    const onProgress = (phase, extra = {}) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('guide:progress', { taskId, phase, ...extra });
      }
    };

    return guideService.generateGuide(ctx, { onProgress });
  });

  // Milestone & Task Timer — the authority is timerService (main process);
  // these handlers are just the renderer's remote control. play() enforces the
  // single-active rule and broadcasts new state to every window itself.
  ipcMain.handle('timer:openWidget', (_e, milestoneId) => {
    createWidgetWindow(milestoneId);
    return timerService.getState();
  });
  ipcMain.handle('timer:getState', () => timerService.getState());
  ipcMain.handle('timer:play', (_e, taskId) => timerService.play(taskId));
  ipcMain.handle('timer:pause', () => {
    const snap = timerService.pause();
    db.persist({ immediate: true }); // session->total is a durability point
    return snap;
  });
  ipcMain.handle('timer:close', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
    return timerService.getState();
  });
  // "Tanking Boredom" — time resistance itself. stopBoredom's ledger write +
  // persist happen in the onBoredomEnd callback wired at init().
  ipcMain.handle('timer:startBoredom', () => timerService.startBoredom());
  ipcMain.handle('timer:stopBoredom', () => timerService.stopBoredom());
}
