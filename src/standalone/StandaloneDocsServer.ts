/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { URL } from 'url';
import { execFile } from 'child_process';

/** `Error` with the `code` Node attaches to system errors (EADDRINUSE, ECONNREFUSED…). */
type SystemError = Error & { code?: string };
import { AppPortDetector } from '../utils/AppPortDetector';
import { SpecMockServer } from './SpecMockServer';
import { renderDocsPage } from '../utils/DocsPageRenderer';
import { SpecScribeLogger } from '../utils/SpecScribeLogger';
import { SpecScribeRecorder } from './SpecScribeRecorder';
import { AnalyticsCollector } from './AnalyticsCollector';
import { buildScenarioDocument } from '../runner/ScenarioDocument';
import { AutoDetector, Framework } from '../utils/AutoDetector';
import { ScannerService } from '../scanner/ScannerService';
import { typeScriptSupport } from '../analysis/TypeScriptSupport';
import { OpenApiTransformer } from '../utils/OpenApiTransformer';
import { ExpressScanner } from '../express/ExpressScanner';
import { ExpressOpenApiTransformer } from '../express/ExpressOpenApiTransformer';
import { ExpressWebSocketScanner } from '../express/ExpressWebSocketScanner';
import { ExpressGraphQLScanner } from '../express/ExpressGraphQLScanner';
import { buildWsDocument, GatewayScanner } from '../websocket/GatewayScanner';
import { buildGraphQLDocument, ResolverScanner } from '../graphql/ResolverScanner';
import { buildAsyncApiDocument } from '../utils/AsyncApiTransformer';
import { FastifyScanner } from '../fastify/FastifyScanner';
import { HonoScanner } from '../hono/HonoScanner';

/** Default proxy allowlist — loopback only. Exported for testing and tooling. */
export function defaultProxyAllowHosts(extraHosts: string[] = []): Set<string> {
  return new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    ...extraHosts,
  ]);
}

export interface StandaloneDocsOptions {
  sourcePath?: string;
  port?: number;
  title?: string;
  version?: string;
  baseUrl?: string;
  /**
   * OpenAPI spec version emitted by the docs endpoint.
   * @default '3.0.0'
   */
  openApiVersion?: '3.0.0' | '3.1.0';
  theme?: 'futuristic' | 'classic';
  primaryColor?: string;
  language?: 'en' | 'ar';
  /**
   * Hosts the proxy is allowed to forward to. Defaults to loopback-only
   * (`localhost`, `127.0.0.1`, `::1`). Use this to extend the allowlist when
   * the backend listens on a LAN address or a known staging host.
   *
   * ⚠️ Never add public hosts and then expose the docs server itself to the
   * internet — the proxy would become an open HTTP relay.
   */
  proxyAllowHosts?: string[];
  /** @default true */
  enableDocs?: boolean;
  /** @default true */
  enableProxy?: boolean;
  /** @default true */
  enableMock?: boolean;
  /**
   * When set, the proxy records every proxied request/response pair as a
   * scenario file under this directory.
   */
  recordDir?: string;
  /**
   * When set, the docs UI and JSON endpoints require an `Authorization: Bearer <token>`
   * header with this value.
   */
  requireAuthToken?: string;
  /**
   * When `true`, the proxy and mock server record request analytics to an
   * in-memory collector exposed at `/__specscribe_analytics`.
   * @default false
   */
  enableAnalytics?: boolean;
  open?: boolean;
}

/**
 * Starts a self-contained documentation server for any supported project.
 *
 * - NestJS projects are scanned with the full TypeScript AST scanner.
 * - Express/Node.js projects are scanned with the heuristic route scanner.
 */
export interface StandaloneDocuments {
  framework: Framework;
  sourcePath: string;
  baseUrl: string;
  globalPrefix: string;
  spec: any;
  wsDocument: any;
  asyncApiDocument: any;
  graphqlDocument: any;
}

export class StandaloneDocsServer {
  private server?: http.Server;

