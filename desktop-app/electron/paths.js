// Resolves the same per-app data directory Electron's app.getPath('userData')
// would give the running app — duplicated here (rather than requiring
// 'electron') so seed-example.js can point at the exact same db/profile
// files while running as plain Node, outside the Electron process.

const os = require('os');
const path = require('path');

const APP_NAME = 'task-control-desktop';

// Generalised over the app name so the Mirror handoff can resolve Mirror's own
// data directory with the same platform rules, rather than a second copy of
// this switch living somewhere else.
function getAppDataDir(appName) {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', appName);
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName);
  }
}

function getUserDataDir() {
  return getAppDataDir(APP_NAME);
}

module.exports = { getUserDataDir, getAppDataDir };