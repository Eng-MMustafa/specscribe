/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as path from 'path';

/** Filename segments that carry no meaning for a docs group label. */
const NOISE_SEGMENTS = new Set([
  'routes', 'route', 'router', 'routers', 'controller', 'controllers',
  'handler', 'handlers', 'api', 'index', 'main', 'server', 'src',
]);

/** Segments whose most common REST verb is inferred from the HTTP method. */
const VERB_BY_METHOD: Record<string, string> = {
  post: 'Create',
  put: 'Update',
  patch: 'Update',
  delete: 'Delete',
};

export function pascalCase(input: string): string {
  return input
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

/**
 * Turns a route file path into a docs group label the way NestJS controller
 * names read: `routes/orders.js` → `Orders`, `users.routes.ts` → `Users`,
 * `websocket/orders.gateway.js` → `OrdersGateway`, `app.js` → `App`.
 */
export function friendlyName(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  const dir = path.basename(path.dirname(filePath));

  const segments = base.split(/[.\-_]+/).filter((s) => s && !NOISE_SEGMENTS.has(s.toLowerCase()));
  if (segments.length === 0) {
    const fallback = dir && !NOISE_SEGMENTS.has(dir.toLowerCase()) ? dir : base;
    return pascalCase(fallback) || 'App';
  }
  return pascalCase(segments.join(' '));
}

/**
 * Assigns friendly names to a list of files, disambiguating collisions with
 * the parent directory (`admin/users.js` + `public/users.js` →
 * `AdminUsers` / `PublicUsers`).
 */
export function friendlyNames(filePaths: string[]): Map<string, string> {
  const raw = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const file of filePaths) {
    const name = friendlyName(file);
    raw.set(file, name);
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  const result = new Map<string, string>();
  for (const file of filePaths) {
    const name = raw.get(file)!;
    if ((counts.get(name) || 0) > 1) {
      const dir = path.basename(path.dirname(file));
      result.set(file, pascalCase(dir) + name);
    } else {
      result.set(file, name);
    }
  }
  return result;
}

function singular(word: string): string {
  if (/ies$/i.test(word)) return word.replace(/ies$/i, 'y');
  if (/(ses|xes|zes|ches|shes)$/i.test(word)) return word.replace(/es$/i, '');
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Names a request body schema after the route the way a DTO would be named:
 * `POST /api/users` → `CreateUserBody`, `PUT /api/users/{id}` →
 * `UpdateUserBody`, `POST /api/auth/login` → `LoginBody`.
 */
export function bodySchemaName(method: string, routePath: string): string {
  return bodySchemaNameImpl(method, routePath);
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const isPlural = (s: string) => /s$/i.test(s) && !/ss$/i.test(s);
const words = (s: string) => s.replace(/[-_]+/g, ' ').trim();

/**
 * `getUserById` → `Get user by id`; `UserController.listAll` → `List all`;
 * `handleLogin` → `Login`. Returns '' for names that carry no meaning.
 */
export function humanizeIdentifier(name: string): string {
  const last = name.split('.').pop() || '';
  if (!last || /^(handler|handle|fn|cb|callback|route|middleware|controller|index|default|anonymous)$/i.test(last)) return '';
  const spaced = last
    .replace(/^(handle|on)(?=[A-Z])/, '')
    .replace(/(Handler|Controller|Route|Action)$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  return capitalize(spaced);
}

/**
 * A readable summary from the HTTP method and path, the way a REST
 * controller method would be named: `GET /users` → `List users`,
 * `GET /users/{id}` → `Get user`, `POST /users` → `Create user`,
 * `POST /auth/login` → `Login`, `POST /orders/{id}/cancel` → `Cancel order`.
 */
export function routeSummary(method: string, routePath: string, hasFileUpload = false): string {
  const raw = routePath.split('/').filter(Boolean).filter((s) => !/^v\d+$/i.test(s) && s.toLowerCase() !== 'api');
  const isParam = (s: string) => /^[{:]/.test(s);
  const statics = raw.filter((s) => !isParam(s));
  const endsWithParam = raw.length > 0 && isParam(raw[raw.length - 1]);
  const last = words(statics[statics.length - 1] || '');
  const parent = words(statics[statics.length - 2] || '');
  const verb = method.toLowerCase();
  if (!last) return verb === 'get' ? 'Get root' : `${capitalize(verb)} root`;

  if (endsWithParam) {
    const noun = singular(last);
    if (verb === 'get') return `Get ${noun}`;
    if (verb === 'put' || verb === 'patch') return `Update ${noun}`;
    if (verb === 'delete') return `Delete ${noun}`;
    return `${capitalize(verb)} ${noun}`;
  }
  // A static segment right after a param is a sub-resource or an action.
  const afterParam = raw.length > 1 && isParam(raw[raw.length - 2]);
  const owner = afterParam && parent ? ` ${singular(parent)}` : '';
  if (isPlural(last)) {
    const list = owner ? `${singular(parent)} ${last}` : last;
    if (verb === 'get') return `List ${list}`;
    if (verb === 'post') return `Create ${owner ? `${singular(parent)} ` : ''}${singular(last)}`;
    if (verb === 'delete') return `Delete ${list}`;
    return `Update ${list}`;
  }
  if (hasFileUpload) return `Upload${owner} ${last}`;
  if (verb === 'get') return `Get${owner} ${last}`;
  if (verb === 'put' || verb === 'patch') return `Update${owner} ${last}`;
  if (verb === 'delete') return `Delete${owner} ${last}`;
  // POST /auth/login → "Login", POST /orders/{id}/cancel → "Cancel order".
  return `${capitalize(last)}${owner}`;
}

/** `Create user` → `createUser`, keeping only identifier-safe characters. */
export function operationIdFrom(text: string): string {
  const parts = text.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'operation';
  const id = parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : capitalize(p))).join('');
  return /^[0-9]/.test(id) ? `op${id}` : id;
}

function bodySchemaNameImpl(method: string, routePath: string): string {
  const segments = routePath
    .split('/')
    .filter((s) => s && !/^[{:]/.test(s) && !/^v\d+$/i.test(s) && s.toLowerCase() !== 'api');
  const last = segments[segments.length - 1] || 'Request';
  const isCollection = /s$/i.test(last) && !/ss$/i.test(last);
  const verb = VERB_BY_METHOD[method.toLowerCase()] || '';
  const noun = pascalCase(isCollection ? singular(last) : last);
  return isCollection ? `${verb}${noun}Body` : `${noun}Body`;
}
