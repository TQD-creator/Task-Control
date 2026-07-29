// Spawns the real electron.exe with ELECTRON_RUN_AS_NODE removed from its
// environment. Some dev shells (VSCode's Electron-based integrated terminal,
// this laptop's Claude Code sandbox) set that var globally, which makes any
// Electron binary run as plain Node instead of launching the app — setting
// it to an empty string isn't enough, Electron checks for the key's
// *presence*, so it has to actually be deleted before the process spawns.

const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
