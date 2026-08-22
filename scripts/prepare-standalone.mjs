import { cp, mkdir } from 'node:fs/promises';

const standaloneRoot = '.next/standalone';

await mkdir(`${standaloneRoot}/.next`, { recursive: true });
await Promise.all([
  cp('.next/static', `${standaloneRoot}/.next/static`, { recursive: true, force: true }),
  cp('public', `${standaloneRoot}/public`, { recursive: true, force: true }),
]);

console.log('Standalone runtime prepared with static and public assets.');
