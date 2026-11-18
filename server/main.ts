import { createGameServer } from './app';

const port = Number(process.env.PORT) || 3000;
// PUBLIC_ORIGIN may be a comma-separated list (e.g. a Vercel-hosted client plus this host's own origin).
const publicOrigin = (process.env.PUBLIC_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const server = createGameServer({ port, publicOrigin, log: (m) => console.log(`[jakk] ${m}`) });
server.listen(port).then((p) => {
  console.log(`[jakk] listening on :${p}${publicOrigin.length ? ` (origins ${publicOrigin.join(', ')})` : ''}  ws path /ws`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[jakk] ${sig}, shutting down`);
    server.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
