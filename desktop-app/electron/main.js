const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, nativeImage, shell } = require('electron');

const db = require('./db/database');
const profileEngine = require('./profile/profileEngine');
const aiService = require('./services/AI_Service');
const guideService = require('./services/guideService');
const timerService = require('./services/timerService');
const reminderService = require('./services/reminderService');
const followUpEngine = require('./services/followUpEngine');
const settings = require('./settings');
const { getUserDataDir, getAppDataDir } = require('./paths');

const isDev = process.env.NODE_ENV === 'development';

// The single floating timer widget window (there is only ever one, matching
// the single-active-timer model). Held at module scope so repeated "open
// timer" clicks focus the existing window instead of spawning duplicates.
let widgetWindow = null;
// The main app window + tray, held at module scope so reminders and the tray
// menu can raise/focus the window even after it's been closed to the tray.
let mainWindow = null;
let tray = null;

function getProfilePath() {
  return path.join(getUserDataDir(), 'user_profile.json');
}

function getDbPath() {
  return path.join(getUserDataDir(), 'task_control.db');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Bring the main window to the front (from a tray click or a reminder), or
// recreate it if it was closed.
function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

// System tray so the app can keep running (and deliver reminders) after the
// window is closed. Icon is a small PNG shipped under build/; if it's somehow
// missing we fall back to an empty image rather than crashing.
function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, '..', 'build', 'tray.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Task Control');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Task Control', click: showMainWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ])
  );
  tray.on('click', showMainWindow);
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

