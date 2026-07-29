import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer build only — the Electron main/preload processes run as plain
// CommonJS Node files and are not bundled by Vite.
export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      // Two HTML entries: the main app and the always-on-top timer widget,
      // which loads in its own frameless BrowserWindow.
      input: {
        main: resolve(__dirname, 'src/index.html'),
        widget: resolve(__dirname, 'src/widget.html'),
      },
    },
  },
});
