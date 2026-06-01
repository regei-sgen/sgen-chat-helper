import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@kb/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    // Bind on all interfaces so the custom local hostname
    // (sg-help-admin.test -> 127.0.0.1 in your hosts file) reaches the dev server.
    host: true,
    port: 5173,
    // Vite >= 5.4.12 rejects requests whose Host header isn't allow-listed
    // (DNS-rebinding protection). The dev domain must be added here.
    allowedHosts: ['sg-help-admin.test', 'localhost'],
    proxy: {
      // Internal server-to-server hop (Vite dev server -> API). Loopback is
      // intentional and does NOT depend on the hosts-file entry.
      '/api-proxy': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api-proxy/, ''),
      },
    },
  },
});
