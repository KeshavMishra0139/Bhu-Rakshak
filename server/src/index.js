// Bhu-Rakshak API server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// node:sqlite prints an ExperimentalWarning on every start; it is stable enough for this prototype.
const origEmit = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : origEmit.call(process, w, ...rest));

const { env, REPO_ROOT } = await import('./config/env.js');
const { default: express } = await import('express');
const { default: cookieParser } = await import('cookie-parser');
const { openDb, closeDb } = await import('./db/index.js');
const { seedIfEmpty } = await import('./db/seed.js');
const { attachUser } = await import('./auth/middleware.js');
const { siteGate } = await import('./auth/siteGate.js');
const { startWeatherSchedule, stopWeatherSchedule } = await import('./ingest/openMeteo.js');
const { startImdSchedule, stopImdSchedule } = await import('./ingest/imd.js');
const { startSeismicSchedule, stopSeismicSchedule } = await import('./ingest/seismic.js');
const { startMlSchedule, stopMlSchedule } = await import('./prediction/mlModel.js');
const { riskService } = await import('./prediction/liveLoop.js');
const { startInbox, stopInbox } = await import('./notifications/inbox.js');
const { wireSse } = await import('./events/sse.js');
const { HttpError } = await import('./lib/util.js');

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());
  app.use(siteGate());
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // dev split view embeds our own citizen site
    const origin = req.headers.origin;
    if (origin && origin === env.clientOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  app.use(attachUser);

  const routes = ['auth', 'locations', 'risk', 'inbox', 'settings', 'health', 'tools', 'incidents', 'alerts', 'reports', 'operations', 'insights', 'admin', 'map', 'ml', 'impact', 'corridor', 'communityReports'];
  for (const name of routes) {
    const { default: router } = await import(`./routes/${name}.js`);
    app.use(name === 'auth' ? '/api/auth' : '/api', router);
  }
  if (env.devModeEnabled) {
    const { default: dev } = await import('./routes/dev.js');
    app.use('/api', dev);
  }

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found')));

  // Production: serve the built client.
  const dist = path.join(REPO_ROOT, 'client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: err.code || (status === 413 ? 'payload_too_large' : 'server_error') });
  });
  return app;
}

async function main() {
  openDb();
  if (seedIfEmpty()) console.log('[db] seeded demo data');
  await startWeatherSchedule();
  await startImdSchedule();
  await startSeismicSchedule();
  startMlSchedule();
  await riskService.init();
  riskService.start();
  startInbox();
  wireSse();

  const app = await createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] Bhu-Rakshak API on http://localhost:${env.port}`);
    console.log(`[server] prediction mode: ${env.predictionMode} · dev mode: ${env.devModeEnabled ? 'ON (disable for public deployments)' : 'off'}`);
  });

  const shutdown = () => {
    console.log('\n[server] shutting down');
    riskService.stop();
    stopInbox();
    stopWeatherSchedule();
    stopImdSchedule();
    stopSeismicSchedule();
    stopMlSchedule();
    server.close(() => { closeDb(); process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
