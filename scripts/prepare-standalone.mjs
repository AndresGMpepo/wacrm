import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Next's standalone output intentionally excludes public/ and .next/static.
// Our Dockerfile copies them for its final image, but Easypanel's Nixpacks
// runtime starts the standalone server directly from the build directory.
// Put the assets alongside server.js so both deployment methods serve the
// same hashed JavaScript, CSS and fonts.
const root = process.cwd();
const standalone = join(root, '.next', 'standalone');
const staticSource = join(root, '.next', 'static');
const staticTarget = join(standalone, '.next', 'static');

if (!existsSync(standalone) || !existsSync(staticSource)) {
  throw new Error('Next standalone output is missing. Run this only after `next build`.');
}

rmSync(staticTarget, { recursive: true, force: true });
mkdirSync(join(standalone, '.next'), { recursive: true });
cpSync(staticSource, staticTarget, { recursive: true });

const publicSource = join(root, 'public');
if (existsSync(publicSource)) {
  const publicTarget = join(standalone, 'public');
  rmSync(publicTarget, { recursive: true, force: true });
  cpSync(publicSource, publicTarget, { recursive: true });
}
