import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        admin: resolve(process.cwd(), 'admin.html'),
        orders: resolve(process.cwd(), 'orders.html'),
        profile: resolve(process.cwd(), 'profile.html')
      }
    }
  }
});


