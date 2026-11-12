import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Served as-is so its new URL('ort-wasm-simd-threaded.wasm', import.meta.url) resolves next to it in dev.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: {
    port: 5174,
    host: true
  },
  preview: {
    port: 5174,
    host: true
  }
});

