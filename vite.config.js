import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
        orders: resolve(import.meta.dirname, 'orders.html'),
        profile: resolve(import.meta.dirname, 'profile.html')
      }
    }
  }
});
