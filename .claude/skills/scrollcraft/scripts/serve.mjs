#!/usr/bin/env node
/* A real origin for a build. file:// lies: it changes how video loads, how
   fonts resolve and what the canvas will let you read back, so every build is
   verified over http. No dependencies. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const portArg = process.argv.indexOf('--port');
const port = portArg > -1 ? +process.argv[portArg + 1] : 4477;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
};

http.createServer((req, res) => {
  const clean = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, clean);
  if (!path.resolve(file).startsWith(root)) { res.writeHead(403).end('no'); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('not found: ' + clean); return; }

  const stat = fs.statSync(file);
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

  // Range support — a scrubbed video is unusable without it.
  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = parseInt(s, 10) || 0;
    const end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root}\n  http://localhost:${port}/`));
