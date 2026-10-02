/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import { ExpressControllerInfo } from './ExpressScanner';
import { bodySchemaName, operationIdFrom, routeSummary } from './ExpressNaming';
import { convertToOpenApi31 } from '../utils/OpenApiTransformer';

export interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers: { url: string }[];
  paths: Record<string, Record<string, any>>;
  components: { schemas: Record<string, any> };
}

/**
 * Converts heuristic Express route information into a minimal, valid OpenAPI
 * 3.0 document that the built-in docs UI can render and interact with.
 */
export class ExpressOpenApiTransformer {
  private openApiVersion: '3.0.0' | '3.1.0';

  constructor(openApiVersion: '3.0.0' | '3.1.0' = '3.0.0') {
    this.openApiVersion = openApiVersion;
  }

  transform(
    controllers: ExpressControllerInfo[],
    title = 'Express API',
    version = '1.0.0',
    baseUrl = 'http://localhost:3000',
  ): OpenApiSpec {
    const paths: Record<string, Record<string, any>> = {};
    const schemas: Record<string, any> = {};
    const operationIds = new Set<string>();
    let hasAuth = false;

    // `PUT /users/{id}` that just does `Object.assign(user, req.body)` has no
    // shape of its own — fall back to the collection's create body, all optional.
    const createBodies = new Map<string, { properties: Record<string, any>; name?: string }>();
    for (const controller of controllers) {
      for (const route of controller.routes) {
        if (route.method === 'post' && route.bodySchema && Object.keys(route.bodySchema.properties).length) {
          createBodies.set('/' + route.path.replace(/^\/+/, ''), { properties: route.bodySchema.properties, name: route.bodySchema.name });
        }
      }
    }

    for (const controller of controllers) {
      const tag = controller.name;

      for (const route of controller.routes) {
        const httpMethod = route.method === 'all' ? 'get' : route.method;
        const openApiPath = '/' + route.path.replace(/^\/+/, '');

        if (!paths[openApiPath]) {
          paths[openApiPath] = {};
        }

        // Scanners without a real name emit "GET /path" placeholders.
        const named = route.summary && !/^[A-Z]+ \//.test(route.summary) ? route.summary : '';
        const restName = routeSummary(httpMethod, openApiPath, route.hasFileUpload);
        // operationId names generated SDK methods, so it stays short: the
        // handler's own name, else the REST-style name — never a long comment.
        const handler = route.handlerName?.split('.').pop();
        const operation: any = {
          tags: route.tags || [tag],
          summary: named || restName,
          description: route.description,
          operationId: this.operationId(handler || restName, tag, operationIds),
          parameters: route.parameters || [],
          responses: route.responses || { '200': { description: 'OK' } },
        };

        let bodySchema = route.bodySchema;
        if (!bodySchema && route.consumes?.[0] === 'application/json' && /^(put|patch)$/.test(httpMethod)) {
          const collection = openApiPath.replace(/\/\{[^}]+\}$/, '');
          const create = createBodies.get(collection);
          if (create) bodySchema = { properties: create.properties, required: [], source: 'typescript', name: create.name ? `Partial<${create.name}>` : undefined };
        }

        if (route.consumes || bodySchema) {
          const contentType = route.consumes?.[0] || 'application/json';
          let schema: any = {};
          if (bodySchema) {
            const inline: any = { type: 'object', properties: bodySchema.properties, required: bodySchema.required };
            if (bodySchema.name) inline.description = `Inferred from ${bodySchema.name}`;
            else if (bodySchema.source) inline.description = `Inferred from ${bodySchema.source.replace('-', ' ')}`;
            // Inferred JSON bodies become named components so they show up in
            // the Schemas browser exactly like NestJS DTOs do.
            const componentName = bodySchema.name && /^[A-Za-z_][\w]*$/.test(bodySchema.name)
              ? bodySchema.name
              : bodySchemaName(httpMethod, openApiPath);
            schema = contentType === 'application/json'
              ? { $ref: `#/components/schemas/${this.registerSchema(schemas, componentName, inline)}` }
              : inline;
          }

          operation.requestBody = {
            content: { [contentType]: { schema } },
          };

          if (route.hasFileUpload && contentType === 'multipart/form-data') {
            // File parts carry the names multer expects; text fields read from
            // req.body travel in the same form.
            const binary = { type: 'string', format: 'binary' };
            const files = route.uploadFields?.length ? route.uploadFields : [{ name: 'file', multiple: false }];
            const properties: Record<string, any> = { ...(bodySchema?.properties || {}) };
            for (const field of files) properties[field.name] = field.multiple ? { type: 'array', items: binary } : binary;
            operation.requestBody.content['multipart/form-data'].schema = {
              type: 'object',
              properties,
              required: [...new Set([...files.map((f) => f.name), ...(bodySchema?.required || [])])],
            };
          }
        }

        if (route.security) {
          operation.security = route.security;
          hasAuth = true;
        }

        paths[openApiPath][httpMethod] = operation;
      }
    }

    const components: any = { schemas };
    if (hasAuth) {
      components.securitySchemes = {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      };
    }

    const spec: OpenApiSpec = {
      openapi: this.openApiVersion,
      info: { title, version, description: 'Auto-generated from Express route files.' },
      servers: [{ url: baseUrl }],
      paths,
      components,
    };

    if (this.openApiVersion === '3.1.0') {
      convertToOpenApi31(spec);
    }

    return spec;
  }

  /** Adds a schema under `name`, suffixing on collision with a different shape. */
  private registerSchema(schemas: Record<string, any>, name: string, schema: any): string {
    const serialized = JSON.stringify(schema);
    let candidate = name;
    let counter = 2;
    while (schemas[candidate] && JSON.stringify(schemas[candidate]) !== serialized) {
      candidate = `${name}${counter++}`;
    }
    schemas[candidate] = schema;
    return candidate;
  }

  /** `Create user` → `createUser`; clashes get the tag (`ordersCreateItem`), then a counter. */
  private operationId(summary: string, tag: string, used: Set<string>): string {
    const base = operationIdFrom(summary);
    let id = used.has(base) ? operationIdFrom(`${tag} ${summary}`) : base;
    for (let n = 2; used.has(id); n++) id = `${base}${n}`;
    used.add(id);
    return id;
  }
}
