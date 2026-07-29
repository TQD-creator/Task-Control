// Resolves the same per-app data directory Electron's app.getPath('userData')
// would give the running app — duplicated here (rather than requiring
// 'electron') so seed-example.js can point at the exact same db/profile
// files while running as plain Node, outside the Electron process.

const os = require('os');
const path = require('path');

const APP_NAME = 'task-control-desktop';

function getUserDataDir() {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_NAME);
  }
}

module.exports = { getUserDataDir };