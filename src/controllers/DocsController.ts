/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import {
  Controller,
  Get,
  Header,
  Inject,
  InternalServerErrorException,
  Optional,
  Req,
  SetMetadata,
  Type,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { renderDocsPage } from '../utils/DocsPageRenderer';
import { buildScenarioDocument } from '../runner/ScenarioDocument';
import { SpecScribeLogger } from '../utils/SpecScribeLogger';
import { getRuntimeGlobalPrefix, liveSpec, requestOrigin } from '../utils/LiveSpec';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Normalises a user-supplied docs path into a Nest route segment.
 * `'/api/docs'`, `'api/docs/'` and `'api/docs'` all become `'api/docs'`.
 */
export function normalizeDocsPath(path: string | undefined): string {
  const normalized = (path || '').replace(/^\/+|\/+$/g, '').trim();
  return normalized || 'docs';
}

/**
 * Builds the docs controller for a specific configuration.
 *
 * The routes must be created at runtime because the `path` option is only known
 * once `forRoot()` has run. A statically decorated class would hard-code
 * `/docs` and silently ignore the option.
 */
export function createDocsController(config: { path?: string } = {}): Type<any> {
  const docsPath = normalizeDocsPath(config.path);

  @Controller()
  @Public()
  class DocsController {
    constructor(
      @Inject('SPECSCRIBE_OPENAPI') private openApiSpec: any,
      @Inject('SPECSCRIBE_OPTIONS') private options: any,
      @Optional() @Inject('SPECSCRIBE_WS') private wsDocument: any,
      @Optional() @Inject('SPECSCRIBE_ASYNCAPI') private asyncApiDocument: any,
      @Optional() @Inject('SPECSCRIBE_GRAPHQL') private graphqlDocument: any,
    ) {}

    @Get(docsPath)
    @Header('Content-Type', 'text/html; charset=utf-8')
    // Browsers heuristically cache pages without cache headers; after a
    // library upgrade that served users a stale console UI.
    @Header('Cache-Control', 'no-store')
    // Same hardening as the standalone server: the docs page holds tokens and
    // sends requests, so it must not be framed (clickjacking) or MIME-sniffed.
    @Header('X-Content-Type-Options', 'nosniff')
    @Header('X-Frame-Options', 'DENY')
    getDocs(@Req() req: Request): string {
      this.assertAuth(req);
      // Use a relative URL so the browser resolves it against the current path.
      // This keeps the docs UI working both with and without app.setGlobalPrefix().
      const docsSegment = docsPath.split('/').pop() || 'docs';
      return renderDocsPage({
        specUrl: `./${docsSegment}-json`,
        title: this.options?.apiTitle ? `${this.options.apiTitle} — API Documentation` : undefined,
        primaryColor: this.options?.primaryColor,
        theme: this.options?.theme,
        language: this.options?.language,
        faviconUrl: this.options?.customDomainIcon || undefined,
        scalarUrl: this.options?.scalarUrl,
      });
    }

    @Get(`${docsPath}-json`)
    @Header('Content-Type', 'application/json; charset=utf-8')
    @Header('Access-Control-Allow-Origin', '*')
    getOpenApiJson(@Req() req: Request): string {
      this.assertAuth(req);
      return this.serializeSpec(req);
    }

    @Get(`${docsPath}/json`)
    @Header('Content-Type', 'application/json; charset=utf-8')
    @Header('Access-Control-Allow-Origin', '*')
    getOpenApiJsonLegacy(@Req() req: Request): string {
      this.assertAuth(req);
      return this.serializeSpec(req);
    }

    @Get(`${docsPath}/spec`)
    getOpenApiSpec(@Req() req: Request) {
      this.assertAuth(req);
      return this.specFor(req);
    }

    /**
     * The scanned document adapted to the running app: the real global prefix
     * (`app.setGlobalPrefix()`), the address the docs were opened on (unless
     * `baseUrl` was configured), and the matching mock path. Cached per
     * origin, so serving it costs nothing after the first request.
     */
    private specFor(req: Request): any {
      const origin = this.options?.baseUrlExplicit ? undefined : requestOrigin(req as any);
      const key = `${origin ?? ''}|${getRuntimeGlobalPrefix()}`;
      let cached = this.liveCache.get(key);
      if (!cached) {
        cached = liveSpec(this.openApiSpec, {
          optionPrefix: this.options?.globalPrefix,
          runtimePrefix: getRuntimeGlobalPrefix(),
          explicitBaseUrl: !!this.options?.baseUrlExplicit,
          origin,
          mockEnabled: !!this.options?.enableMock,
        });
        if (this.liveCache.size > 20) this.liveCache.clear();
        this.liveCache.set(key, cached);
      }
      return cached;
    }

    private liveCache = new Map<string, any>();

    /**
     * WebSocket gateway documentation. `gateways` is empty when the project
     * has none, so the docs UI knows to hide the section.
     */
    @Get(`${docsPath}-ws-json`)
    @Header('Content-Type', 'application/json; charset=utf-8')
    @Header('Access-Control-Allow-Origin', '*')
    getWsJson(@Req() req: Request): string {
      this.assertAuth(req);
      return JSON.stringify(this.wsDocument || { gateways: [] }, null, 2);
    }

    /**
     * AsyncAPI document generated from WebSocket gateway analysis.
     */
    @Get(`${docsPath}-async-json`)
    @Header('Content-Type', 'application/json; charset=utf-8')
    @Header('Access-Control-Allow-Origin', '*')
    getAsyncApiJson(@Req() req: Request): string {
      this.assertAuth(req);
      return JSON.stringify(this.asyncApiDocument || { asyncapi: '2.6.0', info: { title: '', version: '' }, channels: {} }, null, 2);
    }

    /**
     * GraphQL resolver documentation. `resolvers` is empty when the project
     * has none, so the docs UI knows to hide the section.
     */
    @Get(`${docsPath}-graphql-json`)
    @Header('Content-Type', 'application/json; charset=utf-8')
    @Header('Access-Control-Allow-Origin', '*')
    getGraphQLJson(@Req() req: Request): string {
      this.assertAuth(req);
      return JSON.stringify(this.graphqlDocument || { resolvers: [] }, null, 2);
    }

    /**
     * Runnable scenarios for the docs UI — one generated flow per tag, in the
     * `specscribe test` file format. Built once, on first request.
     */
    @Get(`${docsPath}-scenarios-json`)
    @Header('Content-Type', 'application/json; charset=utf-8')
    @Header('Access-Control-Allow-Origin', '*')
    getScenariosJson(@Req() req: Request): string {
      this.assertAuth(req);
      // Built from the live document so step paths carry the real prefix.
      const spec = this.specFor(req);
      if (this.scenarioSource !== spec) {
        this.scenarioSource = spec;
        this.scenarioJson = JSON.stringify(buildScenarioDocument(spec), null, 2);
      }
      return this.scenarioJson!;
    }

    private scenarioJson?: string;
    private scenarioSource?: unknown;

    /**
     * Enforces a bearer token on every docs endpoint when `requireAuthToken` is set.
     * Keeps staging/previews private without affecting the application itself.
     */
    private assertAuth(req: Request): void {
      const expected = this.options?.requireAuthToken;
      if (!expected) return;
      const header = (req.headers.authorization || '').toString();
      const token = header.replace(/^Bearer\s+/i, '').trim();
      if (token !== expected) {
        throw new UnauthorizedException('Invalid or missing authorization token');
      }
    }

    /**
     * Returns the document pretty-printed.
     *
     * A string is returned rather than the object so the JSON stays readable when
     * opened directly in a browser. Both adapters send strings verbatim.
     */
    private serializeSpec(req: Request): string {
      try {
        return JSON.stringify(this.specFor(req), null, 2);
      } catch (error) {
        SpecScribeLogger.error('Error serializing OpenAPI spec:', error);
        throw new InternalServerErrorException('Failed to generate OpenAPI specification');
      }
    }
  }

  return DocsController;
}

/**
 * Default docs controller bound to `/docs`.
 *
 * @deprecated Use {@link createDocsController} so the `path` option is honoured.
 */
export const DocsController = createDocsController();

