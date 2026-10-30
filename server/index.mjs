import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname } from 'node:path';
import { PokerService } from './poker-service.mjs';
import { askGroqTalk, askGroqChat, claimTalk } from './groq-bot.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
export function makeServer({ service = new PokerService(), allowedOrigins = [] } = {}) {
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      const origin = req.headers.origin;
      const sameOrigin = origin && (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })();
      if (origin && !sameOrigin && !allowedOrigins.includes(origin)) { res.writeHead(403); res.end(JSON.stringify({ error: 'Origin is not allowed.' })); return; }
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.writeHead(204); res.end(); return;
      }
      try {
        const path = url.pathname.slice(4);
        const read = ['/health', '/poll', '/lobby'].includes(path);
        if (req.method !== (read ? 'GET' : 'POST')) throw Object.assign(Error('Method not allowed.'), { status: 405 });
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 4096) throw Object.assign(Error('Request too large.'), { status: 413 });
        }
        let body;
        try { body = raw ? JSON.parse(raw) : {}; } catch { throw Error('Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid request.');
        if (path === '/table-talk') {
          if (!process.env.GROQ_API_KEY) throw Object.assign(Error('Live AI is not configured on this server.'), { status: 503 });
          if (!claimTalk(req.socket.remoteAddress || 'local')) throw Object.assign(Error('Live AI is busy. The table will use the neural bots for now.'), { status: 429 });
          const move = body.chat ? await askGroqChat(body.chat, body.name, process.env.GROQ_API_KEY) : await askGroqTalk(body.observation, body.name, process.env.GROQ_API_KEY);
          if (!move) throw Object.assign(Error('Live AI did not answer in time.'), { status: 504 });
          res.end(JSON.stringify(move)); return;
        }
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        res.end(JSON.stringify(service.handle(path, token, body)));
      } catch (error) { res.writeHead(error.status || 400); res.end(JSON.stringify({ error: error.message })); }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    try {
      const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(root) || url.pathname.split('/').some(part => part.startsWith('.')) || !['.html', '.js', '.css', '.svg'].includes(extname(path))) throw Error('Invalid path');
      const data = await readFile(path);
      res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  const timer = setInterval(() => service.sweep(), 1000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  makeServer({ allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean) })
    .listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Poker server: http://localhost:${port}`));
}
