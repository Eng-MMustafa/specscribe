/**
 * Boots the fixture API and a SpecScribe docs server for it — the same pair a
 * user gets from `npx specscribe serve` next to their running app.
 * Requires a prior `npm run build` (uses ../../../dist).
 */
const http = require('http');
const path = require('path');
const { app } = require('./src/users');
const { setupRealtime } = require('./src/realtime');
const { StandaloneDocsServer } = require('../../../dist/standalone/StandaloneDocsServer');

const API_PORT = Number(process.env.UI_FIXTURE_API_PORT || 4510);
const DOCS_PORT = Number(process.env.UI_FIXTURE_DOCS_PORT || 4511);

const server = http.createServer(app);
setupRealtime(server);
server.listen(API_PORT, async () => {
  await new StandaloneDocsServer().start({
    sourcePath: path.join(__dirname, 'src'),
    port: DOCS_PORT,
    baseUrl: `http://localhost:${API_PORT}`,
    title: 'UI Fixture',
    version: '1.2.3',
  });
});
