import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');

if (fs.existsSync(dist)) {
  const routes = ['orders', 'profile', 'admin'];
  for (const route of routes) {
    const srcHtml = path.join(dist, `${route}.html`);
    const targetDir = path.join(dist, route);
    if (fs.existsSync(srcHtml)) {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.copyFileSync(srcHtml, path.join(targetDir, 'index.html'));
      console.log(`[postbuild] Created directory route /${route}/index.html`);
    }
  }

  const indexHtml = path.join(dist, 'index.html');
  const fallback404 = path.join(dist, '404.html');
  if (fs.existsSync(indexHtml) && !fs.existsSync(fallback404)) {
    fs.copyFileSync(indexHtml, fallback404);
    console.log('[postbuild] Created 404.html fallback');
  }
}
