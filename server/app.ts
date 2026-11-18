import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { MAX_MESSAGE_BYTES } from '../shared/protocol';
import type { ServerOptions } from './config';
import { Hub } from './hub';

function findClientDir(explicit?: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [explicit, join(here, 'client'), join(here, '..', 'dist', 'client'), join(process.cwd(), 'dist', 'client')];
  for (const c of candidates) if (c && existsSync(join(c, 'index.html'))) return c;
  return null;
}

export interface GameServer {
  http: Server;
  hub: Hub;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createGameServer(opts: ServerOptions = {}): GameServer {
  const hub = new Hub(opts);
  const app = express();
  app.disable('x-powered-by');
  const started = Date.now();

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, uptimeSec: Math.round((Date.now() - started) / 1000), ...hub.stats() });
  });

  const clientDir = findClientDir(opts.clientDir);
  if (clientDir) {
    app.use(express.static(clientDir, { maxAge: '1h', setHeaders: (res, p) => p.endsWith('index.html') && res.setHeader('Cache-Control', 'no-cache') }));
    // SPA fallback so /r/CODE deep links work.
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/ws' || /\.[a-z0-9]+$/i.test(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(clientDir, 'index.html'));
    });
  }
  app.use((_req, res) => {
    res.status(404).type('text/plain').send(clientDir ? 'Not found' : 'Client not built. Run `npm run build`.');
  });

  const http = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  wss.on('connection', (ws, req) => hub.handleConnection(ws, req));

  http.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/ws') {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (opts.publicOrigin && origin && origin !== opts.publicOrigin) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return {
    http,
    hub,
    listen(port = opts.port ?? 0, host = opts.host) {
      return new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, host, () => resolve((http.address() as AddressInfo).port));
      });
    },
    close() {
      hub.close();
      for (const c of wss.clients) c.terminate();
      return new Promise((resolve) => {
        http.closeAllConnections?.();
        http.close(() => resolve());
      });
    },
  };
}
