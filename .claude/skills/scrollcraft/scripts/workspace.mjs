#!/usr/bin/env node
/* Resolve (and optionally create) the scrollcraft workspace.
   First hit wins:
     1. SCROLLCRAFT_HOME
     2. nearest .scrollcraft.json walking up:  { "workspace": "path/to/builds" }
     3. <project root>/scrollcraft            (project root = nearest .git, else cwd)
   Resolved rather than assumed, so a build never lands somewhere surprising. */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

export function findProjectRoot(from = process.cwd()) {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(from);
    dir = up;
  }
}

export function resolveWorkspace(from = process.cwd()) {
  if (process.env.SCROLLCRAFT_HOME) {
    return { dir: path.resolve(process.env.SCROLLCRAFT_HOME), via: 'SCROLLCRAFT_HOME' };
  }
  let dir = path.resolve(from);
  for (;;) {
    const cfg = path.join(dir, '.scrollcraft.json');
    if (fs.existsSync(cfg)) {
      try {
        const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
        if (j.workspace) return { dir: path.resolve(dir, j.workspace), via: cfg };
      } catch (e) {
        throw new Error(`.scrollcraft.json at ${cfg} is not valid JSON: ${e.message}`);
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { dir: path.join(findProjectRoot(from), 'scrollcraft'), via: 'default (<project root>/scrollcraft)' };
}

export function ensureWorkspace(from = process.cwd()) {
  const ws = resolveWorkspace(from);
  fs.mkdirSync(path.join(ws.dir, 'builds'), { recursive: true });
  const reg = path.join(ws.dir, 'FINGERPRINTS.md');
  if (!fs.existsSync(reg)) {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    fs.copyFileSync(path.join(here, '..', 'templates', 'FINGERPRINTS.md'), reg);
  }
  return { ...ws, registry: reg };
}

/** Copy the engine into a build folder. The engine is the mechanism and is
 *  never edited per project — each build gets its own frozen copy. */
export function installEngine(buildDir) {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = path.join(here, '..', 'engine');
  const dst = path.join(buildDir, 'engine');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  return dst;
}

if (import.meta.url === url.pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const ws = args.includes('--ensure') ? ensureWorkspace() : resolveWorkspace();
  console.log(`workspace : ${ws.dir}`);
  console.log(`resolved  : ${ws.via}`);
  console.log(`builds    : ${path.join(ws.dir, 'builds')}`);
  console.log(`registry  : ${path.join(ws.dir, 'FINGERPRINTS.md')}`);
  if (!args.includes('--ensure') && !fs.existsSync(ws.dir)) {
    console.log('\n(does not exist yet — run with --ensure to create it)');
  }
}
