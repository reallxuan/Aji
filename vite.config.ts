import process from 'node:process';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development, applied in `tauri dev` and `tauri build`:
  // 1. keep Rust errors visible instead of clearing the screen
  clearScreen: false,
  // 2. Tauri expects a fixed port, so fail if it is taken
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    // 3. do not watch the Rust side
    watch: { ignored: ['**/src-tauri/**'] },
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    // Vitest empties CSS imports by default; the token test reads theme.css as raw text.
    css: { include: [/theme\.css/] },
  },
});