// Focus the app and ask the renderer to switch to a screen (used when a
// follow-up notification is clicked → open the Follow-ups inbox).
function navigateMain(screen) {
  showMainWindow();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('main:navigate', screen);
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
  createTray();

  // Due / overdue task + follow-up reminders. Gated on the profile flag, re-read
  // each pass so toggling it in-app takes effect without a restart. Deferred
  // while a focus lock is active (isLocked) so nothing nags during Lock In /
  // Leisure Loan. A task-reminder click focuses the app; a follow-up click also
  // routes to the in-app Follow-ups inbox.
  reminderService.start({
    db,
    isEnabled: () => profileEngine.loadProfile(getProfilePath()).personalization?.notifications_enabled !== false,
    isLocked: () => profileEngine.loadProfile(getProfilePath()).focus_lock?.active === true,
    onActivate: showMainWindow,
    onFollowUpActivate: () => navigateMain('followups'),
    onChoreActivate: () => navigateMain('chores'),
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

// The tray keeps the app alive after the last window closes, so reminders keep
// firing. Quit explicitly from the tray menu (which sets app.isQuitting).
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (app.isQuitting) app.quit();
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

  // Aggregate completion stats for the Insights screen.
  ipcMain.handle('stats:overview', () => db.getCompletionStats());
  // Adaptive layer: reliability (on-time/late/slipped) + upcoming planned load.
  ipcMain.handle('stats:reliability', () => db.getReliabilityStats());
  ipcMain.handle('stats:scheduleLoad', (_e, days) => db.getScheduleLoad(null, days || 14));
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

  // Leisure Loan: borrow play time now, repay as forced focus (1.25x) after.
  // status is a pure read of the gate/limits; the rest mutate + persist. Each
  // load runs normalizeProfile -> normalizeLeisureLoan, so the daily reset,
  // escape-proofing, and timed release are enforced on every call.
  ipcMain.handle('leisure:status', () => {
    const profile = profileEngine.loadProfile(getProfilePath());
    return profileEngine.leisureLoanStatus(profile);
  });
  ipcMain.handle('leisure:start', (_e, minutes, taskId) => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    const result = profileEngine.startLeisureLoan(profile, { minutes, taskId: taskId ?? null });
    profileEngine.saveProfile(profilePath, profile);
    return { ok: result.ok, reason: result.reason ?? null, profile };
  });
  ipcMain.handle('leisure:beginPrep', () => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    profileEngine.beginLeisurePrep(profile);
    profileEngine.saveProfile(profilePath, profile);
    return profile;
  });
  ipcMain.handle('leisure:beginRepay', () => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    profileEngine.beginLeisureRepay(profile);
    profileEngine.saveProfile(profilePath, profile);
    return profile;
  });
  ipcMain.handle('leisure:finish', () => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    profileEngine.finishLeisureLoan(profile);
    profileEngine.saveProfile(profilePath, profile);
    return profile;
  });

  // Toggle due/overdue reminders. reminderService re-reads this each pass.
  ipcMain.handle('profile:setNotifications', (_e, enabled) => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    profileEngine.setNotificationsEnabled(profile, enabled);
    profileEngine.saveProfile(profilePath, profile);
    return profile;
  });

  // Close the time-economy loop: draw the Time Debt / Guilt-Free Bank back down.
  // Both engine helpers clamp to the available balance, so an over-large amount
  // is safe. Each logs its own ledger entry.
  ipcMain.handle('profile:repayTimeDebt', (_e, minutes, note) => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    profileEngine.repayTimeDebt(profile, minutes, note ?? null);
    profileEngine.saveProfile(profilePath, profile);
    return profile;
  });
  ipcMain.handle('profile:spendBank', (_e, minutes, note) => {
    const profilePath = getProfilePath();
    const profile = profileEngine.loadProfile(profilePath);
    profileEngine.spendGuiltFreeBank(profile, minutes, note ?? null);
    profileEngine.saveProfile(profilePath, profile);
    return profile;
  });

  // Data safety — export/import the DB + profile. Built-in dialog + fs only.
  ipcMain.handle('data:export', async () => {
    db.persist({ immediate: true }); // flush any debounced writes to disk first
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Task Control backup',
      defaultPath: `task-control-backup-${stamp}`,
      properties: ['createDirectory'],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const dir = res.filePath;
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = getDbPath();
    const profilePath = getProfilePath();
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, path.join(dir, 'task_control.db'));
    if (fs.existsSync(profilePath)) fs.copyFileSync(profilePath, path.join(dir, 'user_profile.json'));
    return { ok: true, dir };
  });

  // Hand the current data to Mirror (the companion reflection app). Same shape
  // as data:export, minus the dialog: the destination is fixed so Mirror can
  // find the snapshot on its own without any cross-process channel between the
  // two apps. Mirror only ever reads these copies.
  ipcMain.handle('data:sendToMirror', async () => {
    try {
      db.persist({ immediate: true }); // flush the 1.5s debounce before copying
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const dir = path.join(getAppDataDir('mirror'), 'snapshots', stamp);
      fs.mkdirSync(dir, { recursive: true });

      const dbPath = getDbPath();
      const profilePath = getProfilePath();
      if (!fs.existsSync(dbPath) || !fs.existsSync(profilePath)) {
        return { ok: false, error: 'Task Control has no data to send yet.' };
      }
      fs.copyFileSync(dbPath, path.join(dir, 'task_control.db'));
      fs.copyFileSync(profilePath, path.join(dir, 'user_profile.json'));
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
        capturedAt: new Date().toISOString(),
        sourceDir: getUserDataDir(),
        source: 'task-control',
      }, null, 2));

      // Launching Mirror is best-effort: it is not packaged, so a configured
      // path may not exist. The snapshot is already on disk either way, and
      // Mirror finds it by itself on next start.
      let launched = false;
      const mirrorPath = settings.getMirrorPath();
      if (mirrorPath && fs.existsSync(mirrorPath)) {
        try {
          require('child_process').spawn(mirrorPath, [dir], { detached: true, stdio: 'ignore' }).unref();
          launched = true;
        } catch {
          launched = false;
        }
      }

      return { ok: true, dir, launched };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('data:revealPath', async (_e, target) => {
    if (!target || !fs.existsSync(target)) return { ok: false };
    await shell.openPath(target);
    return { ok: true };
  });

  ipcMain.handle('data:import', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Restore from a Task Control backup folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true };
    const dir = res.filePaths[0];
    const srcDb = path.join(dir, 'task_control.db');
    const srcProfile = path.join(dir, 'user_profile.json');
    if (!fs.existsSync(srcDb) || !fs.existsSync(srcProfile)) {
      return { ok: false, error: 'That folder is missing task_control.db or user_profile.json.' };
    }
    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Replace & Restart'],
      defaultId: 0,
      cancelId: 0,
      title: 'Restore backup',
      message: 'This replaces your current tasks and profile with the backup, then restarts the app.',
      detail: 'Your current data will be backed up alongside the files first.',
    });
    if (confirm.response !== 1) return { ok: false, canceled: true };

    db.persist({ immediate: true });
    const dbPath = getDbPath();
    const profilePath = getProfilePath();
    const bak = `.bak-${Date.now()}`;
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, dbPath + bak);
    if (fs.existsSync(profilePath)) fs.copyFileSync(profilePath, profilePath + bak);
    fs.copyFileSync(srcDb, dbPath);
    fs.copyFileSync(srcProfile, profilePath);

    // The DB is loaded into memory once at boot, so a restart is the clean way
    // to pick up the restored files.
    app.isQuitting = true;
    app.relaunch();
    app.exit(0);
    return { ok: true };
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

  // Prep suggestions — the local model proposes tools/checklist + follow-ups
  // from the task (+ its milestone/goal context). Advisory only: nothing is
  // saved until the user approves in the Prep screen. Throws propagate to the
  // renderer, which keeps the screen usable manually if Ollama is down.
  ipcMain.handle('ai:generatePrep', async (_e, taskId) => {
    const task = db.getTaskById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);
    const milestone = db.getMilestoneById(task.milestone_id);
    const goal = milestone ? db.getGoalById(milestone.goal_id) : null;
    const ctx = {
      goalTitle: goal?.title,
      goalCategory: goal?.category,
      milestoneTitle: milestone?.title,
      stepTitle: task.title,
      stepAction: task.action,
      stepArtifact: task.artifact,
    };
    const profile = profileEngine.loadProfile(getProfilePath());
    return aiService.generatePrep(task, ctx, profile);
  });

  // Follow-ups — the loose ends a task leaves behind. Deterministic CRUD; the
  // state machine (followUpEngine) computes each transition and nudge time.
  ipcMain.handle('followups:byTask', (_e, taskId) => db.getFollowUpsByTask(taskId));
  ipcMain.handle('followups:pending', () => db.getPendingFollowUps());
  ipcMain.handle('followups:create', (_e, payload = {}) => {
    const { taskId, kind = 'custom', label, question = null, dueDate = null, repeatMinutes = 120 } = payload;
    const nextNudgeAt = followUpEngine.initialNudgeAt({ kind, dueDate });
    return db.createFollowUp({ taskId, kind, label, question, dueDate, repeatMinutes, nextNudgeAt });
  });
  ipcMain.handle('followups:answer', (_e, id, answer) => {
    const fu = db.getFollowUpById(id);
    if (!fu) return null;
    return db.updateFollowUp(id, followUpEngine.applyAnswer(fu, answer));
  });
  ipcMain.handle('followups:delete', (_e, id) => {
    db.deleteFollowUp(id);
    return true;
  });

  // Quick Note pad — low-friction capture. Classification (kind) is decided in
  // the renderer via the slash-command parser; these are thin CRUD.
  ipcMain.handle('notes:list', () => db.getNotes());
  ipcMain.handle('notes:openQueue', () => db.getOpenClassifiedNotes());
  ipcMain.handle('notes:create', (_e, payload = {}) => db.createNote({ text: payload.text, kind: payload.kind || 'note' }));
  ipcMain.handle('notes:update', (_e, id, fields) => db.updateNote(id, fields || {}));
  ipcMain.handle('notes:delete', (_e, id) => { db.deleteNote(id); return true; });

  // Chores — one-off / daily reminders that live outside the Goals tree.
  ipcMain.handle('chores:list', () => db.getChores());
  ipcMain.handle('chores:create', (_e, payload = {}) => db.createChore({
    title: payload.title,
    recurrence: payload.recurrence || 'daily',
    timeOfDay: payload.timeOfDay ?? null,
    dueDate: payload.dueDate ?? null,
    sourceNoteId: payload.sourceNoteId ?? null,
  }));
  ipcMain.handle('chores:update', (_e, id, fields) => db.updateChore(id, fields || {}));
  ipcMain.handle('chores:markDone', (_e, id) => db.markChoreDone(id));
  ipcMain.handle('chores:delete', (_e, id) => { db.deleteChore(id); return true; });

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
