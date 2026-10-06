// Boundary rule: nothing under packages/, gaze_analysis/ or shared/ may import from mock/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n === '__pycache__') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|py|js|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

test('portable packages never import from mock/', () => {
  const root = join(__dirname, '..');
  const offenders: string[] = [];
  for (const f of ['packages', 'gaze_analysis', 'shared'].flatMap((d) => walk(join(root, d)))) {
    const src = readFileSync(f, 'utf8');
    const ts = /(?:from\s+|import\s*\(\s*)['"][^'"]*(?:^|\/)mock\//m;
    const py = /^\s*(?:from\s+mock(?:\.|\s)|import\s+mock(?:\.|\s|$))/m;
    if (ts.test(src) || py.test(src)) offenders.push(f.replace(root + '/', ''));
  }
  expect(offenders).toEqual([]);
});
