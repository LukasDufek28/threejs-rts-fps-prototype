import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('public', { recursive: true });
await Promise.all([
  copyFile('index.html', 'public/index.html'),
  copyFile('app.js', 'public/app.js')
]);
console.log('Static Vercel output created in public/.');