  /**
   * Scans the project (NestJS or Express) into the three documents the UI
   * consumes. Shared by `serve` and `export` so both see the same API.
   */
  static buildDocuments(options: StandaloneDocsOptions = {}): StandaloneDocuments {
    const detector = AutoDetector.detectProjectStructure(options.sourcePath);
    const framework: Framework = detector.framework;
    const sourcePath = options.sourcePath || detector.sourcePath;

    SpecScribeLogger.info(`Detected framework: ${framework || 'unknown'}`);

    // Where the *app* listens — read from .env / app.listen(...) so plain
    // `specscribe serve` already points "Try it" at the right place.
    let baseUrl = options.baseUrl;
    if (!baseUrl) {
      const detected = AppPortDetector.baseUrl(sourcePath, detector.rootPath);
      baseUrl = detected.url;
      const how = detected.detected.source === 'default'
        ? 'default — pass --baseUrl if your app listens elsewhere'
        : `from ${detected.detected.evidence}`;
      SpecScribeLogger.info(`Backend base URL: ${baseUrl} (${how})`);
    }
    const globalPrefix = framework === 'nestjs' ? this.detectGlobalPrefix(sourcePath) : '';
    if (globalPrefix) SpecScribeLogger.info(`Global prefix: /${globalPrefix}`);

    const title = options.title || detector.packageJson.name || (framework === 'nestjs' ? AutoDetector.getAppName(detector.rootPath) : 'Express API');
    const version = options.version || detector.packageJson.version || AutoDetector.getAppVersion(detector.rootPath);

    let spec: any;
    let wsDocument: any = { gateways: [] };
    let asyncApiDocument: any = { asyncapi: '2.6.0', info: { title: '', version: '' }, channels: {} };
    let graphqlDocument: any = { resolvers: [] };

    if (framework === 'nestjs') {
      const controllers = new ScannerService().scanControllers(sourcePath);
      spec = new OpenApiTransformer(baseUrl, globalPrefix, options.openApiVersion).transform(controllers, title, version, baseUrl);
      const tsSupport = typeScriptSupport();
      if (!tsSupport.ok) spec.info.description = tsSupport.message;

      try {
        const gateways = new GatewayScanner().scanGateways(sourcePath);
        if (gateways.length) {
          wsDocument = buildWsDocument(gateways, { title, version });
          asyncApiDocument = buildAsyncApiDocument(gateways, { title, version });
        }
      } catch (error) {
        SpecScribeLogger.warn(`Gateway scan failed: ${error instanceof Error ? error.message : error}`);
      }
      try {
        const resolvers = new ResolverScanner().scanResolvers(sourcePath);
        if (resolvers.length) graphqlDocument = buildGraphQLDocument(resolvers, { title, version });
      } catch (error) {
        SpecScribeLogger.warn(`Resolver scan failed: ${error instanceof Error ? error.message : error}`);
      }
    } else if (framework === 'express') {
      const absoluteSource = path.resolve(sourcePath);
      const controllers = ExpressScanner.scan(absoluteSource);
      spec = new ExpressOpenApiTransformer(options.openApiVersion).transform(controllers, title, version, baseUrl);

      const gateways = ExpressWebSocketScanner.scan(absoluteSource);
      if (gateways.length) wsDocument = ExpressWebSocketScanner.buildDocument(gateways, { title, version });

      const resolvers = ExpressGraphQLScanner.scan(absoluteSource);
      if (resolvers.length) graphqlDocument = { resolvers };
    } else if (framework === 'fastify' || framework === 'hono') {
      const absoluteSource = path.resolve(sourcePath);
      const controllers = framework === 'fastify' ? new FastifyScanner().scan(absoluteSource) : new HonoScanner().scan(absoluteSource);
      spec = new ExpressOpenApiTransformer(options.openApiVersion).transform(controllers, title, version, baseUrl);

      // Realtime (Socket.IO plugins, @fastify/websocket, Hono upgradeWebSocket)
      // and GraphQL (Mercurius, graphql-yoga, @hono/graphql-server) are read
      // from source the same way as for Express.
      const gateways = ExpressWebSocketScanner.scan(absoluteSource);
      if (gateways.length) wsDocument = ExpressWebSocketScanner.buildDocument(gateways, { title, version });
      const resolvers = ExpressGraphQLScanner.scan(absoluteSource);
      if (resolvers.length) graphqlDocument = { resolvers };
    } else {
      throw new Error(
        'Could not detect project framework. Please run this command from a NestJS, Express, Fastify or Hono project root.',
      );
    }

    // The project's own one-line description beats a generic one.
    const projectDescription = typeof detector.packageJson.description === 'string' ? detector.packageJson.description.trim() : '';
    // (Never over the "cannot scan" explanation a NestJS project on TypeScript 7 gets.)
    const tsWarning = framework === 'nestjs' && !typeScriptSupport().ok;
    if (projectDescription && !tsWarning && spec?.info) spec.info.description = projectDescription;

    return { framework, sourcePath, baseUrl, globalPrefix, spec, wsDocument, asyncApiDocument, graphqlDocument };
  }

