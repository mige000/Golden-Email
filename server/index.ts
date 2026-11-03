import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp, geminiDrafter } from './app';

// Load .env if present; the API key is optional (the client falls back to templates).
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

// The key is only read here and by the Gemini client; it is never logged or sent to the browser.
const aiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
const app = createApp(geminiDrafter(), aiConfigured);

// `npm start` (--serve-app) also serves the built app, so it's a single server. In dev, Vite serves it.
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const serveApp = process.argv.includes('--serve-app');
if (serveApp && !existsSync(join(dist, 'index.html'))) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}
if (serveApp) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () =>
  console.log(
    `${serveApp ? 'App + API' : 'API'} on http://localhost:${port} (AI drafting ${aiConfigured ? 'on' : 'off: using templates'})`,
  ),
);
