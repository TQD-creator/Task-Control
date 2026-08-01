// App settings persisted to settings.json in the Electron userData dir.
// Currently just the Tavily API key for the live-web Guide feature. The key
// can also come from the TAVILY_API_KEY environment variable, which takes
// precedence — handy for dev without writing the key to disk.
//
// The raw key is never sent to the renderer (see main.js: the renderer can
// only ask *whether* a key is set, and set a new one). Keeping it in the main
// process limits its exposure to the sandboxed UI.

const fs = require('fs');
const path = require('path');
const { getUserDataDir } = require('./paths');

function settingsPath() {
  return path.join(getUserDataDir(), 'settings.json');
}

function loadSettings() {
  const p = settingsPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(settings, null, 2));
  return settings;
}

function getTavilyKey() {
  if (process.env.TAVILY_API_KEY) return process.env.TAVILY_API_KEY.trim();
  const key = loadSettings().tavily_api_key;
  return key ? key.trim() : null;
}

function setTavilyKey(key) {
  const settings = loadSettings();
  settings.tavily_api_key = (key || '').trim();
  saveSettings(settings);
}

function hasTavilyKey() {
  return !!getTavilyKey();
}

// Optional path to the Mirror executable, used only to launch it after a
// "Send to Mirror" handoff. Absent by default — Mirror is not packaged yet, and
// the handoff works without it because Mirror finds the snapshot itself.
function getMirrorPath() {
  if (process.env.MIRROR_PATH) return process.env.MIRROR_PATH.trim();
  const value = loadSettings().mirror_path;
  return value ? value.trim() : null;
}

module.exports = { getTavilyKey, setTavilyKey, hasTavilyKey, getMirrorPath };