  async start(options: StandaloneDocsOptions = {}): Promise<void> {
    const { spec, wsDocument, asyncApiDocument, graphqlDocument, baseUrl, globalPrefix } = StandaloneDocsServer.buildDocuments(options);

    // Never inherit PORT here: that is the application's port (see above).
    const requestedPort = options.port || 3001;
    const docsPath = 'docs';

    // The docs live on a different origin than the API, so a backend without
    // CORS would block every "Try it". The UI therefore sends REST/GraphQL
    // calls through this same-origin proxy; WebSockets connect directly.
    const proxyPrefix = '/__specscribe_proxy';
    spec['x-specscribe-proxy'] = proxyPrefix;

    // Security: by default the proxy only forwards to loopback addresses. The
    // standalone docs server is a local development convenience and should not
    // be exposed to a network, but if it is, we must not turn it into an open
    // HTTP relay. See SECURITY.md for guidance.
    const proxyAllowHosts = defaultProxyAllowHosts(options.proxyAllowHosts);

    const html = renderDocsPage({
      specUrl: `./${docsPath}-json`,
      title: options.title ? `${options.title} — API Documentation` : undefined,
      theme: options.theme,
      primaryColor: options.primaryColor,
      language: options.language,
    });

    const enableDocs = options.enableDocs !== false;
    const enableProxy = options.enableProxy !== false;
    const enableMock = options.enableMock !== false;
    const mock = enableMock ? new SpecMockServer(spec) : null;
    const recorder = options.recordDir ? new SpecScribeRecorder(options.recordDir, spec) : null;
    const analytics = options.enableAnalytics ? new AnalyticsCollector() : null;
    const mockPrefix = '/specscribe-mock';
    // The mock is served by this same server, so the UI can switch to it.
    if (enableMock) spec['x-specscribe-mock'] = mockPrefix;

    const requiredToken = options.requireAuthToken;
    const checkAuth = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
      if (!requiredToken) return true;
      const header = req.headers.authorization || '';
      const token = String(header).replace(/^Bearer\s+/i, '').trim();
      if (token === requiredToken) return true;
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ statusCode: 401, message: 'Invalid or missing authorization token' }));
      return false;
    };

    this.server = http.createServer((req, res) => {
      const url = req.url || '/';
      const pathname = url.split('?')[0];
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname === proxyPrefix || pathname.startsWith(`${proxyPrefix}/`)) {
        if (!enableProxy) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ statusCode: 404, message: 'Proxy is disabled.' }));
          return;
        }
        this.proxy(req, res, baseUrl, url.slice(proxyPrefix.length) || '/', proxyAllowHosts, recorder, analytics);
        return;
      }

      if (enableMock && (pathname === mockPrefix || pathname.startsWith(`${mockPrefix}/`))) {
        const result = mock!.handle(req.method || 'GET', pathname.slice(mockPrefix.length) || '/');
        if (!result) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ statusCode: 404, message: `No documented route matches ${req.method} ${pathname.slice(mockPrefix.length) || '/'}` }));
          return;
        }
        const headers: Record<string, string> = { ...result.headers };
        if (result.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
        res.writeHead(result.status, headers);
        res.end(result.body === undefined ? undefined : JSON.stringify(result.body));
        if (analytics) {
          analytics.record({
            method: req.method || 'GET',
            path: pathname.slice(mockPrefix.length) || '/',
            status: result.status,
            at: new Date().toISOString(),
            mock: true,
          });
        }
        return;
      }

      if (url === `/${docsPath}` || url === `/${docsPath}/`) {
        if (!checkAuth(req, res)) return;
        if (!enableDocs) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ statusCode: 404, message: 'Docs UI is disabled.' }));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
        });
        res.end(html);
      } else if (url === `/${docsPath}-json`) {
        if (!checkAuth(req, res)) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(spec, null, 2));
      } else if (url === `/${docsPath}-ws-json`) {
        if (!checkAuth(req, res)) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(wsDocument, null, 2));
      } else if (url === `/${docsPath}-async-json`) {
        if (!checkAuth(req, res)) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(asyncApiDocument, null, 2));
      } else if (url === `/${docsPath}-graphql-json`) {
        if (!checkAuth(req, res)) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(graphqlDocument, null, 2));
      } else if (url === `/${docsPath}-scenarios-json`) {
        if (!checkAuth(req, res)) return;
        // Read per request: recordings made through the proxy show up live.
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(buildScenarioDocument(spec, options.recordDir), null, 2));
      } else if (pathname === '/__specscribe_analytics' && analytics) {
        if (!checkAuth(req, res)) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(analytics.summary(), null, 2));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found. Visit /docs');
      }
    });

    const port = await this.listenWithFallback(requestedPort, options.port === undefined);
    const url = `http://localhost:${port}/${docsPath}`;
    SpecScribeLogger.warn(
      'Standalone docs server is intended for local development only — do not expose it to a network.',
    );
    if (enableDocs) {
      SpecScribeLogger.info(`Standalone docs server running at ${url}`);
    } else {
      SpecScribeLogger.info('Standalone docs server running (docs UI disabled).');
    }
    if (enableMock) {
      const prefix = globalPrefix ? `/${globalPrefix}` : '';
      const examplePath = Object.keys(spec.paths || {})[0] || '/';
      SpecScribeLogger.info(`Mock server: http://localhost:${port}${prefix}${mockPrefix}  (e.g. ${prefix}${mockPrefix}${examplePath})`);
    } else {
      SpecScribeLogger.info('Mock server disabled.');
    }
    if (enableProxy) {
      SpecScribeLogger.info(
        `Proxy allowlist: ${[...proxyAllowHosts].join(', ')}`,
      );
    } else {
      SpecScribeLogger.info('Proxy disabled.');
    }
    if (recorder) {
      SpecScribeLogger.info(`Recording scenarios to: ${path.resolve(options.recordDir!)}`);
    }
    if (options.open && enableDocs) this.openBrowser(url);
  }

  /**
   * Binds the docs server. When the user did not pin a port and the default is
   * busy (another docs server, or the app itself), walk up to the next free one
   * instead of crashing.
   */
  private listenWithFallback(port: number, allowFallback: boolean, attempt = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (err: SystemError) => {
        this.server!.off('error', onError);
        if (err.code === 'EADDRINUSE' && allowFallback && attempt < 20) {
          SpecScribeLogger.warn(`Port ${port} is in use — trying ${port + 1}`);
          resolve(this.listenWithFallback(port + 1, allowFallback, attempt + 1));
        } else {
          reject(err);
        }
      };
      this.server!.once('error', onError);
      this.server!.listen(port, () => {
        this.server!.off('error', onError);
        resolve(port);
      });
    });
  }

  /**
   * Forwards one request to the backend and streams the answer back. Only
   * hop-by-hop headers are dropped; the backend's status, headers and body
   * reach the console untouched.
   */
  private proxy(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    baseUrl: string,
    pathWithQuery: string,
    allowHosts: Set<string>,
    recorder?: SpecScribeRecorder | null,
    analytics?: AnalyticsCollector | null,
  ): void {
    let target: URL;
    let configuredBase: URL;
    try {
      configuredBase = new URL(baseUrl);
      target = new URL(pathWithQuery, configuredBase.href.replace(/\/+$/, '') + '/');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 400, message: 'Invalid proxy target' }));
      return;
    }

    if (
      !['http:', 'https:'].includes(target.protocol) ||
      target.username !== '' ||
      target.password !== '' ||
      target.origin !== configuredBase.origin ||
      !allowHosts.has(target.hostname)
    ) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        statusCode: 403,
        message: `Proxy refused target ${target.hostname}`,
        hint: `Allowed hosts: ${[...allowHosts].join(', ')}. Pass --proxy-allow-hosts to extend the allowlist, but never expose the docs server to the internet.`,
      }));
      return;
    }

    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
    delete headers['origin'];
    delete headers['referer'];
    delete headers['connection'];
    delete headers['accept-encoding']; // keep the body readable as-is

    const capturedReq: { method: string; url: string; headers: Record<string, string>; body: string } = {
      method: req.method || 'GET',
      url: target.href,
      headers: { ...req.headers } as Record<string, string>,
      body: '',
    };
    const reqChunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => reqChunks.push(chunk));

    const client = target.protocol === 'https:' ? https : http;
    const upstream = client.request(
      { protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, path: target.pathname + target.search, method: req.method, headers },
      (response: http.IncomingMessage) => {
        const outgoing: http.OutgoingHttpHeaders = { ...response.headers };
        delete outgoing['connection'];
        delete outgoing['transfer-encoding'];
        delete outgoing['access-control-allow-origin'];
        outgoing['access-control-allow-origin'] = '*';
        outgoing['x-specscribe-proxied'] = target.origin;
        res.writeHead(response.statusCode || 502, outgoing);

        const resChunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => resChunks.push(chunk));
        response.on('end', () => {
          const responseStatus = response.statusCode || 0;
          capturedReq.body = Buffer.concat(reqChunks).toString('utf-8');
          if (recorder) {
            recorder.save(
              capturedReq,
              {
                status: responseStatus,
                headers: Object.fromEntries(
                  Object.entries(response.headers).filter(([key]) =>
                    key.toLowerCase() === 'content-type' || key.toLowerCase() === 'content-length',
                  ),
                ) as Record<string, string>,
                body: Buffer.concat(resChunks).toString('utf-8'),
              },
            );
          }
          if (analytics) {
            analytics.record({
              method: capturedReq.method,
              path: pathWithQuery.split('?')[0],
              status: responseStatus,
              at: new Date().toISOString(),
            });
          }
        });
        response.pipe(res);
      },
    );
    upstream.on('error', (err: SystemError) => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        statusCode: 502,
        message: `Could not reach ${target.origin} — is your app running?`,
        hint: 'Start your application, or pass --baseUrl <url> if it listens somewhere else.',
        error: err.code || err.message,
      }));
    });
    req.pipe(upstream);
  }

  /** `app.setGlobalPrefix('api')` from the Nest bootstrap file, if any. */
  private static detectGlobalPrefix(sourcePath: string): string {
    const candidates = ['main.ts', 'main.js', 'app.ts', 'server.ts', 'index.ts'].map((f) => path.join(path.resolve(sourcePath), f));
    for (const file of candidates) {
      let text: string;
      try {
        text = fs.readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      const m = /setGlobalPrefix\s*\(\s*['"`]([^'"`]+)['"`]/.exec(text);
      if (m) return m[1].replace(/^\/+|\/+$/g, '');
    }
    return '';
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  private openBrowser(url: string): void {
    // Only ever open a locally-served http URL to avoid turning the docs server
    // into a command-injection vector. execFile with an argument list (no shell)
    // prevents any shell metacharacters from being interpreted.
    if (!/^https?:\/\/127\.0\.0\.1:\d+\/\S*$/.test(url)) {
      return;
    }

    const platform = process.platform;
    if (platform === 'win32') {
      const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe');
      execFile(executable, ['url.dll,FileProtocolHandler', url], () => undefined);
    } else if (platform === 'darwin') {
      execFile('/usr/bin/open', [url], () => undefined);
    } else {
      execFile('/usr/bin/xdg-open', [url], () => undefined);
    }
  }
}
