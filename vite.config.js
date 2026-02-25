import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'web',
  server: {
    host: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' }
    }
  },
  resolve: {
    alias: {
      '@modules': resolve(__dirname, 'modules')
    }
  }
});
