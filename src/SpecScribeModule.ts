/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { DynamicModule, MiddlewareConsumer, Module, OnModuleInit, RequestMethod, Inject, Optional } from '@nestjs/common';
import { ApplicationConfig, HttpAdapterHost } from '@nestjs/core';
import { getRuntimeGlobalPrefix, normalizePrefix, setRuntimeGlobalPrefix } from './utils/LiveSpec';
import { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } from './specscribe.module-definition';
import { PostmanCollectionGenerator } from './generators/PostmanCollectionGenerator';
import { MOCK_GLOBAL_PREFIX, MockMiddleware } from './middleware/MockMiddleware';
import { DriftMiddleware } from './drift/DriftMiddleware';
import { ScannerService } from './scanner/ScannerService';
import { IncrementalScannerService } from './scanner/IncrementalScannerService';
import { MockGenerator } from './utils/MockGenerator';
import { OpenApiTransformer } from './utils/OpenApiTransformer';
import { createDocsController, normalizeDocsPath } from './controllers/DocsController';
import { buildWsDocument, GatewayScanner } from './websocket/GatewayScanner';
import { buildGraphQLDocument, ResolverScanner } from './graphql/ResolverScanner';
import { buildAsyncApiDocument } from './utils/AsyncApiTransformer';
import { AutoDetector } from './utils/AutoDetector';
import { buildRouteSegments, toExpressRoute } from './utils/RoutePath';
import { LogLevel, SpecScribeLogger } from './utils/SpecScribeLogger';
import * as fs from 'fs';
import { typeScriptSupport } from './analysis/TypeScriptSupport';

export const MOCK_ROUTE_PREFIX = 'specscribe-mock';

/**
 * Check whether the current process appears to be running in a production
 * environment. We look at the standard NODE_ENV variable and also at common
 * PaaS flags (Render, Railway, Heroku, AWS Lambda, etc.) so the defaults feel
 * right regardless of how the app is deployed.
 */
function isProductionEnvironment(): boolean {
  const env = process.env.NODE_ENV || '';
  if (env === 'production') return true;
  const paasFlags = ['RENDER', 'RAILWAY', 'HEROKU', 'AWS_LAMBDA_FUNCTION_NAME', 'FLY_APP_NAME'];
  return paasFlags.some(flag => (process.env[flag] ?? '').length > 0);
}

export interface SpecScribeOptions {
  path?: string;
  /**
   * Enable the interactive docs UI and OpenAPI JSON endpoint.
   *
   * @default true in development, false in production (`NODE_ENV === 'production'`)
   *
   * In production the docs controller is **disabled by default** so that installing
   * the module does not accidentally expose your API surface to the public internet.
   * Set explicitly to `true` if you intentionally want docs reachable in production
   * (for example behind your own auth guard or on an internal network).
   */
  enableDocs?: boolean;
  /**
   * Enable the spec-driven mock server at `/specscribe-mock/*`.
   *
   * @default true in development, false in production (`NODE_ENV === 'production'`)
   *
   * The mock server is intended for local development and contract-first testing.
   * It should not be left enabled in production unless you explicitly want to serve
   * fabricated responses from the same process as your real API.
   */
  enableMock?: boolean;
  autoExportPostman?: boolean;
  postmanOutputPath?: string;
  baseUrl?: string;
  sourcePath?: string;
  apiTitle?: string;
  apiVersion?: string;
  /**
   * OpenAPI spec version emitted by the docs endpoint and `generate`.
   * @default '3.0.0'
   */
  openApiVersion?: '3.0.0' | '3.1.0';
  customDomainIcon?: string;
  primaryColor?: string;
  theme?: 'classic' | 'futuristic';
  useIncrementalScanning?: boolean;
  cacheFilePath?: string;
  /** @default 'sha256' */
  hashAlgorithm?: 'sha256';
  cacheTtl?: number;
  skipDependencyTracking?: boolean;
  /**
   * Opt-in: full URL of a Scalar standalone bundle. When set, the docs page
   * hosts the Scalar UI from that URL instead of the built-in zero-dependency
   * UI. Leave unset for a fully self-contained docs page.
   */
  scalarUrl?: string;
  /**
   * Opt-in drift detection: samples real JSON responses in development and
   * warns when they do not match the generated documentation (missing fields,
   * unexpected fields, type mismatches, undocumented routes/statuses).
   * Buffers response bodies (bounded), so keep it off in production.
   * @default false
   */
  enableDriftDetection?: boolean;
  /**
   * Controls library output. Use `'silent'` to suppress it entirely.
   * @default 'info'
   */
  logLevel?: LogLevel;
  /**
   * Mirrors the value passed to `app.setGlobalPrefix()`.
   *
   * Static analysis cannot see the `bootstrap()` call, so without this every
   * generated path is missing the prefix and does not match the running API.
   */
  globalPrefix?: string;
  /**
   * UI language for the built-in docs page.
   * @default 'en'
   */
  language?: 'en' | 'ar';
  /**
   * When set, the docs UI and JSON endpoints require an `Authorization: Bearer <token>`
   * header with this value. Useful for staging/previews.
   */
  requireAuthToken?: string;
  /**
   * When `true`, the standalone docs server records proxied/mock requests to an
   * analytics endpoint.
   * @default false
   */
  enableAnalytics?: boolean;
}

