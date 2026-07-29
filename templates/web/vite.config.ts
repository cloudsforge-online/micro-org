import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// No `define` block and no env prefix. Anything injected here becomes part of the artifact, and
// an artifact that carries its environment cannot be promoted from staging to production.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
  server: { port: 5173 },
});
