const { contextBridge, ipcRenderer } = require('electron');

// Thin, explicit surface exposed to the renderer as window.api — no raw
// ipcRenderer access, so the renderer can never invoke an arbitrary channel.
contextBridge.exposeInMainWorld('api', {
  goals: {
    create: (payload) => ipcRenderer.invoke('goals:create', payload),
    list: () => ipcRenderer.invoke('goals:list'),
    get: (id) => ipcRenderer.invoke('goals:get', id),
    update: (id, fields) => ipcRenderer.invoke('goals:update', id, fields),
    delete: (id) => ipcRenderer.invoke('goals:delete', id),
  },
  milestones: {
    create: (payload) => ipcRenderer.invoke('milestones:create', payload),
    listByGoal: (goalId) => ipcRenderer.invoke('milestones:listByGoal', goalId),
    get: (id) => ipcRenderer.invoke('milestones:get', id),
    update: (id, fields) => ipcRenderer.invoke('milestones:update', id, fields),
    delete: (id) => ipcRenderer.invoke('milestones:delete', id),
  },
  tasks: {
    create: (payload) => ipcRenderer.invoke('tasks:create', payload),
    listByMilestone: (milestoneId) => ipcRenderer.invoke('tasks:listByMilestone', milestoneId),
    activeQueue: () => ipcRenderer.invoke('tasks:activeQueue'),
    update: (id, fields) => ipcRenderer.invoke('tasks:update', id, fields),
    delete: (id) => ipcRenderer.invoke('tasks:delete', id),
    complete: (taskId, actualMinutes, justification) =>
      ipcRenderer.invoke('tasks:complete', { taskId, actualMinutes, justification }),
  },
  timeline: {
    shiftTask: (taskId, deltaDays) => ipcRenderer.invoke('timeline:shiftTask', taskId, deltaDays),
    shiftMilestone: (milestoneId, deltaDays) => ipcRenderer.invoke('timeline:shiftMilestone', milestoneId, deltaDays),
  },
  profile: {
    load: () => ipcRenderer.invoke('profile:load'),
    addBigVagueGoal: (goalId, text) => ipcRenderer.invoke('profile:addBigVagueGoal', goalId, text),
    setTone: (tone) => ipcRenderer.invoke('profile:setTone', tone),
    setFocusLock: (taskId, reason) => ipcRenderer.invoke('profile:setFocusLock', taskId, reason),
    clearFocusLock: () => ipcRenderer.invoke('profile:clearFocusLock'),
    servePunishment: (punishment) => ipcRenderer.invoke('profile:servePunishment', punishment),
    // Subscribe to tone changes (Unga Bunga toggled); returns an unsubscribe fn.
    onToneChange: (callback) => {
      const handler = (_e, tone) => callback(tone);
      ipcRenderer.on('profile:tone', handler);
      return () => ipcRenderer.removeListener('profile:tone', handler);
    },
  },
  ai: {
    generateMilestonePlan: (bigVagueGoal) => ipcRenderer.invoke('ai:generateMilestonePlan', bigVagueGoal),
    analyzeCapture: (rawText, category) => ipcRenderer.invoke('ai:analyzeCapture', rawText, category),
  },
  settings: {
    hasTavilyKey: () => ipcRenderer.invoke('settings:hasTavilyKey'),
    setTavilyKey: (key) => ipcRenderer.invoke('settings:setTavilyKey', key),
  },
  guide: {
    generate: (taskId) => ipcRenderer.invoke('guide:generate', taskId),
    // Subscribe to phase-progress events; returns an unsubscribe fn.
    onProgress: (callback) => {
      const handler = (_e, payload) => callback(payload);
      ipcRenderer.on('guide:progress', handler);
      return () => ipcRenderer.removeListener('guide:progress', handler);
    },
  },
  timer: {
    openWidget: (milestoneId) => ipcRenderer.invoke('timer:openWidget', milestoneId),
    getState: () => ipcRenderer.invoke('timer:getState'),
    play: (taskId) => ipcRenderer.invoke('timer:play', taskId),
    pause: () => ipcRenderer.invoke('timer:pause'),
    close: () => ipcRenderer.invoke('timer:close'),
    startBoredom: () => ipcRenderer.invoke('timer:startBoredom'),
    stopBoredom: () => ipcRenderer.invoke('timer:stopBoredom'),
    // Subscribe to authoritative timer-state broadcasts; returns an unsubscribe fn.
    onState: (callback) => {
      const handler = (_e, snapshot) => callback(snapshot);
      ipcRenderer.on('timer:state', handler);
      return () => ipcRenderer.removeListener('timer:state', handler);
    },
  },
});