@Module({})
export class SpecScribeModule extends ConfigurableModuleClass implements OnModuleInit {
  private static moduleOptions: SpecScribeOptions = {};
  private static docsPath = 'docs';
  private static controllerCount = 0;

  constructor(
    @Inject(MODULE_OPTIONS_TOKEN)
    private readonly options: SpecScribeOptions,
    @Optional()
    @Inject('SPECSCRIBE_CONTROLLERS')
    private readonly controllers: any[] = [],
    // Nest's own config holds what `app.setGlobalPrefix()` set in main.ts.
    @Optional() private readonly appConfig?: ApplicationConfig,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {
    super();
    SpecScribeModule.moduleOptions = options;
  }

  /** Prefix the running app uses, unless `globalPrefix` was given explicitly. */
  private detectRuntimePrefix(): string {
    if (SpecScribeModule.moduleOptions.globalPrefix) return '';
    try {
      return normalizePrefix(this.appConfig?.getGlobalPrefix?.());
    } catch {
      return '';
    }
  }

  onModuleInit() {
    // Without a configured baseUrl the real port is only known once the app
    // listens; print the banner then, so the links in it actually work.
    const options = SpecScribeModule.moduleOptions as SpecScribeOptions & { baseUrlExplicit?: boolean };
    let server: any;
    try {
      server = options.baseUrlExplicit === false ? this.adapterHost?.httpAdapter?.getHttpServer?.() : undefined;
    } catch {
      server = undefined;
    }
    if (server && typeof server.once === 'function' && !server.listening) {
      server.once('listening', () => {
        const address = server.address?.();
        const port = address && typeof address === 'object' ? address.port : undefined;
        this.displayDashboard(port ? `http://localhost:${port}` : undefined);
      });
      return;
    }
    this.displayDashboard();
  }

  private displayDashboard(liveBaseUrl?: string) {
    if (!SpecScribeLogger.isEnabled('info')) return;

    const options = SpecScribeModule.moduleOptions;
    const baseUrl = liveBaseUrl || options.baseUrl;
    const docsPath = SpecScribeModule.docsPath;
    const activePrefix = normalizePrefix(options.globalPrefix) || getRuntimeGlobalPrefix();
    const prefix = activePrefix ? `/${activePrefix}` : '';

    const cyan = '\x1b[36m';
    const purple = '\x1b[35m';
    const green = '\x1b[32m';
    const yellow = '\x1b[33m';
    const bold = '\x1b[1m';
    const reset = '\x1b[0m';
    const dim = '\x1b[2m';
    const gradient = `${cyan}${bold}`;

    const lines: string[] = [];
    const rule = '─'.repeat(59);

    lines.push('');
    lines.push(`${gradient}┌${rule}┐${reset}`);
    lines.push(`${gradient}│${reset} ${cyan}${bold}✨ SpecScribe${reset} ${dim}by Mohamed Mustafa${reset}`);
    lines.push(`${gradient}│${reset}`);
    if (options.enableDocs !== false) {
      lines.push(`${gradient}│${reset} ${green}●${reset} ${bold}Documentation${reset}  ${cyan}${baseUrl}${prefix}/${docsPath}${reset}`);
      lines.push(`${gradient}│${reset} ${green}●${reset} ${bold}OpenAPI Spec${reset}   ${cyan}${baseUrl}${prefix}/${docsPath}-json${reset}`);
    } else {
      lines.push(`${gradient}│${reset} ${yellow}○${reset} ${bold}Documentation${reset}  ${dim}disabled in production (enableDocs: true to opt in)${reset}`);
    }
    if (options.enableMock !== false) {
      lines.push(
        `${gradient}│${reset} ${green}●${reset} ${bold}Mock Server${reset}    ${cyan}${baseUrl}${prefix}/${MOCK_ROUTE_PREFIX}${reset}`,
      );
    } else {
      lines.push(`${gradient}│${reset} ${yellow}○${reset} ${bold}Mock Server${reset}    ${dim}disabled in production (enableMock: true to opt in)${reset}`);
    }
    lines.push(`${gradient}│${reset}`);
    lines.push(`${gradient}│${reset} ${yellow}📦${reset} Source      ${dim}${options.sourcePath}${reset}`);
    lines.push(
      `${gradient}│${reset} ${yellow}🎯${reset} Controllers ${green}${bold}${SpecScribeModule.controllerCount}${reset}`,
    );
    lines.push(
      `${gradient}│${reset} ${yellow}🎨${reset} Theme       ${options.theme === 'classic' ? `${dim}Classic${reset}` : `${purple}${bold}Futuristic${reset}`}`,
    );
    lines.push(`${gradient}└${rule}┘${reset}`);
    lines.push('');

    SpecScribeLogger.raw(lines);
  }


  static forRoot(options: SpecScribeOptions = {}): DynamicModule {
    // Auto-detect project structure from the provided sourcePath when possible.
    const projectStructure = AutoDetector.detectProjectStructure(options.sourcePath);

    // Secure-by-default: in production we disable docs and mock unless the
    // caller explicitly opts in. This prevents an npm install from silently
    // exposing the API surface (and an unauthenticated mock endpoint) to the
    // public internet when the host app is deployed.
    const isProduction = isProductionEnvironment();
    const enableDocsDefault = options.enableDocs !== undefined ? options.enableDocs : !isProduction;
    const enableMockDefault = options.enableMock !== undefined ? options.enableMock : !isProduction;

    if (isProduction && options.enableDocs === undefined) {
      SpecScribeLogger.info(
        'Running in production mode. Docs UI is disabled by default; pass enableDocs: true to opt in.',
      );
    }
    if (isProduction && options.enableMock === undefined) {
      SpecScribeLogger.info(
        'Running in production mode. Mock server is disabled by default; pass enableMock: true to opt in.',
      );
    }
    
    const config = {
      path: options.path || '/docs',
      enableDocs: enableDocsDefault,
      enableMock: enableMockDefault,
      autoExportPostman: options.autoExportPostman || false,
      postmanOutputPath: options.postmanOutputPath || 'collection.json',
      baseUrl: options.baseUrl || AutoDetector.detectBaseUrl(),
      // When unset, the docs use the address they are opened on instead.
      baseUrlExplicit: !!options.baseUrl,
      sourcePath: options.sourcePath || projectStructure.sourcePath,
      apiTitle: options.apiTitle || projectStructure.packageJson.name || 'NestJS API',
      apiVersion: options.apiVersion || projectStructure.packageJson.version || '1.0.0',
      openApiVersion: options.openApiVersion || '3.0.0',
      customDomainIcon: options.customDomainIcon || '',
      primaryColor: options.primaryColor || '#00f2ff',
      theme: options.theme || 'futuristic',
      useIncrementalScanning: options.useIncrementalScanning || false,
      cacheFilePath: options.cacheFilePath || 'specscribe-cache.json',
      hashAlgorithm: options.hashAlgorithm || 'sha256',
      cacheTtl: options.cacheTtl || 24 * 60 * 60 * 1000,
      skipDependencyTracking: options.skipDependencyTracking || false,
      scalarUrl: options.scalarUrl,
      enableDriftDetection: options.enableDriftDetection || false,
      logLevel: options.logLevel || 'info',
      globalPrefix: options.globalPrefix || '',
      language: options.language || 'en',
      requireAuthToken: options.requireAuthToken,
      enableAnalytics: options.enableAnalytics || false,
    };

    SpecScribeLogger.configure(config.logLevel);

    SpecScribeModule.moduleOptions = config;
    SpecScribeModule.docsPath = normalizeDocsPath(config.path);

    SpecScribeLogger.debug(`Project root: ${projectStructure.rootPath}`);
    SpecScribeLogger.debug(`Source path: ${config.sourcePath}`);
    SpecScribeLogger.debug(`tsconfig: ${projectStructure.tsConfigPath}`);

    let scanner: ScannerService | IncrementalScannerService;
    let controllers: any[];

    if (config.useIncrementalScanning) {
      SpecScribeLogger.debug('Using incremental scanner with caching');
      scanner = new IncrementalScannerService({
        useCache: true,
        cacheFilePath: config.cacheFilePath,
        hashAlgorithm: config.hashAlgorithm,
        cacheTtl: config.cacheTtl,
        skipDependencyTracking: config.skipDependencyTracking,
      });
      
      (scanner as IncrementalScannerService).initialize(config.sourcePath);
      controllers = (scanner as IncrementalScannerService).scanControllers(config.sourcePath);
      
      const cacheStats = (scanner as IncrementalScannerService).getCacheManager().getStats();
      SpecScribeLogger.debug(
        `Cache: ${cacheStats.controllerCount} controllers, ${cacheStats.hashAlgorithm} algorithm`,
      );
    } else {
      scanner = new ScannerService();
      controllers = scanner.scanControllers(config.sourcePath);
    }

    SpecScribeModule.controllerCount = controllers.length;

    if (controllers.length === 0) {
      SpecScribeLogger.warn(
        `No controllers found in "${config.sourcePath}". ` +
          'Check the `sourcePath` option points at the directory containing your @Controller() classes.',
      );
    }

    // WebSocket gateways are documented alongside the HTTP routes. A project
    // without gateways gets an empty document, and the UI hides the section.
    let wsDocument: any = null;
    try {
      const gateways = new GatewayScanner().scanGateways(config.sourcePath);
      if (gateways.length > 0) {
        wsDocument = buildWsDocument(gateways, {
          title: config.apiTitle,
          version: config.apiVersion,
        });
        SpecScribeLogger.debug(`Found ${gateways.length} WebSocket gateway(s)`);
      }
    } catch (error) {
      SpecScribeLogger.warn(`Gateway scan failed: ${error instanceof Error ? error.message : error}`);
    }

    // AsyncAPI spec from WebSocket gateways — empty document means no section.
    let asyncApiDocument: any = null;
    try {
      const gateways = new GatewayScanner().scanGateways(config.sourcePath);
      if (gateways.length > 0) {
        asyncApiDocument = buildAsyncApiDocument(gateways, {
          title: config.apiTitle,
          version: config.apiVersion,
        });
        SpecScribeLogger.debug(`Found ${gateways.length} WebSocket gateway(s) for AsyncAPI`);
      }
    } catch (error) {
      SpecScribeLogger.warn(`AsyncAPI build failed: ${error instanceof Error ? error.message : error}`);
    }

    // GraphQL resolvers get the same treatment; empty document = hidden section.
    let graphqlDocument: any = null;
    try {
      const resolvers = new ResolverScanner().scanResolvers(config.sourcePath);
      if (resolvers.length > 0) {
        graphqlDocument = buildGraphQLDocument(resolvers, {
          title: config.apiTitle,
          version: config.apiVersion,
        });
        SpecScribeLogger.debug(`Found ${resolvers.length} GraphQL resolver(s)`);
      }
    } catch (error) {
      SpecScribeLogger.warn(`Resolver scan failed: ${error instanceof Error ? error.message : error}`);
    }

    const transformer = new OpenApiTransformer(config.baseUrl, config.globalPrefix, config.openApiVersion);
    const openApiSpec = transformer.transform(
      controllers,
      config.apiTitle,
      config.apiVersion,
      config.baseUrl
    );
    SpecScribeLogger.debug('OpenAPI specification generated');

    // Without a usable compiler API nothing was scanned: say why on the docs
    // page itself, not only in the server log.
    const tsSupport = typeScriptSupport();
    const projectDescription = typeof projectStructure.packageJson.description === 'string' ? projectStructure.packageJson.description.trim() : '';
    if (!tsSupport.ok) openApiSpec.info.description = tsSupport.message!;
    else if (projectDescription) openApiSpec.info.description = projectDescription;

    // Tells the docs UI where the mock server answers (same origin as the
    // docs page), so it can offer a Live/Mock switch and a fallback.
    if (config.enableMock) {
      const prefix = config.globalPrefix.replace(/^\/+|\/+$/g, '');
      openApiSpec['x-specscribe-mock'] = `${prefix ? `/${prefix}` : ''}/${MOCK_ROUTE_PREFIX}`;
    }

    if (config.autoExportPostman) {
      const generator = new PostmanCollectionGenerator(config.baseUrl, config.globalPrefix);
      const collection = generator.generateCollection(controllers);
      fs.writeFileSync(config.postmanOutputPath, JSON.stringify(collection, null, 2));
      SpecScribeLogger.info(`Postman collection exported to ${config.postmanOutputPath}`);
    }

    // Get the base module from ConfigurableModuleBuilder
    const baseModule = super.forRoot(config);

    // Merge with our custom providers and controllers
    return {
      ...baseModule,
      providers: [
        ...(baseModule.providers || []),
        ScannerService,
        IncrementalScannerService,
        PostmanCollectionGenerator,
        OpenApiTransformer,
        MockGenerator,
        {
          provide: 'SPECSCRIBE_CONTROLLERS',
          useValue: controllers,
        },
        {
          // The mock must answer on the same paths the document advertises.
          provide: MOCK_GLOBAL_PREFIX,
          useValue: config.globalPrefix,
        },
        {
          provide: 'SPECSCRIBE_OPENAPI',
          useValue: openApiSpec,
        },
        {
          provide: 'SPECSCRIBE_WS',
          useValue: wsDocument,
        },
        {
          provide: 'SPECSCRIBE_ASYNCAPI',
          useValue: asyncApiDocument,
        },
        {
          provide: 'SPECSCRIBE_GRAPHQL',
          useValue: graphqlDocument,
        },
        {
          provide: 'SPECSCRIBE_OPTIONS',
          useValue: config,
        },
      ],
      exports: [
        ...(baseModule.exports || []),
        ScannerService,
        IncrementalScannerService,
        PostmanCollectionGenerator,
        OpenApiTransformer,
      ],
      // Only register the docs controller when the user has not disabled it.
      // In production the docs UI is disabled by default unless explicitly
      // opted in via enableDocs: true.
      controllers: config.enableDocs !== false ? [createDocsController({ path: config.path })] : [],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    const options = SpecScribeModule.moduleOptions;
    // Middleware is configured during app.init(), i.e. after main.ts called
    // setGlobalPrefix(): the first point where the real prefix is known.
    setRuntimeGlobalPrefix(this.detectRuntimePrefix());

    if (options.enableDriftDetection) {
      const driftRoutes = this.buildExactApiRoutes(this.controllers, options.globalPrefix);
      if (driftRoutes.length > 0) {
        consumer.apply(DriftMiddleware).forRoutes(...driftRoutes);
      }
    }

    if (options.enableMock === false) {
      return;
    }

    // Register one exact mock route per documented path instead of a wildcard.
    // This removes any dependency on reading the host's `@nestjs/core` version
    // to decide between Express 4 (`*`) and Express 5 (`*splat`) wildcard syntax.
    const mockRoutes = this.buildExactMockRoutes(this.controllers, options.globalPrefix || getRuntimeGlobalPrefix());
    if (mockRoutes.length > 0) {
      consumer.apply(MockMiddleware).forRoutes(...mockRoutes);
    }
  }

  /**
   * Builds exact middleware route paths for every documented API path.
   *
   * Using exact routes avoids wildcard syntax differences between Express 4 and
   * Express 5 and keeps the mock reachable at exactly the paths advertised in
   * the generated OpenAPI spec.
   */
  private buildExactApiRoutes(controllers: any[], globalPrefix?: string): { path: string; method: RequestMethod }[] {
    const routes = new Set<string>();
    const prefix = (globalPrefix || '').replace(/^\/+|\/+$/g, '');

    for (const controller of controllers || []) {
      for (const method of controller.methods || []) {
        const segments = buildRouteSegments({
          globalPrefix: prefix,
          version: method.version || controller.version,
          controllerPath: controller.path,
          methodRoute: method.route,
        });
        if (segments.some(segment => segment.includes('*'))) {
          // Catch-all controller routes cannot be expressed safely across all
          // supported Express/path-to-regexp versions; skip them.
          continue;
        }
        const route = toExpressRoute(segments);
        if (route) {
          routes.add(route);
        }
      }
    }

    return Array.from(routes).map(path => ({ path, method: RequestMethod.ALL }));
  }

  /**
   * Builds exact mock routes under `/specscribe-mock`. When a global prefix is set
   * the mock is mounted under both the prefixed and root paths so existing URLs
   * keep working.
   */
  private buildExactMockRoutes(controllers: any[], globalPrefix?: string): { path: string; method: RequestMethod }[] {
    const apiRoutes = this.buildExactApiRoutes(controllers, globalPrefix).map(r => r.path);
    const normalizedPrefix = (globalPrefix || '').replace(/^\/+|\/+$/g, '');
    const prefixes = normalizedPrefix
      ? [`${normalizedPrefix}/${MOCK_ROUTE_PREFIX}`, MOCK_ROUTE_PREFIX]
      : [MOCK_ROUTE_PREFIX];

    const routes = new Set<string>();
    for (const prefix of prefixes) {
      for (const apiRoute of apiRoutes) {
        routes.add(apiRoute ? `${prefix}/${apiRoute}` : prefix);
      }
    }

    return Array.from(routes).map(path => ({ path, method: RequestMethod.ALL }));
  }
}