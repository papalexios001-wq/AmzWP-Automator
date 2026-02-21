import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react()],
    // We treat the root directory as the src directory per project requirements
    root: '.',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    define: {
      // Robustly polyfill process.env.API_KEY for the SDK
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
    },
  };
});