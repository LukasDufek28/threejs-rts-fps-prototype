import { copyFile, cp, mkdir } from 'node:fs/promises';

await mkdir('public', { recursive: true });
await Promise.all([
  copyFile('index.html', 'public/index.html'),
  copyFile('app.js', 'public/app.js'),
  copyFile('audio.js', 'public/audio.js'),
  cp('assets/audio', 'public/assets/audio', { recursive: true })
]);
console.log('Static Vercel output created in public/.');
