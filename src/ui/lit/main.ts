import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
import { keyed } from 'lit/directives/keyed.js';
import STYLES from './styles.css';
import {
  BodyMode, FormRow, CONTENT_TYPES, bodyModeFor, buildBody, curlBodyArgs, formRowsFromSchema, jsBody,
} from './request-body';
import {
  Scenario, StepRun, parseScenarios, runScenario, scenarioFileName, toScenarioFile,
} from './scenarios';
import {
  childPath, countNodes, getAt, isContainer, literal, searchJson, splitMatches, suggestName, summary,
  type SearchResult,
} from './json-view';
import {
  closeTab, mergeEnvironments, openTab, parseEnvironmentFile, toEnvironmentFile, type TabRef,
} from './workspace';

interface SchemaLike {
  type?: string;
  properties?: Record<string, SchemaLike>;
  required?: string[];
  items?: SchemaLike;
  enum?: unknown[];
  format?: string;
  example?: unknown;
  default?: unknown;
  description?: string;
  $ref?: string;
  nullable?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

interface PaletteItem {
  key: string;
  group: string;
  pill: unknown;
  title: string;
  sub: string;
  hay: string;
  run: () => void;
}

interface ParamInfo {
  name: string;
  in: string;
  required?: boolean;
  schema?: SchemaLike;
  description?: string;
}

interface OperationInfo {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: ParamInfo[];
  requestBody?: { description?: string; content?: Record<string, { schema?: SchemaLike; example?: unknown }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: SchemaLike; example?: unknown }> }>;
}

interface WsEvent {
  event: string;
  direction?: string;
  payload?: SchemaLike;
  response?: SchemaLike;
  summary?: string;
  description?: string;
  /** Events the server emits back while handling this one. */
  emits?: { event: string; payload?: SchemaLike }[];
}

interface WsGateway {
  name: string;
  namespace?: string;
  /** Wire protocol detected from the code: Socket.IO or plain WebSocket. */
  transport?: 'socket.io' | 'ws';
  /** `raw`: plain-WebSocket endpoints that read the payload as-is (e.g. `{ type: 'ping' }`). */
  frame?: 'event-data' | 'raw';
  events?: WsEvent[];
}

interface WsDoc {
  gateways?: WsGateway[];
}

interface GqlOperation {
  kind: 'query' | 'mutation' | 'subscription';
  name: string;
  summary?: string;
  sample?: string;
  args?: { name: string; schema?: SchemaLike }[];
  response?: SchemaLike;
}

interface GqlResolver {
  name: string;
  operations: GqlOperation[];
}

interface GqlDoc {
  resolvers?: GqlResolver[];
}

interface SpecDoc {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: { url?: string }[];
  paths?: Record<string, Record<string, OperationInfo>>;
  components?: { schemas?: Record<string, SchemaLike> };
  'x-specscribe-proxy'?: string;
  /** Path (on the docs page origin) of the spec-driven mock server. */
  'x-specscribe-mock'?: string;
}

type View = 'overview' | 'rest' | 'ws' | 'gql' | 'scenario';
type SideTab = 'collections' | 'history';
type ReqTab = 'params' | 'auth' | 'headers' | 'body' | 'docs' | 'code';
type ResTab = 'body' | 'headers';
type AuthType = 'none' | 'bearer' | 'apikey';
type WsTransport = 'auto' | 'socketio' | 'ws';

interface GlobalAuth {
  type: AuthType;
  token: string;
  header: string;
}

interface ReqAuth {
  mode: 'inherit' | AuthType;
  token: string;
  header: string;
}

interface Environment {
  name: string;
  baseUrl: string;
  vars: Record<string, string>;
  allowCredentials: boolean;
}

interface LogEntry {
  dir: 'in' | 'out' | 'sys';
  label: string;
  text: string;
  at: number;
}

interface HistoryEntry {
  method: string;
  path: string;
  status: number;
  at: number;
  ms: number;
  mock?: boolean;
}

interface WsConn {
  kind: 'ws' | 'socketio' | 'mock';
  socket: WebSocket | { emit: (e: string, d: unknown, ack?: (a: unknown) => void) => void; disconnect: () => void } | null;
}

const KNOWN_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

// Lucide-style stroke icons (static, trusted markup).
const ICONS: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',
  download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  wand: '<path d="m15 4 1-2 1 2 2 1-2 1-1 2-1-2-2-1zM3 21l12-12M14 7l3 3"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  logo: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  arrows: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
  hex: '<path d="M12 2 21 7v10l-9 5-9-5V7z"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  variable: '<path d="M8 21s-4-3-4-9 4-9 4-9M16 3s4 3 4 9-4 9-4 9M15 9l-6 6M9 9l6 6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
  rows: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  enter: '<path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
};

function icon(name: string, cls = '') {
  return html`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${unsafeSVG(ICONS[name] ?? '')}</svg>`;
}

const STATUS_TEXT: Record<number, string> = {
  0: 'Network Error', 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 409: 'Conflict', 413: 'Payload Too Large',
  415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

function statusClass(status: number): string {
  return status === 0 ? 's0' : `s${Math.floor(status / 100)}`;
}

function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function clock(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

/** Dotted JSON paths of a response (depth ≤ 3), offered as capture suggestions. */
function jsonPaths(value: unknown, prefix = '', depth = 0, out: string[] = []): string[] {
  if (depth > 3 || out.length > 60 || value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    if (value.length) jsonPaths(value[0], `${prefix}[0]`, depth + 1, out);
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child === null || typeof child !== 'object') out.push(path);
    else jsonPaths(child, path, depth + 1, out);
  }
  return out;
}

function isJsonish(text: string): boolean {
  // {{vars}} are substituted before sending, so treat them as valid tokens.
  return parseSafe(text.replace(/\{\{[^}]+\}\}/g, '0')) !== undefined;
}

const VARS_KEY = 'specscribe-vars';
const AUTH_KEY = 'specscribe-auth';
const HISTORY_KEY = 'specscribe-history';
const ENVS_KEY = 'specscribe-envs';
const ENV_ACTIVE_KEY = 'specscribe-env-active';
const COLLAPSED_KEY = 'specscribe-collapsed';
const LAYOUT_KEY = 'specscribe-layout';
const SIDE_KEY = 'specscribe-side';
const MOCK_KEY = 'specscribe-mock-mode';
const SCENARIOS_KEY = 'specscribe-scenarios';
const TIMEOUT_KEY = 'specscribe-timeout';
const TABS_KEY = 'specscribe-tabs';
/** Above this many nodes a response opens collapsed below depth 2. */
const BIG_JSON_NODES = 1500;
/** Children shown per array/object before a "show more" row. */
const JSON_PAGE = 100;
/** Raw text above this size is shown without search highlighting. */
const RAW_HIGHLIGHT_LIMIT = 2_000_000;
const DEFAULT_ACCENT = '#00f2ff';
const MAX_HISTORY = 50;

// A successful response that carries a bearer token applies it to the global
// auth automatically — Postman needs a script for this; here it is the default.
const TOKEN_KEYS = ['access_token', 'accessToken', 'access-token', 'token', 'jwt',
  'id_token', 'idToken', 'bearer', 'authToken', 'auth_token'];

function findToken(value: unknown, depth: number): string | null {
  if (!value || typeof value !== 'object' || depth > 3) return null;
  const obj = value as Record<string, unknown>;
  for (const key of TOKEN_KEYS) {
    const candidate = obj[key];
    if (typeof candidate === 'string' && candidate.length >= 8 && !candidate.includes(' ')) {
      return candidate;
    }
  }
  for (const key of Object.keys(obj)) {
    const nested = findToken(obj[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { io?: any }
}

function fillVars(text: string, vars: Record<string, string>): string {
  return String(text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) =>
    vars[key] !== undefined ? vars[key] : match,
  );
}

function parseSafe(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

function schemaExample(schema?: SchemaLike, depth = 0, fieldName = ''): unknown {
  if (!schema || depth > 5) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const name = fieldName.toLowerCase();
  switch (schema.type) {
    case 'string':
      if (schema.format === 'date-time' || /at$|date|time/.test(name)) return new Date().toISOString();
      if (schema.format === 'email' || name.includes('email')) return 'user@example.com';
      if (schema.format === 'uuid' || /(^|_)id$/.test(name) || name.endsWith('uuid')) return 'e6c8f5a0-4b1d-4a0f-9f3e-2d1c0b9a8f7e';
      if (name.includes('password') || name === 'secret') return 'P@ssw0rd!';
      if (name === 'username' || name === 'user') return 'demo';
      if (name.includes('phone')) return '+15551234567';
      if (name.includes('url') || name.includes('website')) return 'https://example.com';
      if (name.includes('name') || name === 'title') return 'Demo';
      return 'string';
    case 'number':
    case 'integer':
      if (/(^|_)id$|count|num|qty|quantity/.test(name)) return 1;
      if (/price|total|amount|cost/.test(name)) return 99.99;
      if (/year/.test(name)) return new Date().getFullYear();
      return 0;
    case 'boolean': return false;
    case 'array': {
      const item = schemaExample(schema.items, depth + 1, fieldName);
      return item === undefined ? [] : [item];
    }
    default: {
      if (!schema.properties) return {};
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(schema.properties)) {
        const v = schemaExample(sub, depth + 1, key);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
  }
}

function esc(value: string): string {
  // Text-content escaping only: quotes must stay intact so the JSON
  // tokenizer below can still recognise strings and keys.
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hljson(text: string): string {
  return esc(text).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g,
    (_m, str, colon, bool, num) => {
      if (str) return `<span class="j-${colon ? 'key' : 'str'}">${str}</span>${colon || ''}`;
      if (bool) return `<span class="j-bool">${bool}</span>`;
      return `<span class="j-num">${num}</span>`;
    },
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function parseVarsText(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of String(text || '').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return vars;
}

function varsToText(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n');
}

function encodeShare(state: Record<string, unknown>): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeShare(encoded: string): Record<string, unknown> | null {
  if (!encoded || encoded.length > 100000) return null;
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const value = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch { return null; }
}

const STRINGS: Record<'en' | 'ar', Record<string, string>> = {
  en: {
    search: 'Search requests…',
    collections: 'Collections', history: 'History', overview: 'Overview',
    params: 'Params', auth: 'Auth', headers: 'Headers', body: 'Body',
    docs: 'Docs', code: 'Code', send: 'Send', running: 'Sending…',
    queryParams: 'Query params', pathParams: 'Path params',
    authNone: 'No auth', authBearer: 'Bearer token', authApiKey: 'API key header',
    authInherit: 'Inherit global auth', header: 'Header', value: 'Value',
    authNote: 'Stored in your browser only. Requests can override it in their Auth tab.',
    response: 'Response', request: 'Request',
    varsHint: 'Capture values from responses to reuse as {{name}}',
    capture: 'Capture', varName: 'var name',
    connect: 'Connect', disconnect: 'Disconnect', connected: 'connected',
    disconnected: 'disconnected', connecting: 'connecting…',
    payload: 'Payload', log: 'Log', noMessages: 'Connect and send an event to see live traffic here.',
    eventName: 'event name', transport: 'Transport',
    run: 'Run', subscribe: 'Subscribe', stop: 'Stop',
    operation: 'Operation', variables: 'Variables',
    selectOp: 'Select an operation from the list',
    selectWs: 'Select a WebSocket event', selectGql: 'Select a GraphQL operation',
    clear: 'Clear', noHistory: 'No requests yet',
    copied: 'Copied', captured: 'Variable captured', shared: 'Link copied',
    description: 'Description', requestBody: 'Request body', responses: 'Responses',
    key: 'Key', type: 'Type', required: 'required',
    envTitle: 'Environments', envSubtitle: '(base URL + variables)',
    envName: 'Name', envBase: 'Base URL', envVars: 'Variables',
    envCreds: 'Send inherited authorization to this origin',
    save: 'Save', new: 'New', delete: 'Delete', envSelect: 'Environment',
    requests: 'Requests', groups: 'Groups', version: 'Version', baseUrl: 'Base URL',
    postman: 'Postman', openapi: 'OpenAPI', download: 'Download', copy: 'Copy',
    exportPostmanFailed: 'Export failed',
    sendInherited: 'Inherit global auth',
    envShort: 'Environments', noEnv: 'No environment', authorized: 'Authorized',
    exportPostman: 'Export Postman collection', openSpec: 'Open OpenAPI JSON',
    toggleTheme: 'Toggle light / dark', toggleLang: 'العربية', close: 'Close',
    collapseAll: 'Collapse all', expandAll: 'Expand all', noResults: 'No matching requests',
    endpoints: 'Endpoints', wsEvents: 'WebSocket events', gqlOps: 'GraphQL operations',
    quickStart: 'Quick start', methods: 'Methods',
    tipAuthTitle: 'Automatic auth',
    tipAuth: 'Call your login endpoint — any token in the response becomes the Bearer auth for every request.',
    tipChainTitle: 'Request chaining',
    tipChain: 'Save any response value as a variable and reuse it anywhere as {{name}}.',
    tipKeysTitle: 'Keyboard first',
    tipKeys: 'Ctrl+Enter sends · / focuses search · Esc closes panels.',
    overviewDefault: 'Interactive documentation generated straight from your source code.',
    beautify: 'Beautify', reset: 'Reset', validJson: 'Valid JSON', invalidJson: 'Invalid JSON',
    noParams: 'This request has no parameters', noBody: 'This request does not send a body',
    addHeader: 'Add header', autoHeaders: 'auto',
    emptyResponse: 'Send the request to see the response here', sendHint: 'Ctrl + Enter',
    pretty: 'Pretty', raw: 'Raw', captureTitle: 'Save as variable',
    copyCurl: 'cURL', share: 'Share', copyUrl: 'Copy URL',
    unresolvedHint: 'Some path parameters or {{variables}} are still unresolved.',
    schema: 'Schema', example: 'Example', field: 'Field',
    composer: 'Message', liveLog: 'Live traffic', waiting: 'Waiting for response…',
    authInheritDesc: 'Use the auth set in the top bar',
    authBearerDesc: 'Authorization: Bearer <token>',
    authApiKeyDesc: 'Custom header, e.g. X-API-Key',
    authNoneDesc: 'Send without credentials',
    loading: 'Loading API…', variablesActive: 'Variables',
    noEnvYet: 'No environments yet — create one below.',
    authTitle: 'Authorization', globalAuth: 'Global',
    apiDown: 'API unreachable', mockNote: 'Generated from the documented schema — not from your server.',
    live: 'Live', mock: 'Mock', mockSwitch: 'Send to the live API or the mock server',
    liveHint: 'Send requests to your running API', mockHint: 'Answer from the spec-driven mock server',
    mockModeHint: 'Mock mode: requests are answered by the mock server from the documented schemas.',
    mockModeLocal: 'Mock mode: responses are generated in the browser from the documented schemas.',
    mockOn: 'Switch to mock responses', mockOff: 'Switch to the live API',
    formData: 'Form data', urlencoded: 'URL-encoded', none: 'None', bodyType: 'Body type',
    noBodySent: 'No body will be sent', textKind: 'Text', fileKind: 'File', chooseFile: 'Choose file',
    changeFile: 'Change', addField: 'Add field', addParam: 'Add query param', enable: 'Enable',
    requestUrl: 'Request URL', schemas: 'Schemas', fields: 'fields',
    scenarios: 'Scenarios', steps: 'steps', import: 'Import', importScenario: 'Import scenario files',
    noScenarios: 'No scenarios yet — import a .scenario.json file.', scenariosImported: 'scenario(s) imported',
    generated: 'Generated', recorded: 'Recorded', imported: 'Imported', saved: 'Saved',
    scenarioHint: 'Runs each step in order and passes captured values to the next — same file format as `specscribe test`.',
    runAll: 'Run all', runAgain: 'Run again', runningSteps: 'Running…', stopOnFail: 'Stop at the first failure',
    passed: 'passed', failed: 'failed', allPassed: 'All steps passed', stepsFailed: 'step(s) failed',
    exportScenario: 'Export', editJson: 'Edit JSON', cancel: 'Cancel', expects: 'expects',
    bodyContains: 'body contains', matchesSpec: 'matches spec', notRunYet: 'Not run yet',
    capturedVars: 'Captured variables', useVars: 'Use in requests', varsSaved: 'Variables saved',
    emits: 'Emits back',
    tokenCaptured: 'Bearer token captured — applied to all requests', tokenSame: 'Signed in — this token is already applied to all requests',
    openRequests: 'Open requests', closeTab: 'Close tab', closeAllTabs: 'Close all',
    envExport: 'Export', envImport: 'Import', envImported: 'environment(s) imported — credentials are off until you enable them', envExported: 'Environments exported',
    retry: 'Retry', cancelHint: 'Stop this request (Esc)', cancelled: 'Request cancelled',
    timedOut: 'No response after {s} s — the request was stopped', timeoutLabel: 'Request timeout',
    allEnvs: '(all environments)', noTimeout: 'No timeout', searchResponse: 'Search response',
    hiddenNoMatch: '… {n} without matches', showMore: 'Show {n} more',
    clickToCapture: 'click to save as a variable', collapse: 'Collapse', expand: 'Expand',
    autoDetect: 'Auto-detect', tryFirst: 'Try it now', actions: 'Actions', toggleSplit: 'Toggle side-by-side layout', toggleSidebar: 'Toggle sidebar',
    searchEverything: 'Jump to an endpoint, event or action…', noMatches: 'Nothing matches',
    open: 'open', navigate: 'navigate', searchShort: 'Search', more: 'More',
    goodMorning: 'Good morning', goodAfternoon: 'Good afternoon', goodEvening: 'Good evening',
  },
  ar: {
    search: 'ابحث في الطلبات…',
    collections: 'المجموعات', history: 'السجل', overview: 'نظرة عامة',
    params: 'المعاملات', auth: 'المصادقة', headers: 'الترويسات', body: 'الجسم',
    docs: 'التوثيق', code: 'الكود', send: 'إرسال', running: 'جارٍ الإرسال…',
    queryParams: 'معاملات الاستعلام', pathParams: 'معاملات المسار',
    authNone: 'بدون مصادقة', authBearer: 'رمز Bearer', authApiKey: 'مفتاح API في الترويسة',
    authInherit: 'وراثة المصادقة العامة', header: 'الترويسة', value: 'القيمة',
    authNote: 'يُحفظ في متصفحك فقط. يمكن للطلبات تجاوزه في تبويب المصادقة.',
    response: 'الاستجابة', request: 'الطلب',
    varsHint: 'التقط قيماً من الاستجابات لإعادة استخدامها كـ {{name}}',
    capture: 'التقاط', varName: 'اسم المتغير',
    connect: 'اتصال', disconnect: 'قطع', connected: 'متصل',
    disconnected: 'غير متصل', connecting: 'جارٍ الاتصال…',
    payload: 'الحمولة', log: 'السجل', noMessages: 'اتصل وأرسل حدثاً لرؤية حركة البيانات هنا.',
    eventName: 'اسم الحدث', transport: 'النقل',
    run: 'تشغيل', subscribe: 'اشترك', stop: 'إيقاف',
    operation: 'العملية', variables: 'المتغيرات',
    selectOp: 'اختر عملية من القائمة',
    selectWs: 'اختر حدث WebSocket', selectGql: 'اختر عملية GraphQL',
    clear: 'مسح', noHistory: 'لا توجد طلبات بعد',
    copied: 'تم النسخ', captured: 'تم التقاط المتغير', shared: 'تم نسخ الرابط',
    description: 'الوصف', requestBody: 'جسم الطلب', responses: 'الاستجابات',
    key: 'المفتاح', type: 'النوع', required: 'مطلوب',
    envTitle: 'البيئات', envSubtitle: '(الرابط الأساسي + المتغيرات)',
    envName: 'الاسم', envBase: 'الرابط الأساسي', envVars: 'المتغيرات',
    envCreds: 'أرسل المصادقة الموروثة لهذا الـ origin',
    save: 'حفظ', new: 'جديد', delete: 'حذف', envSelect: 'البيئة',
    requests: 'الطلبات', groups: 'المجموعات', version: 'الإصدار', baseUrl: 'الرابط الأساسي',
    postman: 'Postman', openapi: 'OpenAPI', download: 'تنزيل', copy: 'نسخ',
    exportPostmanFailed: 'فشل التصدير',
    sendInherited: 'وراثة المصادقة العامة',
    envShort: 'البيئات', noEnv: 'بدون بيئة', authorized: 'مُصرّح',
    exportPostman: 'تصدير مجموعة Postman', openSpec: 'فتح OpenAPI JSON',
    toggleTheme: 'تبديل الوضع الفاتح / الداكن', toggleLang: 'English', close: 'إغلاق',
    collapseAll: 'طي الكل', expandAll: 'توسيع الكل', noResults: 'لا توجد طلبات مطابقة',
    endpoints: 'نقاط النهاية', wsEvents: 'أحداث WebSocket', gqlOps: 'عمليات GraphQL',
    quickStart: 'بداية سريعة', methods: 'الطرق',
    tipAuthTitle: 'مصادقة تلقائية',
    tipAuth: 'استدعِ نقطة تسجيل الدخول — أي رمز في الاستجابة يصبح مصادقة Bearer لكل الطلبات.',
    tipChainTitle: 'ربط الطلبات',
    tipChain: 'احفظ أي قيمة من الاستجابة كمتغير واستخدمها في أي مكان كـ {{name}}.',
    tipKeysTitle: 'لوحة المفاتيح',
    tipKeys: 'Ctrl+Enter للإرسال · / للبحث · Esc لإغلاق اللوحات.',
    overviewDefault: 'توثيق تفاعلي مُولّد مباشرة من الكود المصدري.',
    beautify: 'تنسيق', reset: 'استعادة', validJson: 'JSON صالح', invalidJson: 'JSON غير صالح',
    noParams: 'هذا الطلب بدون معاملات', noBody: 'هذا الطلب لا يرسل جسماً',
    addHeader: 'إضافة ترويسة', autoHeaders: 'تلقائي',
    emptyResponse: 'أرسل الطلب لرؤية الاستجابة هنا', sendHint: 'Ctrl + Enter',
    pretty: 'منسّق', raw: 'خام', captureTitle: 'حفظ كمتغير',
    copyCurl: 'cURL', share: 'مشاركة', copyUrl: 'نسخ الرابط',
    unresolvedHint: 'بعض معاملات المسار أو {{المتغيرات}} غير محددة بعد.',
    schema: 'المخطط', example: 'مثال', field: 'الحقل',
    composer: 'الرسالة', liveLog: 'الحركة المباشرة', waiting: 'بانتظار الاستجابة…',
    authInheritDesc: 'استخدم المصادقة المحددة في الشريط العلوي',
    authBearerDesc: 'Authorization: Bearer <token>',
    authApiKeyDesc: 'ترويسة مخصصة مثل X-API-Key',
    authNoneDesc: 'إرسال بدون بيانات اعتماد',
    loading: 'جارٍ تحميل الـ API…', variablesActive: 'المتغيرات',
    noEnvYet: 'لا توجد بيئات بعد — أنشئ واحدة بالأسفل.',
    authTitle: 'المصادقة', globalAuth: 'عام',
    apiDown: 'تعذّر الوصول إلى الخادم', mockNote: 'استجابة مولّدة من المخطط الموثّق — وليست من خادمك.',
    live: 'حقيقي', mock: 'وهمي', mockSwitch: 'الإرسال إلى الخادم الحقيقي أو الخادم الوهمي',
    liveHint: 'إرسال الطلبات إلى الخادم الشغّال', mockHint: 'الرد من الخادم الوهمي المبني على المواصفات',
    mockModeHint: 'الوضع الوهمي: الخادم الوهمي يرد على الطلبات من المخططات الموثّقة.',
    mockModeLocal: 'الوضع الوهمي: الاستجابات تتولّد في المتصفح من المخططات الموثّقة.',
    mockOn: 'التحويل إلى الاستجابات الوهمية', mockOff: 'التحويل إلى الخادم الحقيقي',
    formData: 'نموذج بيانات', urlencoded: 'نموذج مُرمّز', none: 'بدون', bodyType: 'نوع الجسم',
    noBodySent: 'لن يُرسل أي جسم', textKind: 'نص', fileKind: 'ملف', chooseFile: 'اختر ملفاً',
    changeFile: 'تغيير', addField: 'إضافة حقل', addParam: 'إضافة معامل استعلام', enable: 'تفعيل',
    requestUrl: 'رابط الطلب', schemas: 'المخططات', fields: 'حقول',
    scenarios: 'السيناريوهات', steps: 'خطوات', import: 'استيراد', importScenario: 'استيراد ملفات سيناريو',
    noScenarios: 'لا توجد سيناريوهات بعد — استورد ملف ‎.scenario.json‎.', scenariosImported: 'سيناريو تم استيراده',
    generated: 'مُولّد', recorded: 'مُسجّل', imported: 'مستورد', saved: 'تم الحفظ',
    scenarioHint: 'يشغّل الخطوات بالترتيب ويمرّر القيم الملتقطة للخطوة التالية — نفس صيغة ملفات ‎specscribe test‎.',
    runAll: 'تشغيل الكل', runAgain: 'تشغيل مرة أخرى', runningSteps: 'جارٍ التشغيل…', stopOnFail: 'التوقف عند أول فشل',
    passed: 'نجحت', failed: 'فشلت', allPassed: 'نجحت كل الخطوات', stepsFailed: 'خطوة فشلت',
    exportScenario: 'تصدير', editJson: 'تعديل JSON', cancel: 'إلغاء', expects: 'المتوقع',
    bodyContains: 'الجسم يحتوي', matchesSpec: 'مطابق للمواصفات', notRunYet: 'لم يُشغّل بعد',
    capturedVars: 'المتغيرات الملتقطة', useVars: 'استخدامها في الطلبات', varsSaved: 'تم حفظ المتغيرات',
    emits: 'يُرسل الخادم',
    tokenCaptured: 'تم التقاط رمز الدخول — يُستخدم في كل الطلبات', tokenSame: 'تم تسجيل الدخول — هذا الرمز مُستخدم بالفعل في كل الطلبات',
    openRequests: 'الطلبات المفتوحة', closeTab: 'إغلاق التبويب', closeAllTabs: 'إغلاق الكل',
    envExport: 'تصدير', envImport: 'استيراد', envImported: 'بيئة تم استيرادها — بيانات الدخول مُعطّلة حتى تفعّلها', envExported: 'تم تصدير البيئات',
    retry: 'إعادة المحاولة', cancelHint: 'إيقاف هذا الطلب (Esc)', cancelled: 'تم إلغاء الطلب',
    timedOut: 'لا يوجد رد بعد {s} ث — تم إيقاف الطلب', timeoutLabel: 'مهلة الطلب',
    allEnvs: '(لكل البيئات)', noTimeout: 'بدون مهلة', searchResponse: 'بحث في الرد',
    hiddenNoMatch: '… {n} بدون نتائج', showMore: 'عرض {n} أخرى',
    clickToCapture: 'اضغط لحفظها كمتغير', collapse: 'طي', expand: 'توسيع',
    autoDetect: 'اكتشاف تلقائي', tryFirst: 'جرّب الآن', actions: 'إجراءات', toggleSplit: 'تبديل العرض الجانبي', toggleSidebar: 'إظهار / إخفاء الشريط الجانبي',
    searchEverything: 'انتقل إلى نقطة نهاية أو حدث أو إجراء…', noMatches: 'لا توجد نتائج',
    open: 'فتح', navigate: 'تنقل', searchShort: 'بحث', more: 'المزيد',
    goodMorning: 'صباح الخير', goodAfternoon: 'مساء الخير', goodEvening: 'مساء الخير',
  },
};

@customElement('specscribe-docs')
export class SpecScribeDocs extends LitElement {
  createRenderRoot() { return this; }

  static styles = css``;

  @property({ type: String, attribute: 'spec-url' }) specUrl = './docs-json';
  @property({ type: String }) theme = 'futuristic';
  @property({ type: String }) language: 'en' | 'ar' = 'en';
  @property({ type: String, attribute: 'primary-color' }) primaryColor = '';

  @state() private spec: SpecDoc | null = null;
  @state() private wsDoc: WsDoc | null = null;
  @state() private gqlDoc: GqlDoc | null = null;
  @state() private error = '';
  @state() private view: View = 'overview';

  // Sidebar
  @state() private sideTab: SideTab = 'collections';
  @state() private search = '';
  @state() private collapsed = new Set<string>();

  // REST state
  @state() private selected: OperationInfo | null = null;
  @state() private reqTab: ReqTab = 'params';
  @state() private resTab: ResTab = 'body';
  @state() private bodyText = '';
  @state() private headerRows: { key: string; value: string }[] = [];
  @state() private queryParams: Record<string, string> = {};
  @state() private pathParams: Record<string, string> = {};
  @state() private reqAuth: ReqAuth = { mode: 'inherit', token: '', header: '' };
  private reqAuthStore: Record<string, ReqAuth> = {};
  @state() private codeLang: 'curl' | 'fetch' | 'axios' = 'curl';
  @state() private running = false;
  @state() private responseText = '';
  @state() private responseHeaders: Record<string, string> = {};
  @state() private responseStatus = 0;
  @state() private responseMs = 0;
  @state() private responseSize = 0;
  @state() private lastResponseJson: unknown = null;
  @state() private captureName = '';
  @state() private capturePath = '';
  @state() private vars: Record<string, string> = {};
  @state() private history: HistoryEntry[] = [];

  // Global auth + environments
  @state() private globalAuth: GlobalAuth = { type: 'none', token: '', header: 'X-API-Key' };
  @state() private authOpen = false;
  @state() private envOpen = false;
  @state() private envs: Environment[] = [];
  @state() private envActive = '';
  @state() private envEditing: Environment | null = null;
  @state() private envName = '';
  @state() private envBase = '';
  @state() private envVarsText = '';
  @state() private envCreds = false;

  // WS state
  @state() private wsUrl = '';
  @state() private wsTransport: WsTransport = 'auto';
  @state() private wsSelected: { gateway: WsGateway; event: WsEvent } | null = null;
  @state() private wsEventName = '';
  @state() private wsLog: LogEntry[] = [];
  @state() private wsStatus: 'disconnected' | 'connecting…' | 'connected' | 'error' = 'disconnected';
  @state() private wsPayloadText = '';
  private wsConn: WsConn | null = null;
  private wsPendingSend = false;

  // GraphQL state
  @state() private gqlSelected: { resolver: GqlResolver; operation: GqlOperation } | null = null;
  @state() private gqlQueryText = '';
  @state() private gqlVarsText = '';
  @state() private gqlRunning = false;
  @state() private gqlResponseText = '';
  @state() private gqlResponseMeta = '';
  private gqlWs: WebSocket | null = null;

  @state() private themeName: 'futuristic' | 'classic' = 'futuristic';
  @state() private uiLang: 'en' | 'ar' = 'en';
  @state() private toast = '';
  @state() private sidebarOpen = false;
  @state() private sideHidden = false;
  @state() private sideWidth = 300;
  @state() private splitView = false;
  @state() private moreOpen = false;
  @state() private paletteOpen = false;
  @state() private paletteQuery = '';
  @state() private paletteIndex = 0;
  @state() private respSeq = 0;
  @state() private bodyMode: BodyMode = 'json';
  @state() private formRows: FormRow[] = [];
  @state() private extraQuery: { key: string; value: string; enabled: boolean }[] = [];
  @state() private urlOverride: string | null = null;
  @state() private mockMode = false;
  @state() private responseMock = false;
  @state() private responseNote = '';
  @state() private scenarios: Scenario[] = [];
  @state() private scenarioIndex = -1;
  @state() private scenarioRuns: StepRun[] = [];
  @state() private scenarioRunning = false;
  @state() private scenarioVars: Record<string, string> = {};
  @state() private scenarioStopOnFail = true;
  @state() private scenarioOpen = new Set<number>();
  @state() private scenarioDraft: string | null = null;
  @state() private scenarioMs = 0;
  @state() private openSchemas = new Set<string>();
  @state() private resRaw = false;
  /** JSON viewer: nodes whose default open/closed state the user flipped. */
  @state() private jsonToggled = new Set<string>();
  /** JSON viewer: big containers the user asked to show in full. */
  @state() private jsonShowAll = new Set<string>();
  /** Containers deeper than this start collapsed (big responses only). */
  private jsonOpenDepth = Infinity;
  @state() private respSearch = '';
  private respHit = 0;
  private respSearchCache: { json: unknown; needle: string; result: SearchResult } | null = null;
  /** Why the last request produced no response (cancelled, timed out). */
  @state() private responseError = '';
  @state() private timeoutSec = 30;
  private abortCtl: AbortController | null = null;
  private scenarioCancelled = false;
  /** Open request tabs (Postman-style) and each tab's request/response state. */
  @state() private tabs: TabRef[] = [];
  @state() private activeTab = '';
  private tabStates = new Map<string, Record<string, unknown>>();
  @state() private disabledQuery = new Set<string>();
  private bodyExample = '';
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private lastActiveNav = '';

  private hashHandler = () => this.applyHash();

  private keyHandler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (this.paletteOpen) this.closePalette(); else this.openPalette();
      return;
    }
    if (this.paletteOpen) return;
    // Ctrl/Cmd+Enter sends the current request, like Postman.
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (this.view === 'rest' && this.selected) void this.send();
      else if (this.view === 'ws') this.wsSend();
      else if (this.view === 'gql' && this.gqlSelected) void this.runGql();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      this.toggleSidebar();
    } else if (e.key === 'Escape') {
      if ((this.running || this.gqlRunning || this.scenarioRunning) && !this.authOpen && !this.envOpen && !this.moreOpen) {
        this.cancelRequest();
        return;
      }
      this.authOpen = false;
      this.envOpen = false;
      this.moreOpen = false;
      this.sidebarOpen = false;
    } else if (e.key === '/' && !typing) {
      e.preventDefault();
      this.sideTab = 'collections';
      (this.querySelector('#ss-search') as HTMLInputElement | null)?.focus();
    }
  };

  private outsideClick = (e: MouseEvent) => {
    if (!this.authOpen && !this.envOpen && !this.moreOpen) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('.pop, .pop-trigger')) return;
    this.authOpen = false;
    this.envOpen = false;
    this.moreOpen = false;
  };

  /**
   * Swaps the main view with a View Transition (cross-fade + slide) where the
   * browser supports it; the sidebar keeps its own identity so it stays still.
   */
  private navigate(apply: () => void): void {
    const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };
    const run = async () => {
      apply();
      await this.updateComplete;
      this.querySelector('main')?.scrollTo({ top: 0 });
    };
    if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      doc.startViewTransition(run);
    } else {
      void run();
    }
  }

  private goOverview = () => this.navigate(() => this.showOverview());

  private isNarrow(): boolean {
    return matchMedia('(max-width: 880px)').matches;
  }

  private toggleSidebar(): void {
    if (this.isNarrow()) { this.sidebarOpen = !this.sidebarOpen; return; }
    this.sideHidden = !this.sideHidden;
    try { localStorage.setItem(SIDE_KEY, JSON.stringify({ w: this.sideWidth, hidden: this.sideHidden })); } catch { /* ignore */ }
  }

  private setSideWidth(width: number): void {
    this.sideWidth = Math.round(Math.min(480, Math.max(220, width)));
    this.style.setProperty('--side', `${this.sideWidth}px`);
  }

  private startResize = (e: PointerEvent) => {
    e.preventDefault();
    const rtl = this.dir === 'rtl';
    const startX = e.clientX;
    const startW = this.sideWidth;
    const move = (ev: PointerEvent) => this.setSideWidth(startW + (ev.clientX - startX) * (rtl ? -1 : 1));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.classList.remove('resizing');
      try { localStorage.setItem(SIDE_KEY, JSON.stringify({ w: this.sideWidth, hidden: this.sideHidden })); } catch { /* ignore */ }
    };
    this.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  private toggleSplit(): void {
    this.splitView = !this.splitView;
    try { localStorage.setItem(LAYOUT_KEY, this.splitView ? 'split' : 'stack'); } catch { /* ignore */ }
  }

  /* ---------------------------- command palette ---------------------------- */

  private openPalette(): void {
    this.paletteOpen = true;
    this.paletteQuery = '';
    this.paletteIndex = 0;
    this.authOpen = this.envOpen = this.moreOpen = false;
  }

  private closePalette(): void {
    this.paletteOpen = false;
  }

  private paletteItems(): PaletteItem[] {
    const items: PaletteItem[] = [];
    for (const op of this.operations()) {
      const title = this.opTitle(op);
      items.push({
        key: `r:${this.opId(op)}`, group: op.tags?.[0] || 'REST', pill: this.methodPill(op.method),
        title, sub: title === op.path ? '' : op.path,
        hay: `${op.method} ${op.path} ${op.summary ?? ''} ${op.tags?.join(' ') ?? ''}`.toLowerCase(),
        run: () => { this.select(op); this.setHash(this.opId(op)); },
      });
    }
    for (const gw of this.wsDoc?.gateways ?? []) {
      for (const ev of gw.events ?? []) {
        items.push({
          key: `w:${gw.name}/${ev.event}`, group: gw.name, pill: this.methodPill('ws'),
          title: ev.event, sub: gw.namespace || '', hay: `ws websocket ${gw.name} ${ev.event}`.toLowerCase(),
          run: () => this.selectWs(gw, ev),
        });
      }
    }
    for (const r of this.gqlDoc?.resolvers ?? []) {
      for (const op of r.operations) {
        items.push({
          key: `g:${r.name}/${op.name}`, group: r.name, pill: this.methodPill(op.kind),
          title: op.name, sub: op.summary || '', hay: `graphql gql ${op.kind} ${r.name} ${op.name}`.toLowerCase(),
          run: () => this.selectGql(r, op),
        });
      }
    }
    this.scenarios.forEach((sc, i) => items.push({
      key: `s:${i}`, group: this.t('scenarios'), pill: html`<span class="m m-flow">FLOW</span>`,
      title: sc.name, sub: `${sc.steps.length} ${this.t('steps')}`, hay: `scenario flow ${sc.name}`.toLowerCase(),
      run: () => this.selectScenario(i),
    }));
    const action = (key: string, iconName: string, title: string, run: () => void): PaletteItem => ({
      key: `a:${key}`, group: this.t('actions'), pill: html`<span class="pal-ic">${icon(iconName)}</span>`,
      title, sub: '', hay: `> ${title}`.toLowerCase(), run,
    });
    items.push(
      action('overview', 'home', this.t('overview'), () => this.showOverview()),
      action('theme', this.themeName === 'classic' ? 'moon' : 'sun', this.t('toggleTheme'), () => this.toggleTheme()),
      action('lang', 'globe', this.t('toggleLang'), () => this.toggleLanguage()),
      action('split', 'columns', this.t('toggleSplit'), () => this.toggleSplit()),
      action('sidebar', 'sidebar', this.t('toggleSidebar'), () => this.toggleSidebar()),
      action('env', 'globe', this.t('envTitle'), () => { this.envOpen = true; }),
      action('auth', 'key', this.t('authTitle'), () => { this.authOpen = true; }),
      action('postman', 'download', this.t('exportPostman'), () => this.exportPostman()),
      action('mock', 'bolt', this.mockMode ? this.t('mockOff') : this.t('mockOn'), () => this.setMockMode(!this.mockMode)),
      action('import', 'plus', this.t('importScenario'), () => this.importScenarios()),
    );
    const tokens = this.paletteQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return items.slice(0, 60);
    return items
      .filter(it => tokens.every(tok => it.hay.includes(tok) || it.title.toLowerCase().includes(tok)))
      .sort((a, b) => Number(b.title.toLowerCase().startsWith(tokens[0])) - Number(a.title.toLowerCase().startsWith(tokens[0])))
      .slice(0, 60);
  }

  private runPaletteItem(item: PaletteItem | undefined): void {
    if (!item) return;
    this.closePalette();
    this.navigate(item.run);
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.themeName = this.theme === 'classic' ? 'classic' : 'futuristic';
    this.uiLang = this.language === 'ar' ? 'ar' : 'en';
    if (this.uiLang === 'ar') this.dir = 'rtl';
    this.classList.add(this.themeName);
    try {
      const vars = localStorage.getItem(VARS_KEY);
      if (vars) this.vars = JSON.parse(vars) as Record<string, string>;
      const auth = localStorage.getItem(AUTH_KEY);
      if (auth) this.globalAuth = { ...this.globalAuth, ...JSON.parse(auth) as Partial<GlobalAuth> };
      const history = localStorage.getItem(HISTORY_KEY);
      if (history) this.history = JSON.parse(history) as HistoryEntry[];
      const envs = localStorage.getItem(ENVS_KEY);
      if (envs) this.envs = JSON.parse(envs) as Environment[];
      this.envActive = localStorage.getItem(ENV_ACTIVE_KEY) || '';
      const collapsed = localStorage.getItem(COLLAPSED_KEY);
      if (collapsed) this.collapsed = new Set(JSON.parse(collapsed) as string[]);
      const layout = localStorage.getItem(LAYOUT_KEY);
      this.splitView = layout ? layout === 'split' : window.innerWidth >= 1500;
      const side = JSON.parse(localStorage.getItem(SIDE_KEY) || '{}') as { w?: number; hidden?: boolean };
      if (side.w) this.setSideWidth(side.w);
      this.sideHidden = side.hidden === true;
      this.mockMode = localStorage.getItem(MOCK_KEY) === '1';
      const timeout = Number(localStorage.getItem(TIMEOUT_KEY));
      if (localStorage.getItem(TIMEOUT_KEY) !== null && Number.isFinite(timeout) && timeout >= 0) this.timeoutSec = timeout;
    } catch { /* ignore */ }
    // A custom brand colour overrides the theme accent (the default does not).
    const accent = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(this.primaryColor) ? this.primaryColor : '';
    if (accent && accent.toLowerCase() !== DEFAULT_ACCENT) {
      this.style.setProperty('--accent', accent);
      this.style.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 12%, transparent)`);
    }
    if (!document.getElementById('specscribe-lit-css')) {
      const style = document.createElement('style');
      style.id = 'specscribe-lit-css';
      style.textContent = STYLES;
      document.head.appendChild(style);
    }
    window.addEventListener('hashchange', this.hashHandler);
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('click', this.outsideClick);
    this.narrowQuery.addEventListener('change', this.narrowChange);
    void this.loadSpecs();
  }

  private narrowQuery = matchMedia('(max-width: 880px)');
  private narrowChange = () => { this.sidebarOpen = false; this.requestUpdate(); };

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.narrowQuery.removeEventListener('change', this.narrowChange);
    window.removeEventListener('hashchange', this.hashHandler);
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('click', this.outsideClick);
  }

  private siblingUrl(suffix: string): string {
    return this.specUrl.replace(/-json(?:\?.*)?$/, `-${suffix}`);
  }

  /**
   * Reads a document inlined in the page (static `export` builds open from
   * disk, where fetch() is unavailable), otherwise fetches it.
   */
  private async loadDoc<T>(url: string, inlineId: string): Promise<T | null> {
    const inline = document.getElementById(inlineId);
    if (inline) {
      try { return JSON.parse(inline.textContent || 'null') as T; } catch { return null; }
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private async loadSpecs(): Promise<void> {
    try {
      const spec = await this.loadDoc<SpecDoc>(this.specUrl, 'specscribe-spec');
      if (!spec) throw new Error('empty document');
      // Big APIs start collapsed (like a Postman collection) unless the user
      // already arranged the sidebar — decided before the first render so
      // thousands of rows are never built. Selecting an item opens its group.
      this.opsCache = { spec: null, ops: [], hay: [] };
      const count = Object.values(spec.paths ?? {}).reduce((n, item) => n + Object.keys(item ?? {}).filter(m => HTTP_METHODS.has(m)).length, 0);
      if (count > 300 && localStorage.getItem(COLLAPSED_KEY) === null) {
        const tags = new Set<string>();
        for (const item of Object.values(spec.paths ?? {})) {
          for (const [m, op] of Object.entries(item ?? {})) if (HTTP_METHODS.has(m)) tags.add(op?.tags?.[0] || 'Other');
        }
        this.collapsed = new Set([...tags].map(tag => `rest:${tag}`));
      }
      this.spec = spec;
    } catch (e) {
      this.error = String(e);
      return;
    }
    const optional = async <T>(suffix: string, id: string): Promise<T | null> => {
      try { return await this.loadDoc<T>(this.siblingUrl(suffix), id); } catch { return null; }
    };
    const [ws, gql, sc] = await Promise.all([
      optional<WsDoc>('ws-json', 'specscribe-ws'),
      optional<GqlDoc>('graphql-json', 'specscribe-graphql'),
      optional<{ scenarios?: Scenario[] }>('scenarios-json', 'specscribe-scenarios'),
    ]);
    this.wsDoc = ws;
    this.gqlDoc = gql;
    let local: Scenario[] = [];
    try { local = parseScenarios(localStorage.getItem(SCENARIOS_KEY) || '[]').map(s => ({ ...s, source: 'imported' as const })); } catch { /* none saved */ }
    this.scenarios = [...local, ...(sc?.scenarios ?? [])];
    // Last session's tabs, then the deep link (which focuses or adds a tab).
    this.restoreTabs();
    // Deep links to WS / GraphQL / scenarios need their documents loaded first.
    this.applyHash();
  }

  private t(key: string): string {
    return STRINGS[this.uiLang][key] ?? STRINGS.en[key] ?? key;
  }

  private showToast(message: string): void {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = ''; }, 2800);
  }

  private setGlobalAuth(auth: GlobalAuth): void {
    this.globalAuth = auth;
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); } catch { /* ignore */ }
  }

  private autoCaptureToken(text: string): void {
    const parsed = parseSafe(text);
    if (parsed === undefined) return;
    const token = findToken(parsed, 0);
    if (!token) return;
    const current = this.globalAuth;
    // Always confirm a login: APIs that hand out a fixed token (demos, test
    // users) used to get no feedback at all from the second sign-in on.
    if (current.type === 'bearer' && current.token === token) {
      this.showToast(this.t('tokenSame'));
      return;
    }
    this.setGlobalAuth({ type: 'bearer', token, header: current.header || '' });
    // Also keep it available as {{token}} for hand-written requests.
    if (!this.vars.token) this.saveVar('token', token);
    this.showToast(this.t('tokenCaptured'));
  }

  private async copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.showToast(this.t('copied'));
    } catch { /* ignore */ }
  }

  /* ---------------------------- environments ---------------------------- */

  private activeEnv(): Environment | null {
    if (!this.envActive) return null;
    return this.envs.find(e => e.name === this.envActive) ?? null;
  }

  private allVars(): Record<string, string> {
    const env = this.activeEnv();
    return { ...this.vars, ...(env?.vars ?? {}) };
  }

  private saveEnvs(): void {
    try { localStorage.setItem(ENVS_KEY, JSON.stringify(this.envs)); } catch { /* ignore */ }
  }

  private setActiveEnv(name: string): void {
    this.envActive = name;
    try { localStorage.setItem(ENV_ACTIVE_KEY, name); } catch { /* ignore */ }
  }

  private envStartEdit(env: Environment | null): void {
    this.envEditing = env;
    this.envName = env?.name ?? '';
    this.envBase = env?.baseUrl ?? '';
    this.envVarsText = env ? varsToText(env.vars) : '';
    this.envCreds = env?.allowCredentials === true;
  }

  private envSave(): void {
    const name = this.envName.trim();
    if (!name) return;
    this.envs = [
      ...this.envs.filter(e => e.name !== name && e !== this.envEditing),
      {
        name,
        baseUrl: this.envBase.trim(),
        vars: parseVarsText(this.envVarsText),
        allowCredentials: this.envCreds,
      },
    ];
    this.saveEnvs();
    this.setActiveEnv(name);
    this.envEditing = null;
    this.showToast(this.t('save'));
  }

  private exportEnvs(): void {
    this.download('specscribe-environments.json', toEnvironmentFile(this.envs), 'application/json');
    this.showToast(this.t('envExported'));
  }

  /** Our own file or a Postman environment; same-named environments are replaced. */
  private importEnvs(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const imported = parseEnvironmentFile(await file.text());
        this.envs = mergeEnvironments(this.envs, imported);
        this.saveEnvs();
        if (imported.length === 1) this.setActiveEnv(imported[0].name);
        this.envStartEdit(this.envs.find(e => e.name === imported[0].name) ?? null);
        this.showToast(`${imported.length} ${this.t('envImported')}`);
      } catch (e) {
        this.showToast(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    input.click();
  }

  private envDelete(): void {
    if (!this.envEditing) return;
    const name = this.envEditing.name;
    this.envs = this.envs.filter(e => e !== this.envEditing);
    this.saveEnvs();
    if (this.envActive === name) this.setActiveEnv('');
    this.envEditing = null;
    this.envName = '';
    this.envBase = '';
    this.envVarsText = '';
    this.envCreds = false;
  }

  /* ---------------------------- data ---------------------------- */

  /**
   * Resolves `#/components/schemas/Name` references (with cycle protection) and
   * flattens `allOf` compositions, so generated examples always show real
   * fields instead of `{}`.
   */
  private resolveSchema(schema: SchemaLike | undefined, depth = 0): SchemaLike | undefined {
    if (!schema || depth > 8) return schema;
    if (schema.$ref) {
      const name = schema.$ref.split('/').pop() || '';
      const target = this.spec?.components?.schemas?.[name];
      if (target) {
        const { $ref: _ignored, ...rest } = schema;
        return this.resolveSchema({ ...target, ...rest }, depth + 1);
      }
      return schema;
    }
    const allOf = (schema as SchemaLike & { allOf?: SchemaLike[] }).allOf;
    if (allOf?.length) {
      const merged: SchemaLike = { type: 'object', properties: {}, required: [] };
      for (const part of allOf) {
        const resolved = this.resolveSchema(part, depth + 1);
        if (!resolved) continue;
        merged.properties = { ...merged.properties, ...(resolved.properties ?? {}) };
        merged.required = [...(merged.required ?? []), ...(resolved.required ?? [])];
        if (resolved.type && resolved.type !== 'object') merged.type = resolved.type;
      }
      return merged;
    }
    return schema;
  }

  private example(schema?: SchemaLike, name = ''): unknown {
    return schemaExample(this.resolveSchema(schema), 0, name);
  }

  private opsCache: { spec: SpecDoc | null; ops: OperationInfo[]; hay: string[] } = { spec: null, ops: [], hay: [] };
  private groupedCache = new Map<string, Map<string, OperationInfo[]>>();

  /** Flattened operations — computed once per document (large APIs render this on every keystroke). */
  private operations(): OperationInfo[] {
    if (this.opsCache.spec !== this.spec) {
      const ops: OperationInfo[] = [];
      for (const [pathKey, methods] of Object.entries(this.spec?.paths ?? {})) {
        for (const [method, op] of Object.entries(methods ?? {})) {
          // Path items also carry `parameters`, `summary`, `servers`, `$ref`…
          if (!HTTP_METHODS.has(method) || !op || typeof op !== 'object') continue;
          ops.push({ ...op, method: method.toUpperCase(), path: pathKey });
        }
      }
      const hay = ops.map(op => `${op.method} ${op.path} ${op.summary ?? ''} ${op.operationId ?? ''} ${op.tags?.join(' ') ?? ''}`.toLowerCase());
      this.opsCache = { spec: this.spec, ops, hay };
      this.groupedCache.clear();
    }
    return this.opsCache.ops;
  }

  private grouped(ignoreSearch = false): Map<string, OperationInfo[]> {
    const ops = this.operations();
    const needle = ignoreSearch ? '' : this.search.trim().toLowerCase();
    const cached = this.groupedCache.get(needle);
    if (cached) return cached;
    const tokens = needle.split(/\s+/).filter(Boolean);
    const map = new Map<string, OperationInfo[]>();
    ops.forEach((op, i) => {
      if (tokens.length && !tokens.every(tok => this.opsCache.hay[i].includes(tok))) return;
      const tag = op.tags?.[0] || 'Other';
      if (!map.has(tag)) map.set(tag, []);
      map.get(tag)!.push(op);
    });
    if (this.groupedCache.size > 50) this.groupedCache.clear();
    this.groupedCache.set(needle, map);
    return map;
  }

  private opId(op: OperationInfo): string {
    return `${op.method}:${op.path}`;
  }

  /* ---------------------------- REST ---------------------------- */

  /** Opens the sidebar group holding the item that was just selected. */
  private revealGroup(key: string): void {
    if (this.collapsed.has(key)) {
      const next = new Set(this.collapsed);
      next.delete(key);
      this.collapsed = next;
    }
  }

  private select(op: OperationInfo): void {
    this.rememberTab();
    this.loadRest(op);
    const key = `rest:${this.opId(op)}`;
    const saved = this.tabStates.get(key);
    if (saved) Object.assign(this, saved);
    this.trackTab({ key, title: this.opTitle(op), badge: op.method });
  }

  /** Fields that make up a REST tab: what was typed, and the last response. */
  private static readonly REST_FIELDS = [
    'bodyText', 'bodyMode', 'formRows', 'headerRows', 'pathParams', 'queryParams', 'disabledQuery', 'extraQuery',
    'urlOverride', 'reqAuth', 'reqTab', 'responseText', 'responseStatus', 'responseHeaders', 'responseMs',
    'responseSize', 'lastResponseJson', 'responseMock', 'responseNote', 'responseError', 'resTab', 'resRaw',
    'respSearch', 'jsonToggled', 'jsonShowAll', 'jsonOpenDepth', 'captureName', 'capturePath',
  ] as const;

  /** Only what was typed survives a reload; responses and files stay in memory. */
  private static readonly PERSISTED_FIELDS = new Set([
    'bodyText', 'bodyMode', 'headerRows', 'pathParams', 'queryParams', 'disabledQuery', 'extraQuery', 'urlOverride', 'reqTab',
  ]);

  /** Saves the open REST request into its tab before another view takes over. */
  private rememberTab(): void {
    if (this.view !== 'rest' || !this.selected) return;
    const key = `rest:${this.opId(this.selected)}`;
    if (!this.tabs.some(t => t.key === key)) return;
    const self = this as unknown as Record<string, unknown>;
    const snap: Record<string, unknown> = {};
    for (const field of SpecScribeDocs.REST_FIELDS) snap[field] = self[field];
    this.tabStates.set(key, snap);
    this.persistTabs();
  }

  private trackTab(tab: TabRef): void {
    this.tabs = openTab(this.tabs, tab, tab.key);
    for (const key of [...this.tabStates.keys()]) if (!this.tabs.some(t => t.key === key)) this.tabStates.delete(key);
    this.activeTab = tab.key;
    this.persistTabs();
  }

  private persistTabs(): void {
    try {
      const states: Record<string, Record<string, unknown>> = {};
      for (const [key, snap] of this.tabStates) {
        const kept: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(snap)) {
          if (!SpecScribeDocs.PERSISTED_FIELDS.has(field)) continue;
          kept[field] = value instanceof Set ? { __set: [...value] } : value;
        }
        states[key] = kept;
      }
      localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: this.tabs, states }));
    } catch { /* storage full or disabled: tabs just do not survive a reload */ }
  }

  /** Reopens last session's tabs whose endpoints still exist. */
  private restoreTabs(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(TABS_KEY) || 'null') as { tabs?: TabRef[]; states?: Record<string, Record<string, unknown>> } | null;
      if (!raw || !Array.isArray(raw.tabs)) return;
      this.tabs = raw.tabs.filter(t => t && typeof t.key === 'string' && this.resolveTab(t.key)).slice(0, 12)
        .map(t => ({ key: t.key, title: String(t.title ?? ''), badge: String(t.badge ?? '') }));
      for (const [key, snap] of Object.entries(raw.states ?? {})) {
        if (!this.tabs.some(t => t.key === key) || !snap || typeof snap !== 'object') continue;
        const clean: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(snap)) {
          if (!SpecScribeDocs.PERSISTED_FIELDS.has(field)) continue;
          clean[field] = value && typeof value === 'object' && Array.isArray((value as { __set?: unknown }).__set)
            ? new Set((value as { __set: string[] }).__set) : value;
        }
        this.tabStates.set(key, clean);
      }
    } catch { /* corrupt storage: start without tabs */ }
  }

  /** Opens whatever a tab key points at; false when it no longer exists. */
  private resolveTab(key: string, open = false): boolean {
    if (key.startsWith('rest:')) {
      const op = this.operations().find(o => `rest:${this.opId(o)}` === key);
      if (op && open) this.select(op);
      return !!op;
    }
    if (key.startsWith('ws:')) {
      const [gwName, eventName] = key.slice(3).split('/');
      const gw = this.wsDoc?.gateways?.find(g => g.name === gwName);
      const ev = gw?.events?.find(e => e.event === eventName);
      if (gw && ev && open) this.selectWs(gw, ev);
      return !!ev;
    }
    if (key.startsWith('gql:')) {
      const [rName, opName] = key.slice(4).split('/');
      const r = this.gqlDoc?.resolvers?.find(x => x.name === rName);
      const o = r?.operations.find(x => x.name === opName);
      if (r && o && open) this.selectGql(r, o);
      return !!o;
    }
    if (key.startsWith('scenario:')) {
      const index = Number(key.slice(9));
      if (this.scenarios[index] && open) this.selectScenario(index);
      return !!this.scenarios[index];
    }
    return false;
  }

  private activateTab(key: string): void {
    if (key === this.activeTab) return;
    this.navigate(() => { this.resolveTab(key, true); });
  }

  private closeTabKey(key: string): void {
    this.rememberTab();
    const { tabs, active } = closeTab(this.tabs, key, this.activeTab);
    this.tabs = tabs;
    this.tabStates.delete(key);
    this.persistTabs();
    if (key !== this.activeTab) return;
    this.activeTab = active;
    this.navigate(() => { if (!active || !this.resolveTab(active, true)) this.showOverview(); });
  }

  private loadRest(op: OperationInfo): void {
    this.revealGroup(`rest:${op.tags?.[0] || 'Other'}`);
    this.view = 'rest';
    this.selected = op;
    this.responseText = '';
    this.responseStatus = 0;
    this.responseHeaders = {};
    this.lastResponseJson = null;
    this.reqTab = 'params';
    this.resTab = 'body';
    this.pathParams = {};
    this.queryParams = {};
    this.headerRows = [];
    this.reqAuth = this.reqAuthStore[this.opId(op)] ?? { mode: 'inherit', token: '', header: 'X-API-Key' };
    for (const p of op.parameters ?? []) {
      // Prefer name-aware placeholders so requests run out of the box:
      // {id} → 42, ?email → user@example.com, etc.
      let example = p.schema ? this.example(p.schema) : undefined;
      if (example === undefined || example === 'string') {
        if (/(^|_|-)id$/i.test(p.name) || /Uuid$/i.test(p.name)) example = '1';
        else if (/email/i.test(p.name)) example = 'user@example.com';
        else if (/(user)?name/i.test(p.name)) example = 'demo';
        else if (/page|limit|size|count|num/i.test(p.name)) example = 1;
      }
      const value = example !== undefined ? String(example) : '';
      if (p.in === 'path') this.pathParams = { ...this.pathParams, [p.name]: value };
      if (p.in === 'query') this.queryParams = { ...this.queryParams, [p.name]: value };
    }
    const content = op.requestBody?.content ?? {};
    const jsonKey = Object.keys(content).find(ct => ct.includes('json'));
    const jsonBody = jsonKey ? content[jsonKey] : undefined;
    const example = jsonBody?.example ?? this.example(jsonBody?.schema);
    this.bodyText = example !== undefined ? JSON.stringify(example, null, 2) : '';
    this.bodyExample = this.bodyText;
    this.bodyMode = bodyModeFor(Object.keys(content), op.method);
    const formSchema = content['multipart/form-data']?.schema ?? content['application/x-www-form-urlencoded']?.schema;
    this.formRows = formRowsFromSchema(
      formSchema, s => this.resolveSchema(s), (s, name) => this.example(s, name), this.bodyMode === 'form',
    );
    this.extraQuery = [];
    this.urlOverride = null;
    this.responseMock = false;
    this.responseNote = '';
    this.responseError = '';
    this.respSearch = '';
    this.captureName = '';
    this.capturePath = '';
    // Optional filters start unticked (like Postman): a placeholder value such
    // as `?name=sample` would otherwise filter the first response to nothing.
    this.disabledQuery = new Set((op.parameters ?? []).filter(p => p.in === 'query' && !p.required).map(p => p.name));
    this.resRaw = false;
    this.sidebarOpen = false;
    const hasBody = this.bodyMode === 'json' ? !!this.bodyText : this.bodyMode !== 'none';
    if (!['POST', 'PUT', 'PATCH'].includes(op.method) || !hasBody) return;
    // Open straight on the body for write operations — that's what you edit first.
    if (!(op.parameters ?? []).some(p => p.in === 'path' || p.in === 'query')) this.reqTab = 'body';
  }

  private resolvedPath(op: OperationInfo): string {
    const vars = this.allVars();
    let path = op.path;
    for (const [key, value] of Object.entries(this.pathParams)) {
      path = path.replace(`{${key}}`, encodeURIComponent(fillVars(value, vars)));
    }
    path = fillVars(path, vars);
    const query = [
      ...Object.entries(this.queryParams).filter(([k]) => !this.disabledQuery.has(k)),
      ...this.extraQuery.filter(r => r.enabled && r.key.trim()).map(r => [r.key.trim(), r.value] as [string, string]),
    ]
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(fillVars(v, vars))}`)
      .join('&');
    return query ? `${path}?${query}` : path;
  }

  private specBaseUrl(): string {
    return (this.spec?.servers?.[0]?.url || '').replace(/\/+$/, '');
  }

  private baseUrl(): string {
    return this.activeEnv()?.baseUrl || this.specBaseUrl() || location.origin;
  }

  private viaProxy(url: string): string {
    const proxy = this.spec?.['x-specscribe-proxy'] || '';
    const specBase = this.specBaseUrl();
    const env = this.activeEnv();
    if (!proxy || !specBase || env?.baseUrl || !url.startsWith(specBase)) return url;
    return location.origin + proxy + url.slice(specBase.length);
  }

  private requestUrl(op: OperationInfo): string {
    if (this.urlOverride !== null) return fillVars(this.urlOverride, this.allVars());
    return this.baseUrl().replace(/\/+$/, '') + this.resolvedPath(op);
  }

  /** Path (+ query) of the current request, independent of the base URL. */
  private requestPath(op: OperationInfo): string {
    if (this.urlOverride === null) return this.resolvedPath(op);
    const url = fillVars(this.urlOverride, this.allVars());
    const base = this.baseUrl().replace(/\/+$/, '');
    if (url.startsWith(base)) return url.slice(base.length) || '/';
    try { const u = new URL(url, location.href); return u.pathname + u.search; } catch { return url; }
  }

  private mockPrefix(): string {
    const prefix = this.spec?.['x-specscribe-mock'];
    return typeof prefix === 'string' ? prefix.replace(/\/+$/, '') : '';
  }

  private setMockMode(on: boolean): void {
    this.mockMode = on;
    try { localStorage.setItem(MOCK_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  }

  /** Where the request goes: the real API (maybe via the docs proxy) or the mock server. */
  private requestTarget(op: OperationInfo): { display: string; fetchUrl: string; mock: boolean } {
    if (this.mockMode) {
      const prefix = this.mockPrefix();
      const display = prefix ? location.origin + prefix + this.requestPath(op) : this.requestUrl(op);
      return { display, fetchUrl: prefix ? display : '', mock: true };
    }
    const display = this.requestUrl(op);
    return { display, fetchUrl: this.viaProxy(display), mock: false };
  }

  /**
   * A response generated from the documented success schema — used when the
   * API cannot be reached and no mock server is mounted (e.g. static export).
   */
  private documentedResponse(op: OperationInfo): { status: number; text: string } {
    const responses = op.responses ?? {};
    const code = Object.keys(responses).filter(c => /^2\d\d$/.test(c)).sort()[0] || (op.method === 'POST' ? '201' : '200');
    const content = responses[code]?.content;
    const media = content?.['application/json'] ?? (content ? Object.values(content)[0] : undefined);
    const body = media?.example ?? (media?.schema ? this.example(media.schema) : undefined);
    return { status: Number(code), text: body === undefined ? '' : JSON.stringify(body) };
  }

  private authHeadersFor(url: string, auth: { type: AuthType; token: string; header: string }): Record<string, string> {
    if (auth.type === 'none' || !auth.token.trim()) return {};
    let targetOrigin = '';
    let specOrigin = '';
    const env = this.activeEnv();
    try { targetOrigin = new URL(url, location.href).origin; } catch { return {}; }
    try { specOrigin = this.specBaseUrl() ? new URL(this.specBaseUrl(), location.href).origin : ''; } catch { /* none */ }
    const trusted = targetOrigin === location.origin
      || targetOrigin === specOrigin
      || (env?.allowCredentials === true && targetOrigin === envOrigin(env.baseUrl));
    if (!trusted) return {};
    const token = fillVars(auth.token.trim(), this.allVars());
    if (auth.type === 'bearer') return { Authorization: `Bearer ${token}` };
    if (auth.type === 'apikey') return { [auth.header.trim() || 'X-API-Key']: token };
    return {};

    function envOrigin(base: string): string {
      try { return new URL(base, location.href).origin; } catch { return ''; }
    }
  }

  private effectiveAuth(): { type: AuthType; token: string; header: string } {
    if (this.reqAuth.mode === 'inherit') return this.globalAuth;
    if (this.reqAuth.mode === 'none') return { type: 'none', token: '', header: '' };
    return { type: this.reqAuth.mode, token: this.reqAuth.token, header: this.reqAuth.header };
  }

  private buildHeaders(url: string): Record<string, string> {
    const vars = this.allVars();
    const headers: Record<string, string> = {};
    for (const row of this.headerRows) {
      if (row.key.trim()) headers[row.key.trim()] = fillVars(row.value, vars);
    }
    Object.assign(headers, this.authHeadersFor(url, this.effectiveAuth()));
    const { contentType } = this.currentBody();
    if (contentType && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = contentType;
    }
    return headers;
  }

  private currentBody(): { body?: BodyInit; contentType?: string } {
    const op = this.selected;
    if (!op || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(op.method)) return {};
    const vars = this.allVars();
    return buildBody(this.bodyMode, this.bodyText, this.formRows, v => fillVars(v, vars));
  }

  private applyResponse(status: number, headers: Record<string, string>, text: string): void {
    this.responseStatus = status;
    this.responseHeaders = headers;
    this.responseSize = new Blob([text]).size;
    const parsed = parseSafe(text);
    this.lastResponseJson = parsed ?? null;
    this.responseText = parsed !== undefined ? JSON.stringify(parsed, null, 2) : text;
    this.resetJsonView(parsed);
  }

  /** Fresh viewer state per response; big payloads open only their top levels. */
  private resetJsonView(json: unknown): void {
    this.jsonToggled = new Set();
    this.jsonShowAll = new Set();
    this.jsonOpenDepth = countNodes(json, BIG_JSON_NODES + 1) > BIG_JSON_NODES ? 2 : Infinity;
    this.respSearchCache = null;
    this.respHit = 0;
  }

  /** Arms an AbortController with the configured timeout; `reason()` tells why it fired. */
  private startAbortable(): { signal: AbortSignal; reason: () => 'user' | 'timeout' | null; done: () => void } {
    this.abortCtl?.abort();
    const ctl = new AbortController();
    let why: 'user' | 'timeout' | null = null;
    const timer = this.timeoutSec > 0
      ? setTimeout(() => { why = 'timeout'; ctl.abort(); }, this.timeoutSec * 1000)
      : undefined;
    this.abortCtl = ctl;
    (ctl as AbortController & { cancel?: () => void }).cancel = () => { why = 'user'; ctl.abort(); };
    return {
      signal: ctl.signal,
      reason: () => (ctl.signal.aborted ? why ?? 'user' : null),
      done: () => { clearTimeout(timer); if (this.abortCtl === ctl) this.abortCtl = null; },
    };
  }

  /** Stops the in-flight request (REST, GraphQL or scenario step). */
  private cancelRequest = (): void => {
    const ctl = this.abortCtl as (AbortController & { cancel?: () => void }) | null;
    ctl?.cancel?.();
    this.scenarioCancelled = true;
  };

  private abortMessage(reason: 'user' | 'timeout'): string {
    return reason === 'timeout' ? this.t('timedOut').replace('{s}', String(this.timeoutSec)) : this.t('cancelled');
  }

  private setTimeoutSec(seconds: number): void {
    this.timeoutSec = seconds;
    try { localStorage.setItem(TIMEOUT_KEY, String(seconds)); } catch { /* ignore */ }
  }

  private async send(): Promise<void> {
    const op = this.selected;
    if (!op || this.running) return;
    this.running = true;
    this.responseText = '';
    this.responseHeaders = {};
    this.responseMock = false;
    this.responseNote = '';
    this.responseError = '';
    const target = this.requestTarget(op);
    const headers = this.buildHeaders(target.display);
    const { body } = this.currentBody();
    const started = Date.now();
    const abort = this.startAbortable();
    const headersOf = (res: Response) => {
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => { out[k] = v; });
      return out;
    };
    // The API is unreachable: answer from the mock server, or from the
    // documented schema when none is mounted — always clearly labelled.
    const fallback = async (reason: string) => {
      const prefix = this.mockPrefix();
      this.responseMock = true;
      this.responseNote = reason;
      if (prefix) {
        try {
          const res = await fetch(location.origin + prefix + this.requestPath(op), { method: op.method });
          if (res.status !== 404) {
            this.applyResponse(res.status, headersOf(res), await res.text());
            return;
          }
        } catch { /* fall through to the documented schema */ }
      }
      const doc = this.documentedResponse(op);
      this.applyResponse(doc.status, { 'x-specscribe-mock': 'true' }, doc.text);
    };
    try {
      if (target.mock && !target.fetchUrl) {
        const doc = this.documentedResponse(op);
        this.responseMock = true;
        this.applyResponse(doc.status, { 'x-specscribe-mock': 'true' }, doc.text);
      } else {
        const res = await fetch(target.fetchUrl, { method: op.method, headers, body, signal: abort.signal });
        // The docs proxy answers 502 itself (without x-specscribe-proxied) when the API is down.
        const proxyDown = res.status === 502 && target.fetchUrl !== target.display && !res.headers.has('x-specscribe-proxied');
        if (proxyDown) {
          await fallback(this.t('apiDown'));
        } else {
          this.responseMock = target.mock;
          const text = await res.text();
          this.applyResponse(res.status, headersOf(res), text);
          if (!target.mock) this.autoCaptureToken(text);
        }
      }
    } catch (e) {
      const aborted = abort.reason();
      // A cancelled or timed-out request is not "API down": no mock stand-in.
      if (aborted) {
        this.applyResponse(0, {}, '');
        this.responseError = this.abortMessage(aborted);
      } else if (target.mock) this.applyResponse(0, {}, String(e));
      else await fallback(`${this.t('apiDown')} (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      abort.done();
      this.responseMs = Date.now() - started;
      this.pushHistory(op, this.responseStatus, this.responseMs, this.responseMock);
      this.running = false;
      this.respSeq++;
    }
  }

  private pushHistory(op: OperationInfo, status: number, ms: number, mock = false): void {
    const entry: HistoryEntry = { method: op.method, path: op.path, status, at: Date.now(), ms, mock };
    this.history = [entry, ...this.history].slice(0, MAX_HISTORY);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history)); } catch { /* ignore */ }
  }

  private saveVar(name: string, value: string): void {
    this.vars = { ...this.vars, [name]: value };
    try { localStorage.setItem(VARS_KEY, JSON.stringify(this.vars)); } catch { /* ignore */ }
  }

  private deleteVar(name: string): void {
    const next = { ...this.vars };
    delete next[name];
    this.vars = next;
    try { localStorage.setItem(VARS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  private captureVar(): void {
    const name = this.captureName.trim();
    const path = this.capturePath.trim();
    if (!name || !path || this.lastResponseJson === null) return;
    const value = getAt(this.lastResponseJson, path);
    if (value === undefined) return;
    this.saveVar(name, typeof value === 'string' ? value : JSON.stringify(value));
    this.captureName = '';
    this.capturePath = '';
    this.showToast(this.t('captured'));
  }

  /* ---------------------------- code snippets ---------------------------- */

  private snippetFor(op: OperationInfo): string {
    const url = this.requestTarget(op).display;
    const headers = this.buildHeaders(url);
    const vars = this.allVars();
    const fill = (v: string) => fillVars(v, vars);
    const mode: BodyMode = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(op.method) ? this.bodyMode : 'none';
    const headerJson = JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ');
    if (this.codeLang === 'curl') {
      const parts = [`curl -X ${op.method} '${url}'`];
      for (const [k, v] of Object.entries(headers)) parts.push(`  -H '${k}: ${v}'`);
      parts.push(...curlBodyArgs(mode, this.bodyText, this.formRows, fill).map(a => `  ${a}`));
      return parts.join(' \\\n');
    }
    const axios = this.codeLang === 'axios';
    const { setup, expr } = jsBody(mode, this.bodyText, this.formRows, fill, axios);
    const lines = setup.length ? [...setup, ''] : [];
    if (axios) lines.push('axios({', `  method: '${op.method.toLowerCase()}',`, `  url: '${url}',`);
    else lines.push(`fetch('${url}', {`, `  method: '${op.method}',`);
    if (Object.keys(headers).length) lines.push(`  headers: ${headerJson},`);
    if (expr) lines.push(`  ${axios ? 'data' : 'body'}: ${expr},`);
    lines.push('});');
    return lines.join('\n');
  }

  private shareLink(): void {
    const op = this.selected;
    if (!op) return;
    const state: Record<string, unknown> = {};
    if (this.bodyText.trim()) state.b = this.bodyText;
    if (Object.keys(this.queryParams).length) state.q = this.queryParams;
    if (Object.keys(this.pathParams).length) state.p = this.pathParams;
    const link = `${location.origin}${location.pathname}#${this.opId(op)}!${encodeShare(state)}`;
    void this.copyText(link);
    this.showToast(this.t('shared'));
  }

  private applyHash(): void {
    if (!this.spec) return;
    const hash = location.hash.slice(1);
    if (!hash) return;
    const bang = hash.indexOf('!');
    const key = bang === -1 ? hash : hash.slice(0, bang);
    const shared = bang === -1 ? null : decodeShare(hash.slice(bang + 1));

    if (key.startsWith('scenario-')) {
      const index = Number(key.slice('scenario-'.length));
      if (this.scenarios[index]) this.selectScenario(index);
      return;
    }
    if (key.startsWith('ws-')) {
      const [, gwName, evName] = key.match(/^ws-(.+?)\/(.+)$/) ?? [];
      const gw = this.wsDoc?.gateways?.find(g => g.name === gwName);
      const ev = gw?.events?.find(e => e.event === evName);
      if (gw && ev) this.selectWs(gw, ev);
      return;
    }
    if (key.startsWith('gql-')) {
      const [, rName, opName] = key.match(/^gql-(.+?)\/(.+)$/) ?? [];
      const r = this.gqlDoc?.resolvers?.find(x => x.name === rName);
      const op = r?.operations.find(o => o.name === opName);
      if (r && op) this.selectGql(r, op);
      return;
    }
    const op = this.operations().find(o => this.opId(o) === key);
    if (op) {
      this.select(op);
      if (shared) {
        if (typeof shared.b === 'string' && shared.b.length <= 1000000) this.bodyText = shared.b;
        if (shared.q && typeof shared.q === 'object') this.queryParams = shared.q as Record<string, string>;
        if (shared.p && typeof shared.p === 'object') this.pathParams = shared.p as Record<string, string>;
      }
    }
  }

  private setHash(key: string): void {
    history.replaceState(null, '', `#${key}`);
  }

  /* ---------------------------- WebSocket ---------------------------- */

  private selectWs(gateway: WsGateway, event: WsEvent): void {
    this.rememberTab();
    this.trackTab({ key: `ws:${gateway.name}/${event.event}`, title: event.event, badge: 'WS' });
    // A different gateway may run a different protocol: detect again.
    if (this.wsSelected?.gateway !== gateway && !this.wsConn) {
      this.wsTransport = gateway.transport === 'ws' ? 'ws' : gateway.transport === 'socket.io' ? 'socketio' : 'auto';
    }
    this.revealGroup(`ws:${gateway.name}`);
    this.view = 'ws';
    this.wsSelected = { gateway, event };
    this.wsEventName = event.event;
    this.wsUrl = this.baseUrl().replace(/\/+$/, '') + (gateway.namespace ? `/${gateway.namespace.replace(/^\/+/, '')}` : '');
    this.wsPayloadText = JSON.stringify(this.example(event.payload) ?? {}, null, 2);
    this.wsLog = [];
    this.setHash(`ws-${gateway.name}/${event.event}`);
  }

  private wsAppend(dir: LogEntry['dir'], label: string, value: unknown): void {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    this.wsLog = [...this.wsLog, { dir, label, text, at: Date.now() }];
  }

  private wsSetStatus(s: typeof this.wsStatus): void { this.wsStatus = s; }

  private wsStatusText(): string {
    if (this.wsStatus === 'connected' && this.wsConn?.kind === 'mock') return 'mock';
    return this.wsStatus;
  }

  protected updated(): void {
    this.syncResponseSearch();
    // Keep the live traffic log pinned to the newest entry.
    const log = this.querySelector('.log');
    if (log && this.view === 'ws') log.scrollTop = log.scrollHeight;
    this.classList.toggle('side-hidden', this.sideHidden);
    // Reveal the active endpoint in the sidebar when navigation came from
    // elsewhere (palette, deep link, overview cards, history).
    const active = this.querySelector('aside .nav-item.active') as HTMLElement | null;
    const key = active?.textContent?.trim() ?? '';
    if (active && key !== this.lastActiveNav) {
      this.lastActiveNav = key;
      active.scrollIntoView({ block: 'nearest' });
    }
    if (this.paletteOpen) {
      const input = this.querySelector('.palette input') as HTMLInputElement | null;
      if (input && document.activeElement !== input) input.focus();
      this.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' });
    }
  }

  private wsDisconnect(): void {
    if (!this.wsConn) return;
    try {
      const conn = this.wsConn;
      if (conn.kind === 'socketio' && conn.socket) (conn.socket as { disconnect: () => void }).disconnect();
      else if (conn.kind === 'ws' && conn.socket) (conn.socket as WebSocket).close();
    } catch { /* already closed */ }
    this.wsConn = null;
    this.wsSetStatus('disconnected');
  }

  private loadSocketIo(backendUrl: string, callback: (io: unknown) => void): void {
    if (window.io) { callback(window.io); return; }
    let origin = location.origin;
    try { origin = new URL(backendUrl, location.href).origin; } catch { callback(null); return; }
    let specOrigin = '';
    try { specOrigin = this.specBaseUrl() ? new URL(this.specBaseUrl(), location.href).origin : ''; } catch { /* none */ }
    const env = this.activeEnv();
    let envOrigin = '';
    try { envOrigin = env?.baseUrl ? new URL(env.baseUrl, location.href).origin : ''; } catch { /* none */ }
    const allowed = origin === location.origin
      || origin === specOrigin
      || (env?.allowCredentials === true && origin === envOrigin);
    if (!allowed) { callback(null); return; }
    const script = document.createElement('script');
    script.src = origin + '/socket.io/socket.io.js';
    script.onload = () => callback(window.io || null);
    script.onerror = () => callback(null);
    document.head.appendChild(script);
  }

  private wsToggle(): void {
    if (this.wsConn) { this.wsDisconnect(); return; }
    this.wsConnect();
  }

  /**
   * Connects with protocol auto-detection. Gateways may speak Socket.IO
   * (Nest's default adapter, socket.io servers) or plain WebSocket (Nest
   * WsAdapter, `ws`), and the spec does not say which — so:
   *   auto / Socket.IO → try Socket.IO, then raw WebSocket, then mock;
   *   Raw WebSocket    → try raw, and if that fails but the server serves
   *                      the Socket.IO client, switch to Socket.IO for you.
   */
  private wsConnect(): void {
    this.wsSetStatus('connecting…');
    const mock = () => this.wsConnectMock();
    if (this.wsTransport === 'ws') {
      this.wsConnectRaw(false, () => this.loadSocketIo(this.wsUrl, (io) => {
        if (!io) { mock(); return; }
        this.wsTransport = 'socketio';
        this.wsAppend('sys', 'auto-detected', 'This gateway speaks Socket.IO, not raw WebSocket — switched transport automatically.');
        this.wsStartSocketIo(io);
      }));
      return;
    }
    const auto = this.wsTransport === 'auto';
    this.loadSocketIo(this.wsUrl, (io) => {
      if (!io) { this.wsConnectRaw(true, mock); return; }
      // In auto mode a failed Socket.IO handshake means "try raw WebSocket".
      this.wsStartSocketIo(io, auto ? () => this.wsConnectRaw(true, mock) : undefined);
    });
  }

  private wsConnectMock(): void {
    let origin = this.wsUrl;
    try { origin = new URL(this.wsUrl, location.href).origin; } catch { /* keep */ }
    this.wsConn = { kind: 'mock', socket: null };
    this.wsAppend('sys', 'mock',
      `Could not reach a WebSocket or Socket.IO server at ${origin} — the API is not running there, or it blocks cross-origin requests. Events you send will be answered from the documented response schema (MOCK).`);
    this.wsSetStatus('connected');
    this.wsFlushPending();
  }

  /** Opens a raw WebSocket; `onFail` runs if it never manages to open. */
  private wsConnectRaw(detected: boolean, onFail: () => void): void {
    const wsUrl = this.wsUrl.replace(/^http/, 'ws');
    let socket: WebSocket;
    try { socket = new WebSocket(wsUrl); } catch { onFail(); return; }
    let opened = false;
    let failed = false;
    const fail = () => {
      if (opened || failed) return;
      failed = true;
      clearTimeout(timer);
      socket.onclose = socket.onerror = null;
      try { socket.close(); } catch { /* not open */ }
      if (this.wsConn?.socket === socket) this.wsConn = null;
      onFail();
    };
    const timer = setTimeout(fail, 4000);
    this.wsConn = { kind: 'ws', socket };
    socket.onopen = () => {
      opened = true;
      clearTimeout(timer);
      if (detected) this.wsTransport = 'ws';
      this.wsSetStatus('connected');
      this.wsAppend('sys', detected ? 'auto-detected' : 'connected',
        detected ? `Plain WebSocket server at ${wsUrl}` : wsUrl);
      this.wsFlushPending();
    };
    socket.onerror = () => {
      if (!opened) { fail(); return; }
      this.wsSetStatus('error');
      this.wsAppend('sys', 'error', 'The WebSocket connection reported an error.');
    };
    socket.onclose = () => {
      if (!opened) { fail(); return; }
      if (this.wsConn?.socket === socket) this.wsConn = null;
      this.wsSetStatus('disconnected');
      this.wsAppend('sys', 'disconnected', wsUrl);
    };
    socket.onmessage = (event) => {
      let data: unknown = event.data;
      try { data = JSON.parse(String(event.data)); } catch { /* keep raw */ }
      const label = (data as { event?: string })?.event || 'message';
      this.wsAppend('in', label, data);
    };
  }

  private wsStartSocketIo(io: unknown, onHandshakeFail?: () => void): void {
    const url = this.wsUrl;
    let everConnected = false;
    {
      const ioClient = io as (url: string, opts: Record<string, unknown>) => {
        on: (ev: string, cb: (...args: unknown[]) => void) => void;
        onAny?: (cb: (name: string, ...args: unknown[]) => void) => void;
        emit: (ev: string, d: unknown, ack?: (a: unknown) => void) => void;
        disconnect: () => void;
        id?: string;
      };
      const socket = ioClient(url, { transports: ['websocket', 'polling'] });
      this.wsConn = { kind: 'socketio', socket };
      socket.on('connect', () => {
        everConnected = true;
        if (this.wsTransport === 'auto') this.wsTransport = 'socketio';
        this.wsSetStatus('connected');
        this.wsAppend('sys', 'connected', `Socket.IO · id: ${socket.id}`);
        this.wsFlushPending();
      });
      socket.on('disconnect', (reason: unknown) => {
        this.wsSetStatus('disconnected');
        this.wsAppend('sys', 'disconnected', String(reason));
      });
      socket.on('connect_error', (err: unknown) => {
        const message = String((err as Error)?.message ?? err);
        if (!everConnected && onHandshakeFail) {
          // Not a Socket.IO endpoint after all — stop retrying and fall back.
          const fallback = onHandshakeFail;
          onHandshakeFail = undefined;
          socket.disconnect();
          if (this.wsConn?.socket === socket) this.wsConn = null;
          fallback();
          return;
        }
        this.wsSetStatus('error');
        this.wsAppend('sys', 'connect_error', /namespace/i.test(message)
          ? `${message} — check the gateway namespace in the URL (e.g. …/orders).`
          : message);
      });
      if (socket.onAny) {
        socket.onAny((name: string, ...args: unknown[]) => {
          this.wsAppend('in', name, args.length === 1 ? args[0] : args);
        });
      }
    }
  }

  private wsFlushPending(): void {
    if (!this.wsPendingSend) return;
    this.wsPendingSend = false;
    this.wsSend();
  }

  private wsSend(): void {
    const conn = this.wsConn;
    if (!conn || this.wsStatus !== 'connected') {
      // Cold send: connect first, send once the socket opens.
      this.wsPendingSend = true;
      this.wsAppend('sys', 'auto-connect', 'Not connected — connecting first, your event will be sent when the socket opens.');
      if (!conn) this.wsConnect();
      return;
    }
    const name = this.wsEventName.trim();
    if (!name) {
      this.wsAppend('sys', 'no event name', 'Type the event name to send — e.g. chat.send');
      return;
    }
    const text = fillVars(this.wsPayloadText, this.allVars()).trim();
    const data = text ? parseSafe(text) ?? text : null;

    if (conn.kind === 'mock') {
      this.wsAppend('out', name, data);
      const generated = this.wsSelected?.event.response
        ? this.example(this.wsSelected.event.response) : { received: name };
      setTimeout(() => {
        this.wsAppend('in', `${name} · ack · MOCK`, generated);
      }, 250);
      return;
    }
    if (conn.kind === 'socketio' && conn.socket) {
      (conn.socket as { emit: (e: string, d: unknown, ack: (a: unknown) => void) => void })
        .emit(name, data, (ack: unknown) => this.wsAppend('in', `${name} · ack`, ack));
    } else if (conn.socket) {
      // Endpoints that switch on a field (`{ type: 'ping', … }`) get the payload as-is.
      const raw = this.wsSelected?.gateway.frame === 'raw';
      (conn.socket as WebSocket).send(JSON.stringify(raw ? data : { event: name, data }));
    }
    this.wsAppend('out', name, data);
  }

  /* ---------------------------- GraphQL ---------------------------- */

  private gqlUrl(): string {
    return this.baseUrl().replace(/\/+$/, '') + '/graphql';
  }

  private selectGql(resolver: GqlResolver, operation: GqlOperation): void {
    this.rememberTab();
    this.trackTab({ key: `gql:${resolver.name}/${operation.name}`, title: operation.name, badge: operation.kind.toUpperCase() });
    this.revealGroup(`gql:${resolver.name}`);
    this.captureName = '';
    this.capturePath = '';
    this.view = 'gql';
    this.gqlSelected = { resolver, operation };
    this.gqlQueryText = operation.sample || '';
    this.gqlResponseText = '';
    this.gqlResponseMeta = '';
    const varsExample: Record<string, unknown> = {};
    for (const arg of operation.args ?? []) {
      varsExample[arg.name] = this.example(arg.schema) ?? null;
    }
    this.gqlVarsText = Object.keys(varsExample).length ? JSON.stringify(varsExample, null, 2) : '';
    this.setHash(`gql-${resolver.name}/${operation.name}`);
  }

  private async runGql(): Promise<void> {
    const sel = this.gqlSelected;
    if (!sel) return;
    const vars = this.allVars();
    const query = fillVars(this.gqlQueryText, vars);
    const varsText = fillVars(this.gqlVarsText, vars).trim();
    let variables: Record<string, unknown> | null = null;
    if (varsText) {
      const parsed = parseSafe(varsText);
      if (parsed === undefined) { this.gqlResponseText = 'Variables is not valid JSON'; return; }
      variables = parsed as Record<string, unknown>;
    }
    if (sel.operation.kind === 'subscription') {
      this.runGqlSubscription(query, variables);
      return;
    }
    if (this.gqlRunning) return;
    this.gqlRunning = true;
    this.gqlResponseText = '';
    const started = Date.now();
    const abort = this.startAbortable();
    try {
      const res = await fetch(this.viaProxy(this.gqlUrl()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeadersFor(this.gqlUrl(), this.globalAuth) },
        body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
        signal: abort.signal,
      });
      if (res.status === 502 && !res.headers.has('x-specscribe-proxied') && this.viaProxy(this.gqlUrl()) !== this.gqlUrl()) {
        throw new Error(this.t('apiDown'));
      }
      const text = await res.text();
      this.gqlResponseMeta = `${res.status} · ${Date.now() - started} ms`;
      const parsed = parseSafe(text);
      if (parsed !== undefined) {
        this.lastResponseJson = parsed;
        this.gqlResponseText = JSON.stringify(parsed, null, 2);
        this.autoCaptureToken(text);
      } else {
        this.gqlResponseText = text;
      }
    } catch (e) {
      const aborted = abort.reason();
      if (aborted) {
        this.gqlResponseMeta = this.abortMessage(aborted);
        this.gqlResponseText = '';
      } else {
        const data = { [sel.operation.name]: this.example(sel.operation.response) ?? null };
        this.gqlResponseMeta = `MOCK · ${this.t('apiDown')}`;
        this.gqlResponseText = JSON.stringify({ data }, null, 2);
        this.lastResponseJson = { data };
      }
      void e;
    } finally {
      abort.done();
      this.gqlRunning = false;
    }
  }

  private runGqlSubscription(query: string, variables: Record<string, unknown> | null): void {
    if (this.gqlWs) { this.gqlWs.close(); this.gqlWs = null; return; }
    const wsUrl = this.gqlUrl().replace(/^http/, 'ws');
    this.gqlResponseText = '';
    this.gqlResponseMeta = 'connecting…';
    const ws = new WebSocket(wsUrl, 'graphql-ws');
    const id = `sub-${Date.now()}`;
    const lines: string[] = [];
    const push = (line: string) => {
      lines.push(line);
      this.gqlResponseText = lines.join('\n');
    };
    ws.onopen = () => {
      this.gqlResponseMeta = 'connected';
      ws.send(JSON.stringify({ type: 'connection_init', payload: {} }));
      ws.send(JSON.stringify({ id, type: 'subscribe', payload: { query, variables: variables ?? {} } }));
    };
    ws.onmessage = (event) => {
      push(typeof event.data === 'string' ? event.data : '[binary]');
      if (typeof event.data === 'string' && event.data.includes('"complete"')) {
        this.gqlWs?.close();
        this.gqlWs = null;
        this.gqlResponseMeta = 'completed';
      }
    };
    ws.onerror = () => { this.gqlResponseMeta = 'error'; };
    ws.onclose = () => {
      if (this.gqlWs) { this.gqlWs = null; this.gqlResponseMeta = 'closed'; }
    };
    this.gqlWs = ws;
  }

  /* ---------------------------- export ---------------------------- */

  private exportPostman(): void {
    if (!this.spec) return;
    const base = this.baseUrl().replace(/\/+$/, '');
    const groups = new Map<string, { name: string; item: unknown[] }>();
    for (const op of this.operations()) {
      const tag = op.tags?.[0] || 'Other';
      if (!groups.has(tag)) groups.set(tag, { name: tag, item: [] });
      const path = op.path.replace(/\{([^}]+)\}/g, ':$1');
      const content = op.requestBody?.content ?? {};
      const jsonKey = Object.keys(content).find(ct => ct.includes('json'));
      const example = jsonKey ? content[jsonKey].example ?? this.example(content[jsonKey].schema) : undefined;
      const form = content['multipart/form-data']?.schema;
      const header = Object.entries(this.authHeadersFor(base + op.path, this.globalAuth)).map(([key, value]) => ({ key, value }));
      if (example !== undefined) header.push({ key: 'Content-Type', value: 'application/json' });
      groups.get(tag)!.item.push({
        name: this.opTitle(op),
        request: {
          method: op.method,
          header,
          url: {
            raw: base + path,
            host: [base],
            path: path.split('/').filter(Boolean),
            variable: (op.parameters ?? []).filter(p => p.in === 'path').map(p => ({ key: p.name, value: '' })),
          },
          ...(example !== undefined ? { body: { mode: 'raw', raw: JSON.stringify(example, null, 2) } }
            : form ? { body: { mode: 'formdata', formdata: formRowsFromSchema(form, s => this.resolveSchema(s), (s, n) => this.example(s, n), true)
              .map(r => r.kind === 'file' ? { key: r.key, type: 'file', src: '' } : { key: r.key, value: r.value, type: 'text' }) } }
            : {}),
        },
      });
    }
    const collection = {
      info: {
        name: this.spec.info?.title || 'API',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [...groups.values()],
    };
    this.download('collection.json', JSON.stringify(collection, null, 2), 'application/json');
  }

  private download(name: string, text: string, type = 'application/octet-stream'): void {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  }

  /* ---------------------------- scenarios ---------------------------- */

  private selectScenario(index: number): void {
    if (this.scenarioRunning) return;
    this.rememberTab();
    this.trackTab({ key: `scenario:${index}`, title: this.scenarios[index]?.name ?? 'Scenario', badge: 'FLOW' });
    this.view = 'scenario';
    this.scenarioIndex = index;
    this.scenarioRuns = (this.scenarios[index]?.steps ?? []).map(() => ({ state: 'pending', failures: [] }));
    this.scenarioVars = {};
    this.scenarioOpen = new Set();
    this.scenarioDraft = null;
    this.scenarioMs = 0;
    this.sidebarOpen = false;
    this.setHash(`scenario-${index}`);
  }

  /** Documented response schema for a concrete path, used by `matchesSpec`. */
  private responseSchemaFor(method: string, concretePath: string, status: number): SchemaLike | undefined {
    const pathname = concretePath.split('?')[0];
    for (const [template, methods] of Object.entries(this.spec?.paths ?? {})) {
      const pattern = template.split(/(\{[^}]+\})/g)
        .map(part => /^\{[^}]+\}$/.test(part) ? '[^/]+' : part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
        .join('');
      if (!new RegExp(`^${pattern}/?$`).test(pathname)) continue;
      const op = methods[method.toLowerCase()];
      const response = op?.responses?.[String(status)] ?? op?.responses?.default;
      return response?.content?.['application/json']?.schema;
    }
    return undefined;
  }

  private async runCurrentScenario(): Promise<void> {
    const scenario = this.scenarios[this.scenarioIndex];
    if (!scenario || this.scenarioRunning) return;
    this.scenarioRunning = true;
    this.scenarioCancelled = false;
    this.scenarioRuns = scenario.steps.map(() => ({ state: 'pending', failures: [] }));
    this.scenarioOpen = new Set();
    const started = performance.now();
    const prefix = this.mockPrefix();
    const vars = await runScenario(scenario, this.allVars(), {
      send: async (method, path, headers, body) => {
        const mock = this.mockMode && !!prefix;
        const display = mock ? location.origin + prefix + path : this.baseUrl().replace(/\/+$/, '') + path;
        if (!Object.keys(headers).some(k => k.toLowerCase() === 'authorization')) {
          Object.assign(headers, this.authHeadersFor(display, this.globalAuth));
        }
        const abort = this.startAbortable();
        try {
          const res = await fetch(mock ? display : this.viaProxy(display), { method, headers, body, signal: abort.signal });
          if (res.status === 502 && !mock && !res.headers.has('x-specscribe-proxied') && this.viaProxy(display) !== display) {
            throw new Error(this.t('apiDown'));
          }
          return { status: res.status, text: await res.text(), url: display };
        } catch (e) {
          const aborted = abort.reason();
          throw aborted ? new Error(this.abortMessage(aborted)) : e;
        } finally {
          abort.done();
        }
      },
      cancelled: () => this.scenarioCancelled,
      responseSchema: (method, path, status) => this.responseSchemaFor(method, path, status),
      resolve: (schema) => this.resolveSchema(schema as SchemaLike),
      onStep: (index, run) => {
        const next = [...this.scenarioRuns];
        next[index] = run;
        this.scenarioRuns = next;
        // Failed steps open by themselves so the reason is visible at once.
        if (run.state === 'fail') this.scenarioOpen = new Set([...this.scenarioOpen, index]);
      },
    }, this.scenarioStopOnFail);
    const initial = this.allVars();
    this.scenarioVars = Object.fromEntries(Object.entries(vars).filter(([k, v]) => initial[k] !== v));
    this.scenarioMs = Math.round(performance.now() - started);
    this.scenarioRunning = false;
    const failed = this.scenarioRuns.filter(r => r.state === 'fail').length;
    this.showToast(failed ? `${failed} ${this.t('stepsFailed')}` : this.t('allPassed'));
  }

  private saveLocalScenarios(): void {
    const local = this.scenarios.filter(s => s.source === 'imported');
    try { localStorage.setItem(SCENARIOS_KEY, JSON.stringify(local)); } catch { /* ignore */ }
  }

  private importScenarios(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.multiple = true;
    input.onchange = async () => {
      const added: Scenario[] = [];
      for (const file of Array.from(input.files ?? [])) {
        try {
          added.push(...parseScenarios(await file.text()).map(sc => ({ ...sc, source: 'imported' as const })));
        } catch (e) {
          this.showToast(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!added.length) return;
      this.scenarios = [...added, ...this.scenarios];
      this.saveLocalScenarios();
      this.navigate(() => this.selectScenario(0));
      this.showToast(`${added.length} ${this.t('scenariosImported')}`);
    };
    input.click();
  }

  private saveScenarioDraft(): void {
    if (this.scenarioDraft === null) return;
    try {
      const [edited] = parseScenarios(this.scenarioDraft);
      const next = [...this.scenarios];
      next[this.scenarioIndex] = { ...edited, source: 'imported' };
      this.scenarios = next;
      this.saveLocalScenarios();
      this.selectScenario(this.scenarioIndex);
      this.showToast(this.t('saved'));
    } catch (e) {
      this.showToast(e instanceof Error ? e.message : String(e));
    }
  }

  private deleteScenario(): void {
    const scenario = this.scenarios[this.scenarioIndex];
    if (!scenario || scenario.source !== 'imported') return;
    this.scenarios = this.scenarios.filter((_, i) => i !== this.scenarioIndex);
    this.saveLocalScenarios();
    this.navigate(() => this.showOverview());
  }

  private downloadResponse(): void {
    this.download(`response-${this.responseStatus || 'err'}.${this.lastResponseJson !== null ? 'json' : 'txt'}`, this.responseText);
  }

  /* ---------------------------- shared ---------------------------- */

  private toggleTheme(): void {
    this.themeName = this.themeName === 'classic' ? 'futuristic' : 'classic';
    this.classList.remove('classic', 'futuristic');
    this.classList.add(this.themeName);
  }

  private toggleLanguage(): void {
    this.uiLang = this.uiLang === 'en' ? 'ar' : 'en';
    this.dir = this.uiLang === 'ar' ? 'rtl' : 'ltr';
  }

  private methodPill(method: string, size = '') {
    const m = method.toLowerCase();
    const cls = KNOWN_METHODS.has(m) || ['ws', 'query', 'mutation', 'subscription'].includes(m) ? m : 'other';
    const label = m === 'delete' && size !== 'lg' ? 'DEL' : m === 'subscription' ? 'SUB'
      : m === 'mutation' ? (size === 'lg' ? 'MUTATION' : 'MUT') : method.toUpperCase();
    return html`<span class="m m-${cls} ${size}">${label}</span>`;
  }

  private opTitle(op: OperationInfo): string {
    // JSDoc sentences end with a period; a title reads better without it.
    const summary = op.summary?.trim().replace(/(?<!\.)\.$/, '');
    if (summary && summary.toUpperCase() !== `${op.method} ${op.path}`.toUpperCase()) return summary;
    return op.path;
  }

  private renderPath(path: string) {
    // <bdi dir=ltr> keeps URL paths readable inside the RTL (Arabic) layout.
    return html`<bdi dir="ltr">${path.split(/(\{[^}]+\})/g).map(part =>
      /^\{[^}]+\}$/.test(part) ? html`<span class="pp">${part}</span>` : part)}</bdi>`;
  }

  private showOverview(): void {
    this.rememberTab();
    this.activeTab = '';
    this.view = 'overview';
    this.setHash('');
  }

  /* ---------------------------- render ---------------------------- */

  private renderTabBar() {
    if (!this.tabs.length) return nothing;
    const pill = (badge: string) => {
      const kind = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(badge) ? badge.toLowerCase()
        : badge === 'WS' ? 'ws' : badge === 'FLOW' ? 'flow' : badge.toLowerCase();
      return html`<span class="m m-${kind}">${badge === 'DELETE' ? 'DEL' : badge === 'SUBSCRIPTION' ? 'SUB' : badge === 'MUTATION' ? 'MUT' : badge}</span>`;
    };
    return html`
      <nav class="tab-strip" aria-label=${this.t('openRequests')}>
        ${this.tabs.map(tab => html`
          <div class="wtab ${tab.key === this.activeTab ? 'on' : ''}"
            @auxclick=${(e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); this.closeTabKey(tab.key); } }}>
            <button class="wtab-main" aria-current=${tab.key === this.activeTab ? 'page' : nothing} title=${tab.title}
              @click=${() => this.activateTab(tab.key)}>${pill(tab.badge)}<span class="wtab-title" dir="auto">${tab.title}</span></button>
            <button class="wtab-close" aria-label="${this.t('closeTab')} ${tab.title}" title=${this.t('closeTab')}
              @click=${() => this.closeTabKey(tab.key)}>${icon('x')}</button>
          </div>`)}
        ${this.tabs.length > 1 ? html`<button class="wtab-closeall" title=${this.t('closeAllTabs')} aria-label=${this.t('closeAllTabs')}
          @click=${() => { this.tabs = []; this.tabStates.clear(); this.persistTabs(); this.activeTab = ''; this.navigate(() => this.showOverview()); }}>${icon('x')}${this.t('closeAllTabs')}</button>` : nothing}
      </nav>`;
  }

  private renderTopbar() {
    const info = this.spec?.info || {};
    const hasAuth = this.globalAuth.type !== 'none' && !!this.globalAuth.token;
    const env = this.activeEnv();
    return html`
      <header class="topbar">
        <button class="tb-icon menu-btn" title="${this.t('toggleSidebar')} (Ctrl+\\)" aria-label=${this.t('toggleSidebar')}
          @click=${() => this.toggleSidebar()}>${icon(this.isNarrow() ? 'menu' : 'sidebar')}</button>
        <button class="brand" @click=${this.goOverview} title=${this.t('overview')}>
          <span class="logo">${icon('logo')}</span>
          <span class="brand-name">Spec<b>Scribe</b></span>
        </button>
        <span class="divider"></span>
        <div class="api-title">
          <span class="api-name">${info.title || 'API Documentation'}</span>
          ${info.version ? html`<span class="ver">v${info.version.replace(/^v/i, '')}</span>` : nothing}
        </div>
        <span class="spacer"></span>
        <button class="cmdk" @click=${() => this.openPalette()} title=${this.t('searchEverything')}>
          ${icon('search')}<span class="cmdk-text">${this.t('searchShort')}…</span><kbd>Ctrl K</kbd>
        </button>
        <span class="spacer"></span>
        <div class="tb-group">
          <label class="env-switch" title=${this.t('envSelect')}>
            <span class="env-dot ${env ? 'on' : ''}"></span>
            <select aria-label=${this.t('envSelect')} .value=${this.envActive}
              @change=${(e: Event) => this.setActiveEnv((e.target as HTMLSelectElement).value)}>
              <option value="" ?selected=${!this.envActive}>${this.t('noEnv')}</option>
              ${this.envs.map(item => html`
                <option value=${item.name} ?selected=${item.name === this.envActive}>${item.name}</option>`)}
            </select>
          </label>
          <button class="tb-btn pop-trigger ${this.envOpen ? 'active' : ''}" title=${this.t('envTitle')}
            @click=${() => { this.envOpen = !this.envOpen; this.authOpen = false; }}>
            ${icon('globe')}<span>${this.t('envShort')}</span>
          </button>
          <button class="tb-btn pop-trigger ${hasAuth ? 'has-auth' : ''} ${this.authOpen ? 'active' : ''}"
            title=${this.t('authTitle')}
            @click=${() => { this.authOpen = !this.authOpen; this.envOpen = false; }}>
            ${icon(hasAuth ? 'shield' : 'key')}<span>${hasAuth ? this.t('authorized') : this.t('auth')}</span>
          </button>
        </div>
        <div class="tb-group tb-secondary">
          <button class="tb-icon" title=${this.t('exportPostman')} @click=${this.exportPostman}>${icon('download')}</button>
          <a class="tb-icon" title=${this.t('openSpec')} href=${this.specUrl} target="_blank" rel="noopener">${icon('braces')}</a>
          <button class="tb-icon" title=${this.t('toggleLang')} @click=${this.toggleLanguage}>
            <span class="lang-glyph">${this.uiLang === 'en' ? 'ع' : 'EN'}</span>
          </button>
          <button class="tb-icon theme-btn" title=${this.t('toggleTheme')} @click=${this.toggleTheme}>
            ${icon(this.themeName === 'classic' ? 'moon' : 'sun')}
          </button>
        </div>
        <button class="tb-icon tb-more pop-trigger ${this.moreOpen ? 'active' : ''}" title=${this.t('more')}
          @click=${() => { this.moreOpen = !this.moreOpen; this.authOpen = this.envOpen = false; }}>${icon('more')}</button>
      </header>
      ${this.authOpen ? this.renderAuthPop() : nothing}
      ${this.envOpen ? this.renderEnvPop() : nothing}
      ${this.moreOpen ? this.renderMoreMenu() : nothing}
    `;
  }

  /** Overflow menu for narrow screens: the top bar's secondary actions. */
  private renderMoreMenu() {
    const item = (iconName: string, label: string, run: () => void) => html`
      <button class="menu-item" @click=${() => { this.moreOpen = false; run(); }}>${icon(iconName)}<span>${label}</span></button>`;
    return html`
      <div class="pop menu" role="menu">
        ${item('search', this.t('searchShort'), () => this.openPalette())}
        ${item('globe', this.t('envTitle'), () => { this.envOpen = true; })}
        ${item('key', this.t('authTitle'), () => { this.authOpen = true; })}
        <div class="menu-sep"></div>
        ${item('download', this.t('exportPostman'), () => this.exportPostman())}
        ${item('braces', this.t('openSpec'), () => window.open(this.specUrl, '_blank', 'noopener'))}
        ${item('globe', this.t('toggleLang'), () => this.toggleLanguage())}
        ${item(this.themeName === 'classic' ? 'moon' : 'sun', this.t('toggleTheme'), () => this.toggleTheme())}
      </div>
    `;
  }

  private renderPalette() {
    const items = this.paletteItems();
    const idx = Math.min(this.paletteIndex, Math.max(0, items.length - 1));
    let lastGroup = '';
    return html`
      <div class="palette-scrim" @click=${() => this.closePalette()}>
        <div class="palette" role="dialog" aria-label=${this.t('searchEverything')} @click=${(e: Event) => e.stopPropagation()}>
          <div class="palette-input">
            ${icon('search')}
            <input .value=${this.paletteQuery} placeholder=${this.t('searchEverything')} spellcheck="false"
              @input=${(e: Event) => { this.paletteQuery = (e.target as HTMLInputElement).value; this.paletteIndex = 0; }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); this.paletteIndex = (idx + 1) % Math.max(1, items.length); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); this.paletteIndex = (idx - 1 + items.length) % Math.max(1, items.length); }
                else if (e.key === 'Enter') { e.preventDefault(); this.runPaletteItem(items[idx]); }
                else if (e.key === 'Escape') { e.preventDefault(); this.closePalette(); }
              }} />
            <kbd>Esc</kbd>
          </div>
          <div class="palette-list">
            ${items.length === 0 ? html`<div class="empty-state">${icon('search')}<b>${this.t('noMatches')}</b></div>` : nothing}
            ${items.map((it, i) => {
              const header = it.group !== lastGroup ? html`<div class="pal-group">${it.group}</div>` : nothing;
              lastGroup = it.group;
              return html`${header}
                <button class="pal-item ${i === idx ? 'on' : ''}" @mousemove=${() => { if (this.paletteIndex !== i) this.paletteIndex = i; }}
                  @click=${() => this.runPaletteItem(it)}>
                  ${it.pill}
                  <span class="pal-text"><span class="pal-title" dir="auto">${it.title}</span>
                    ${it.sub ? html`<span class="pal-sub"><bdi dir="auto">${it.sub}</bdi></span>` : nothing}</span>
                  ${i === idx ? icon('enter', 'pal-enter') : nothing}
                </button>`;
            })}
          </div>
          <div class="palette-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> ${this.t('navigate')}</span>
            <span><kbd>↵</kbd> ${this.t('open')}</span>
            <span><kbd>Esc</kbd> ${this.t('close')}</span>
          </div>
        </div>
      </div>
    `;
  }

  private popHead(title: string, subtitle: string, onClose: () => void) {
    return html`
      <div class="pop-head">
        <div><b>${title}</b>${subtitle ? html`<div class="dim small">${subtitle}</div>` : nothing}</div>
        <span class="spacer"></span>
        <button class="btn ghost sm icon-only" title=${this.t('close')} @click=${onClose}>${icon('x')}</button>
      </div>
    `;
  }

  private renderAuthPop() {
    const auth = this.globalAuth;
    const set = (patch: Partial<GlobalAuth>) => this.setGlobalAuth({ ...auth, ...patch });
    const options: { id: AuthType; label: string; desc: string }[] = [
      { id: 'none', label: this.t('authNone'), desc: this.t('authNoneDesc') },
      { id: 'bearer', label: this.t('authBearer'), desc: this.t('authBearerDesc') },
      { id: 'apikey', label: this.t('authApiKey'), desc: this.t('authApiKeyDesc') },
    ];
    return html`
      <div class="pop" role="dialog" aria-label=${this.t('authTitle')}>
        ${this.popHead(this.t('authTitle'), this.t('globalAuth'), () => { this.authOpen = false; })}
        <div class="pop-body">
          <div class="opt-list">
            ${options.map(o => html`
              <button class="auth-opt ${auth.type === o.id ? 'on' : ''}" @click=${() => set({ type: o.id })}>
                <span class="radio"></span>
                <span><b>${o.label}</b><small>${o.desc}</small></span>
              </button>`)}
          </div>
          ${auth.type === 'apikey' ? html`
            <label class="field"><span>${this.t('header')}</span>
              <input .value=${auth.header} placeholder="X-API-Key" spellcheck="false"
                @input=${(e: Event) => set({ header: (e.target as HTMLInputElement).value })} />
            </label>` : nothing}
          ${auth.type !== 'none' ? html`
            <label class="field"><span>${auth.type === 'bearer' ? 'Token' : this.t('value')}</span>
              <input class="mono" .value=${auth.token} placeholder="eyJhbGciOi…" spellcheck="false"
                @input=${(e: Event) => set({ token: (e.target as HTMLInputElement).value })} />
            </label>` : nothing}
          <div class="note">${icon('info')}<span>${this.t('authNote')}</span></div>
        </div>
      </div>
    `;
  }

  private renderEnvPop() {
    return html`
      <div class="pop wide" role="dialog" aria-label=${this.t('envTitle')}>
        ${this.popHead(this.t('envTitle'), this.t('envSubtitle'), () => { this.envOpen = false; })}
        <div class="pop-body">
          <div class="env-chips">
            ${this.envs.length === 0 ? html`<span class="dim small">${this.t('noEnvYet')}</span>` : nothing}
            ${this.envs.map(env => html`
              <button class="env-chip ${env === this.envEditing ? 'active' : ''}" @click=${() => this.envStartEdit(env)}>
                <span class="env-dot ${env.name === this.envActive ? 'on' : ''}"></span>${env.name}
              </button>`)}
            <button class="env-chip add" @click=${() => this.envStartEdit(null)}>${icon('plus')}${this.t('new')}</button>
          </div>
          <label class="field"><span>${this.t('envName')}</span>
            <input .value=${this.envName} placeholder="staging"
              @input=${(e: Event) => { this.envName = (e.target as HTMLInputElement).value; }} />
          </label>
          <label class="field"><span>${this.t('envBase')} <small>(optional)</small></span>
            <input class="mono" .value=${this.envBase} placeholder="https://staging.example.com" spellcheck="false"
              @input=${(e: Event) => { this.envBase = (e.target as HTMLInputElement).value; }} />
          </label>
          <label class="field"><span>${this.t('envVars')} <small>KEY=value</small></span>
            <textarea rows="4" .value=${this.envVarsText} placeholder=${'userId=42\ntoken=abc'} spellcheck="false"
              @input=${(e: Event) => { this.envVarsText = (e.target as HTMLTextAreaElement).value; }}></textarea>
          </label>
          <label class="check-row"><input type="checkbox" .checked=${this.envCreds}
            @change=${(e: Event) => { this.envCreds = (e.target as HTMLInputElement).checked; }} />
            ${this.t('envCreds')}
          </label>
          <label class="field timeout-field"><span>${this.t('timeoutLabel')} <small>${this.t('allEnvs')}</small></span>
            <select .value=${String(this.timeoutSec)} aria-label=${this.t('timeoutLabel')}
              @change=${(e: Event) => this.setTimeoutSec(Number((e.target as HTMLSelectElement).value))}>
              ${[10, 30, 60, 120, 300, 0].map(s => html`
                <option value=${String(s)} ?selected=${s === this.timeoutSec}>${s ? `${s} s` : this.t('noTimeout')}</option>`)}
            </select>
          </label>
        </div>
        <div class="pop-foot">
          ${this.envEditing ? html`
            <button class="btn ghost danger" @click=${this.envDelete}>${icon('trash')}${this.t('delete')}</button>` : nothing}
          <button class="btn ghost" title=${this.t('envImport')} @click=${() => this.importEnvs()}>${icon('plus')}${this.t('envImport')}</button>
          <button class="btn ghost" title=${this.t('envExport')} ?disabled=${!this.envs.length} @click=${() => this.exportEnvs()}>${icon('download')}${this.t('envExport')}</button>
          <span class="spacer"></span>
          <button class="btn primary" ?disabled=${!this.envName.trim()} @click=${this.envSave}>
            ${icon('check')}${this.t('save')}
          </button>
        </div>
      </div>
    `;
  }

  private toggleGroup(name: string): void {
    const next = new Set(this.collapsed);
    if (next.has(name)) next.delete(name); else next.add(name);
    this.setCollapsed(next);
  }

  private setCollapsed(next: Set<string>): void {
    this.collapsed = next;
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  }

  private allGroupKeys(): string[] {
    return [
      ...[...this.grouped().keys()].map(tag => `rest:${tag}`),
      ...(this.wsDoc?.gateways ?? []).map(gw => `ws:${gw.name}`),
      ...(this.gqlDoc?.resolvers ?? []).map(r => `gql:${r.name}`),
    ];
  }

  private groupHeader(key: string, label: string, count: number, iconName: string) {
    const isCollapsed = this.collapsed.has(key) && !this.search.trim();
    return html`
      <button class="group-head" @click=${() => this.toggleGroup(key)} aria-expanded=${String(!isCollapsed)}>
        ${icon('chevron', `chev ${isCollapsed ? 'closed' : ''}`)}
        ${icon(iconName, 'gi')}
        <span class="group-label">${label}</span>
        <span class="count">${count}</span>
      </button>
    `;
  }

  /**
   * A collapsible group body. Items are only built once the group has been
   * opened (thousands of endpoints stay cheap); after that they stay in the
   * DOM so collapsing/expanding animates smoothly.
   */
  private groupBody(key: string, open: boolean, content: () => unknown) {
    if (open) this.everOpened.add(key);
    const body = this.everOpened.has(key) ? content() : nothing;
    return html`<div class="group-body ${open ? 'open' : ''}" ?inert=${!open}><div class="group-items">${body}</div></div>`;
  }

  private everOpened = new Set<string>();
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  /** Instant on normal APIs; debounced on very large ones so typing stays fluid. */
  private setSearch(value: string): void {
    clearTimeout(this.searchTimer);
    if (this.operations().length <= 1000) { this.search = value; return; }
    this.searchTimer = setTimeout(() => { this.search = value; }, 120);
  }

  private navItem(active: boolean, pill: unknown, primary: unknown, secondary: string, onClick: () => void) {
    return html`
      <button class="nav-item ${active ? 'active' : ''}" @click=${() => this.navigate(onClick)}>
        ${pill}
        <span class="nav-text">
          <span class="nav-primary" dir="auto">${primary}</span>
          ${secondary ? html`<span class="nav-secondary"><bdi dir="auto">${secondary}</bdi></span>` : nothing}
        </span>
      </button>
    `;
  }

  private renderSidebar() {
    const groups = this.grouped();
    const needle = this.search.trim().toLowerCase();
    const match = (...values: (string | undefined)[]) =>
      !needle || values.some(v => (v || '').toLowerCase().includes(needle));
    const wsGateways = (this.wsDoc?.gateways ?? [])
      .map(gw => ({ gw, events: (gw.events ?? []).filter(ev => match(ev.event, gw.name, 'ws')) }))
      .filter(x => x.events.length);
    const resolvers = (this.gqlDoc?.resolvers ?? [])
      .map(r => ({ r, ops: r.operations.filter(op => match(op.name, r.name, op.kind)) }))
      .filter(x => x.ops.length);
    const scenarios = this.scenarios.map((sc, i) => ({ sc, i })).filter(({ sc }) => match(sc.name, 'scenario'));
    const isOpen = (key: string) => !!needle || !this.collapsed.has(key);
    const anyOpen = this.allGroupKeys().some(k => !this.collapsed.has(k));
    const nothingFound = needle && !groups.size && !wsGateways.length && !resolvers.length && !scenarios.length;
    return html`
      <div class="side-top">
        <div class="search-box">
          ${icon('search')}
          <input id="ss-search" type="search" placeholder=${this.t('search')} .value=${this.search}
            @input=${(e: Event) => this.setSearch((e.target as HTMLInputElement).value)} />
          ${this.search
            ? html`<button class="btn ghost sm icon-only" @click=${() => { this.search = ''; }}>${icon('x')}</button>`
            : html`<kbd>/</kbd>`}
        </div>
        <div class="seg">
          <button class=${this.sideTab === 'collections' ? 'on' : ''} @click=${() => { this.sideTab = 'collections'; }}>
            ${icon('layers')}${this.t('collections')}
          </button>
          <button class=${this.sideTab === 'history' ? 'on' : ''} @click=${() => { this.sideTab = 'history'; }}>
            ${icon('clock')}${this.t('history')}
            ${this.history.length ? html`<span class="count">${this.history.length}</span>` : nothing}
          </button>
        </div>
      </div>
      <div class="side-scroll">
        ${this.sideTab === 'history' ? this.renderHistory() : html`
          <button class="nav-overview ${this.view === 'overview' ? 'active' : ''}" @click=${this.goOverview}>
            ${icon('home')}${this.t('overview')}
          </button>
          ${nothingFound ? html`
            <div class="side-empty">${icon('search')}<span>${this.t('noResults')}</span></div>` : nothing}
          ${groups.size ? html`
            <div class="side-section">
              <span>REST</span>
              <button class="link-btn" @click=${() => this.setCollapsed(anyOpen ? new Set(this.allGroupKeys()) : new Set())}>
                ${anyOpen ? this.t('collapseAll') : this.t('expandAll')}
              </button>
            </div>` : nothing}
          ${[...groups.entries()].map(([tag, ops]) => html`
            ${this.groupHeader(`rest:${tag}`, tag, ops.length, 'folder')}
            ${this.groupBody(`rest:${tag}`, isOpen(`rest:${tag}`), () => html`
              ${ops.map(op => {
                const title = this.opTitle(op);
                return this.navItem(
                  this.view === 'rest' && this.selected?.method === op.method && this.selected?.path === op.path,
                  this.methodPill(op.method),
                  title === op.path ? this.renderPath(op.path) : title,
                  title === op.path ? '' : op.path,
                  () => { this.select(op); this.setHash(this.opId(op)); },
                );
              })}
            `)}
          `)}
          ${wsGateways.length ? html`<div class="side-section"><span>WebSocket</span></div>` : nothing}
          ${wsGateways.map(({ gw, events }) => html`
            ${this.groupHeader(`ws:${gw.name}`, gw.name, events.length, 'arrows')}
            ${this.groupBody(`ws:${gw.name}`, isOpen(`ws:${gw.name}`), () => html`
              ${events.map(ev => this.navItem(
                this.view === 'ws' && this.wsSelected?.event === ev,
                this.methodPill('ws'), ev.event, gw.namespace || '',
                () => this.selectWs(gw, ev),
              ))}
            `)}
          `)}
          ${resolvers.length ? html`<div class="side-section"><span>GraphQL</span></div>` : nothing}
          ${resolvers.map(({ r, ops }) => html`
            ${this.groupHeader(`gql:${r.name}`, r.name, ops.length, 'hex')}
            ${this.groupBody(`gql:${r.name}`, isOpen(`gql:${r.name}`), () => html`
              ${ops.map(op => this.navItem(
                this.view === 'gql' && this.gqlSelected?.operation === op,
                this.methodPill(op.kind), op.name, op.summary || '',
                () => this.selectGql(r, op),
              ))}
            `)}
          `)}
          ${!needle || scenarios.length ? html`
            <div class="side-section">
              <span>${this.t('scenarios')}</span>
              <button class="link-btn" @click=${() => this.importScenarios()}>${this.t('import')}</button>
            </div>
            ${scenarios.length === 0 ? html`<div class="side-hint">${this.t('noScenarios')}</div>` : nothing}
            ${scenarios.map(({ sc, i }) => this.navItem(
              this.view === 'scenario' && this.scenarioIndex === i,
              html`<span class="m m-flow">FLOW</span>`, sc.name,
              `${sc.steps.length} ${this.t('steps')}${sc.source === 'imported' ? ` · ${this.t('imported')}` : sc.source === 'recorded' ? ` · ${this.t('recorded')}` : ''}`,
              () => this.selectScenario(i),
            ))}` : nothing}
        `}
      </div>
      <div class="side-foot">
        <span>${this.operations().length} ${this.t('endpoints').toLowerCase()}</span>
        <span>OpenAPI ${this.spec?.openapi ?? ''}</span>
      </div>
    `;
  }

  private renderHistory() {
    if (!this.history.length) {
      return html`<div class="side-empty">${icon('clock')}<span>${this.t('noHistory')}</span></div>`;
    }
    return html`
      <div class="side-section">
        <span>${this.t('history')}</span>
        <button class="link-btn" @click=${() => {
          this.history = [];
          try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
        }}>${this.t('clear')}</button>
      </div>
      ${this.history.map(h => html`
        <button class="nav-item hist" @click=${() => {
          const op = this.operations().find(o => o.method === h.method && o.path === h.path);
          if (op) this.navigate(() => { this.select(op); this.setHash(this.opId(op)); });
        }}>
          ${this.methodPill(h.method)}
          <span class="nav-text"><span class="nav-primary">${this.renderPath(h.path)}</span></span>
          <span class="hist-meta">
            <span class="st ${statusClass(h.status)}">${h.mock ? 'MOCK ' : ''}${h.status || 'ERR'}</span>
            <span>${timeAgo(h.at)}</span>
          </span>
        </button>`)}
    `;
  }

  private renderOverview() {
    const info = this.spec?.info ?? {};
    const ops = this.operations();
    const groups = [...this.grouped(true).entries()];
    const byMethod = new Map<string, number>();
    for (const op of ops) byMethod.set(op.method, (byMethod.get(op.method) ?? 0) + 1);
    const wsCount = (this.wsDoc?.gateways ?? []).reduce((n, g) => n + (g.events?.length ?? 0), 0);
    const gqlCount = (this.gqlDoc?.resolvers ?? []).reduce((n, r) => n + r.operations.length, 0);
    const methodClass = (m: string) => (KNOWN_METHODS.has(m.toLowerCase()) ? m.toLowerCase() : 'other');
    const stat = (tone: number, iconName: string, value: unknown, label: string) => html`
      <div class="stat" style="--tone: var(--tone-${tone})">
        <span class="stat-icon">${icon(iconName)}</span><div><b>${value}</b><span>${label}</span></div>
      </div>`;
    // Start where most people start: the login endpoint, otherwise the first one.
    const firstOp = ops.find(o => /login|signin|token|auth/i.test(o.path) && o.method === 'POST') ?? ops[0];
    const preview = ops.slice(0, 4);
    const schemaNames = Object.keys(this.spec?.components?.schemas ?? {}).sort();
    return html`
      <section class="hero">
        <div class="hero-main">
          <div class="hero-badges">
            ${this.spec?.openapi ? html`<span class="pill">OpenAPI ${this.spec.openapi}</span>` : nothing}
            ${info.version ? html`<span class="pill accent">v${info.version.replace(/^v/i, '')}</span>` : nothing}
          </div>
          <h1 dir="auto">${info.title || 'API Documentation'}</h1>
          <p dir="auto">${info.description || this.t('overviewDefault')}</p>
          <div class="base-url">
            <span class="lbl">${this.t('baseUrl')}</span>
            <code>${this.baseUrl()}</code>
            <button class="btn ghost sm icon-only" title=${this.t('copyUrl')} @click=${() => this.copyText(this.baseUrl())}>${icon('copy')}</button>
          </div>
          <div class="hero-actions">
            ${firstOp ? html`
              <button class="btn primary lg" @click=${() => this.navigate(() => { this.select(firstOp); this.setHash(this.opId(firstOp)); })}>
                ${icon('send')}${this.t('tryFirst')}
              </button>` : nothing}
            <button class="btn lg" @click=${() => this.openPalette()}>${icon('search')}${this.t('searchShort')}<kbd>Ctrl K</kbd></button>
          </div>
        </div>
        ${preview.length ? html`
          <div class="hero-art" aria-hidden="true">
            <div class="art-card">
              <div class="art-dots"><i></i><i></i><i></i></div>
              ${preview.map((op, i) => html`
                <div class="art-row" style="--d:${i * 90}ms">
                  ${this.methodPill(op.method)}<span class="art-path">${this.renderPath(op.path)}</span>
                  <span class="art-st">${Object.keys(op.responses ?? {}).filter(c => /^2\d\d$/.test(c)).sort()[0] ?? '200'}</span>
                </div>`)}
            </div>
            <div class="art-glow"></div>
          </div>` : nothing}
      </section>

      <div class="stats">
        ${stat(1, 'layers', ops.length, this.t('endpoints'))}
        ${stat(2, 'folder', groups.length, this.t('groups'))}
        ${stat(3, 'arrows', wsCount, this.t('wsEvents'))}
        ${stat(4, 'hex', gqlCount, this.t('gqlOps'))}
      </div>

      ${ops.length ? html`
        <div class="method-dist">
          <div class="card-title">${this.t('methods')}</div>
          <div class="dist-bar">
            ${[...byMethod.entries()].map(([m, n]) => html`
              <span class="m-${methodClass(m)}" style="flex:${n}" title="${m} × ${n}"></span>`)}
          </div>
          <div class="dist-legend">
            ${[...byMethod.entries()].map(([m, n]) => html`
              <span class="m-${methodClass(m)}"><i></i>${m}<b>${n}</b></span>`)}
          </div>
        </div>` : nothing}

      ${groups.length ? html`
        <h2 class="section-title">${icon('folder')}${this.t('groups')}</h2>
        <div class="group-grid">
          ${groups.map(([tag, list], gi) => html`
            <button class="group-card" style="--tone: var(--tone-${(gi % 5) + 1})" @click=${() => this.navigate(() => {
              const next = new Set(this.collapsed);
              next.delete(`rest:${tag}`);
              this.setCollapsed(next);
              this.select(list[0]);
              this.setHash(this.opId(list[0]));
            })}>
              <div class="gc-head">${icon('folder')}<b>${tag}</b><span class="count">${list.length}</span></div>
              <div class="gc-methods">${list.slice(0, 8).map(op => this.methodPill(op.method))}
                ${list.length > 8 ? html`<span class="dim small">+${list.length - 8}</span>` : nothing}</div>
            </button>`)}
        </div>` : nothing}

      ${schemaNames.length ? html`
        <h2 class="section-title">${icon('braces')}${this.t('schemas')}<span class="count">${schemaNames.length}</span></h2>
        <div class="schema-list">
          ${schemaNames.map(name => {
            const schema = this.resolveSchema({ $ref: `#/components/schemas/${name}` });
            const fields = Object.keys(schema?.properties ?? {}).length;
            const open = this.openSchemas.has(name);
            return html`
              <div class="schema-item ${open ? 'open' : ''}">
                <button class="schema-head" aria-expanded=${String(open)} @click=${() => {
                  const next = new Set(this.openSchemas);
                  if (open) next.delete(name); else next.add(name);
                  this.openSchemas = next;
                }}>
                  ${icon('chevron', `chev ${open ? '' : 'closed'}`)}<b class="mono">${name}</b>
                  <span class="dim small">${schema?.type === 'array' ? 'array' : `${fields} ${this.t('fields')}`}</span>
                  ${schema?.description ? html`<span class="dim small ellipsis-text">${schema.description}</span>` : nothing}
                </button>
                ${open ? html`<div class="schema-body">
                  ${this.renderSchemaTable({ $ref: `#/components/schemas/${name}` })}
                  <pre class="code mt">${unsafeHTML(hljson(JSON.stringify(this.example({ $ref: `#/components/schemas/${name}` }) ?? {}, null, 2)))}</pre>
                </div>` : nothing}
              </div>`;
          })}
        </div>` : nothing}

      <h2 class="section-title">${icon('bolt')}${this.t('quickStart')}</h2>
      <div class="tips">
        <div class="tip"><span class="tip-icon">${icon('shield')}</span><b>${this.t('tipAuthTitle')}</b><p>${this.t('tipAuth')}</p></div>
        <div class="tip"><span class="tip-icon">${icon('variable')}</span><b>${this.t('tipChainTitle')}</b><p>${this.t('tipChain')}</p></div>
        <div class="tip"><span class="tip-icon">${icon('keyboard')}</span><b>${this.t('tipKeysTitle')}</b><p>${this.t('tipKeys')}</p></div>
      </div>
    `;
  }

  private renderVarsBar() {
    const vars = this.allVars();
    const names = Object.keys(vars);
    if (!names.length) return nothing;
    return html`
      <div class="vars-bar">
        <span class="vars-label">${icon('variable')}${this.t('variablesActive')}</span>
        ${names.map(name => html`
          <span class="var-chip" title=${vars[name]}>
            <span @click=${() => this.copyText(`{{${name}}}`)}>{{${name}}}</span>
            ${this.vars[name] !== undefined ? html`
              <button title=${this.t('delete')} @click=${() => this.deleteVar(name)}>${icon('x')}</button>` : nothing}
          </span>`)}
      </div>
    `;
  }

  private renderCaptureRow() {
    if (this.lastResponseJson === null || typeof this.lastResponseJson !== 'object') return nothing;
    const paths = jsonPaths(this.lastResponseJson);
    return html`
      <div class="capture">
        <span class="capture-label">${icon('variable')}${this.t('captureTitle')}</span>
        <input placeholder=${this.t('varName')} .value=${this.captureName}
          @input=${(e: Event) => { this.captureName = (e.target as HTMLInputElement).value; }} />
        <input class="mono" list="ss-paths" placeholder="data.id" .value=${this.capturePath}
          @input=${(e: Event) => {
            this.capturePath = (e.target as HTMLInputElement).value;
            if (!this.captureName) this.captureName = this.capturePath.split(/[.[\]]/).filter(Boolean).pop() || '';
          }}
          @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.captureVar(); }} />
        <datalist id="ss-paths">${paths.map(p => html`<option value=${p}></option>`)}</datalist>
        <button class="btn sm" ?disabled=${!this.captureName.trim() || !this.capturePath.trim()}
          @click=${this.captureVar}>${icon('plus')}${this.t('capture')}</button>
      </div>
    `;
  }

  private renderUrlBar(pill: unknown, input: unknown, action: unknown, warn = false, extra: unknown = nothing) {
    return html`
      <div class="url-bar ${warn ? 'warn' : ''}">
        <span class="url-pill">${pill}</span>
        ${input}
        ${extra}
        ${action}
      </div>
    `;
  }

  private renderMockSwitch() {
    return html`
      <div class="mock-switch" role="group" aria-label=${this.t('mockSwitch')}>
        <button class=${!this.mockMode ? 'on' : ''} aria-pressed=${String(!this.mockMode)} title=${this.t('liveHint')}
          @click=${() => this.setMockMode(false)}>${this.t('live')}</button>
        <button class=${this.mockMode ? 'on mock' : ''} aria-pressed=${String(this.mockMode)} title=${this.t('mockHint')}
          @click=${() => this.setMockMode(true)}>${this.t('mock')}</button>
      </div>`;
  }

  private renderRestDetail() {
    const op = this.selected;
    if (!op) return html`<div class="empty-state">${icon('inbox')}<b>${this.t('selectOp')}</b></div>`;
    const pathParams = (op.parameters ?? []).filter(p => p.in === 'path');
    const queryParams = (op.parameters ?? []).filter(p => p.in === 'query');
    const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(op.method);
    const paramsCount = pathParams.length + queryParams.length;
    const headersCount = this.headerRows.filter(r => r.key.trim()).length;
    const url = this.requestTarget(op).display;
    const unresolved = /\{\{[^}]*\}\}|\{[^{}]+\}/.test(url);
    const title = this.opTitle(op);
    const authOn = this.reqAuth.mode !== 'inherit' || (this.globalAuth.type !== 'none' && !!this.globalAuth.token);
    return html`
      <div class="crumbs">
        <button @click=${this.goOverview}>${this.t('overview')}</button>
        <span class="sep">/</span><span>${op.tags?.[0] || 'Other'}</span>
      </div>
      <div class="req-title">
        <div class="req-title-text">
          <h1 dir="auto">${title}</h1>
          ${op.description && op.description !== title ? html`<p class="desc" dir="auto">${op.description}</p>` : nothing}
        </div>
        <div class="title-actions">
          <button class="btn ghost sm" title="Copy cURL" @click=${() => {
            const prev = this.codeLang;
            this.codeLang = 'curl';
            void this.copyText(this.snippetFor(op));
            this.codeLang = prev;
          }}>${icon('copy')}${this.t('copyCurl')}</button>
          <button class="btn ghost sm" @click=${this.shareLink}>${icon('link')}${this.t('share')}</button>
          <button class="btn ghost sm icon-only layout-toggle ${this.splitView ? 'on' : ''}"
            title=${this.t('toggleSplit')} @click=${() => this.toggleSplit()}>${icon(this.splitView ? 'rows' : 'columns')}</button>
        </div>
      </div>

      ${this.renderUrlBar(
        this.methodPill(op.method, 'lg'),
        html`<input class="url-input" .value=${url} spellcheck="false" aria-label=${this.t('requestUrl')}
          title=${unresolved ? this.t('unresolvedHint') : url}
          @input=${(e: Event) => { this.urlOverride = (e.target as HTMLInputElement).value; }}
          @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') void this.send(); }} />`,
        this.running
          ? html`<button class="send-btn danger" @click=${this.cancelRequest} title=${this.t('cancelHint')}>
              <span class="spinner"></span><span>${this.t('cancel')}</span>
            </button>`
          : html`<button class="send-btn" @click=${this.send}>${icon('send')}<span>${this.t('send')}</span></button>`,
        unresolved,
        html`${this.urlOverride !== null ? html`<button class="url-reset" title=${this.t('reset')}
            @click=${() => { this.urlOverride = null; }}>${icon('reset')}</button>` : nothing}
          ${this.renderMockSwitch()}`,
      )}
      ${unresolved ? html`<div class="hint warn">${icon('alert')}${this.t('unresolvedHint')}</div>` : nothing}
      ${this.mockMode ? html`<div class="hint mock">${icon('bolt')}${this.t(this.mockPrefix() ? 'mockModeHint' : 'mockModeLocal')}</div>` : nothing}
      ${this.renderVarsBar()}

      <div class="rest-grid ${this.splitView ? 'split' : ''}">
      <section class="card req-card">
        <div class="tabs" role="tablist">
          ${([
            { id: 'params', label: this.t('params'), count: paramsCount },
            { id: 'auth', label: this.t('auth'), dot: authOn },
            { id: 'headers', label: this.t('headers'), count: headersCount },
            { id: 'body', label: this.t('body'), dot: hasBody && (this.bodyMode === 'json' ? !!this.bodyText.trim() : this.bodyMode !== 'none') },
            { id: 'docs', label: this.t('docs') },
            { id: 'code', label: this.t('code') },
          ] as { id: ReqTab; label: string; count?: number; dot?: boolean }[]).map(tab => html`
            <button role="tab" class="tab ${this.reqTab === tab.id ? 'active' : ''}"
              aria-selected=${String(this.reqTab === tab.id)} @click=${() => { this.reqTab = tab.id; }}>
              ${tab.label}
              ${tab.count ? html`<span class="count">${tab.count}</span>` : nothing}
              ${tab.dot ? html`<span class="dot"></span>` : nothing}
            </button>`)}
          <span class="spacer"></span>
          <span class="tabs-hint"><kbd>${this.t('sendHint')}</kbd></span>
        </div>
        <div class="tab-panel">
          ${this.reqTab === 'params' ? this.renderParamsTab(pathParams, queryParams)
            : this.reqTab === 'auth' ? this.renderAuthTab()
            : this.reqTab === 'headers' ? this.renderHeadersTab(op)
            : this.reqTab === 'body' ? this.renderBodyTab(hasBody)
            : this.reqTab === 'docs' ? this.renderDocsTab(op)
            : this.renderCodeTab(op)}
        </div>
      </section>

      ${this.renderResponsePanel()}
      </div>
    `;
  }

  private emptyState(iconName: string, title: string, sub = '') {
    return html`<div class="empty-state">${icon(iconName)}<b>${title}</b>${sub ? html`<span>${sub}</span>` : nothing}</div>`;
  }

  /** "min 3, max 40, pattern" — the validation rules a field documents. */
  private constraintsOf(schema?: SchemaLike): string {
    const s = this.resolveSchema(schema);
    if (!s) return '';
    const parts: string[] = [];
    if (s.minLength !== undefined) parts.push(`min ${s.minLength}`);
    if (s.maxLength !== undefined) parts.push(`max ${s.maxLength}`);
    if (s.minimum !== undefined) parts.push(`≥ ${s.minimum}`);
    if (s.maximum !== undefined) parts.push(`≤ ${s.maximum}`);
    if (s.pattern) parts.push(`/${s.pattern}/`);
    if (s.enum?.length) parts.push(s.enum.join(' | '));
    if (s.default !== undefined) parts.push(`default ${JSON.stringify(s.default)}`);
    return parts.join(' · ');
  }

  private renderParamsTab(pathParams: ParamInfo[], queryParams: ParamInfo[]) {
    // Editing params rebuilds the URL, so a hand-edited URL gives way.
    const edited = () => { this.urlOverride = null; };
    const row = (p: ParamInfo, where: 'path' | 'query') => {
      const off = where === 'query' && this.disabledQuery.has(p.name);
      const values = where === 'path' ? this.pathParams : this.queryParams;
      const schema = this.resolveSchema(p.schema);
      const rules = this.constraintsOf(p.schema);
      return html`
        <tr class=${off ? 'off' : ''}>
          <td class="c-check">
            <input type="checkbox" .checked=${!off} ?disabled=${where === 'path'} aria-label="${this.t('enable')} ${p.name}"
              @change=${(e: Event) => {
                const next = new Set(this.disabledQuery);
                if ((e.target as HTMLInputElement).checked) next.delete(p.name); else next.add(p.name);
                this.disabledQuery = next;
                edited();
              }} />
          </td>
          <td>
            <span class="key-name">${p.name}</span>${p.required ? html`<span class="req-star" title=${this.t('required')}>*</span>` : nothing}
            ${p.description || schema?.description ? html`<div class="field-desc">${p.description || schema?.description}</div>` : nothing}
          </td>
          <td>
            <input .value=${values[p.name] ?? ''} placeholder=${schema?.type || 'value'} spellcheck="false" aria-label=${p.name}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                if (where === 'path') this.pathParams = { ...this.pathParams, [p.name]: v };
                else this.queryParams = { ...this.queryParams, [p.name]: v };
                edited();
              }} />
          </td>
          <td class="c-type">
            <span class="type-tag">${schema?.type || 'string'}${schema?.format ? html`<span class="dim">(${schema.format})</span>` : nothing}</span>
            ${rules ? html`<div class="field-desc">${rules}</div>` : nothing}
          </td>
        </tr>`;
    };
    const updateExtra = (i: number, patch: Partial<{ key: string; value: string; enabled: boolean }>) => {
      const next = [...this.extraQuery];
      next[i] = { ...next[i], ...patch };
      this.extraQuery = next;
      edited();
    };
    const head = html`<thead><tr><th class="c-check"><span class="sr-only">${this.t('enable')}</span></th><th>${this.t('key')}</th><th>${this.t('value')}</th><th class="c-type">${this.t('type')}</th></tr></thead>`;
    return html`
      ${pathParams.length ? html`
        <div class="sub-title">${this.t('pathParams')}<span class="count">${pathParams.length}</span></div>
        <table class="kv">${head}<tbody>${pathParams.map(p => row(p, 'path'))}</tbody></table>` : nothing}
      <div class="sub-title">${this.t('queryParams')}${queryParams.length + this.extraQuery.length ? html`<span class="count">${queryParams.length + this.extraQuery.length}</span>` : nothing}</div>
      ${queryParams.length || this.extraQuery.length ? html`
        <table class="kv">${head}<tbody>
          ${queryParams.map(p => row(p, 'query'))}
          ${this.extraQuery.map((r, i) => html`
            <tr class=${r.enabled ? '' : 'off'}>
              <td class="c-check"><input type="checkbox" .checked=${r.enabled} aria-label=${this.t('enable')}
                @change=${(e: Event) => updateExtra(i, { enabled: (e.target as HTMLInputElement).checked })} /></td>
              <td><input .value=${r.key} placeholder=${this.t('key')} spellcheck="false" aria-label=${this.t('key')}
                @input=${(e: Event) => updateExtra(i, { key: (e.target as HTMLInputElement).value })} /></td>
              <td><input .value=${r.value} placeholder=${this.t('value')} spellcheck="false" aria-label=${this.t('value')}
                @input=${(e: Event) => updateExtra(i, { value: (e.target as HTMLInputElement).value })} /></td>
              <td class="c-type"><button class="btn ghost sm icon-only" title=${this.t('delete')} aria-label=${this.t('delete')}
                @click=${() => { this.extraQuery = this.extraQuery.filter((_, j) => j !== i); edited(); }}>${icon('trash')}</button></td>
            </tr>`)}
        </tbody></table>` : nothing}
      <button class="btn ghost sm add-row" @click=${() => { this.extraQuery = [...this.extraQuery, { key: '', value: '', enabled: true }]; }}>
        ${icon('plus')}${this.t('addParam')}
      </button>
    `;
  }

  private renderAuthTab() {
    const auth = this.reqAuth;
    const set = (patch: Partial<ReqAuth>) => {
      this.reqAuth = { ...auth, ...patch };
      if (this.selected) this.reqAuthStore[this.opId(this.selected)] = this.reqAuth;
    };
    const g = this.globalAuth;
    const inheritDesc = g.type !== 'none' && g.token
      ? `${g.type === 'bearer' ? 'Bearer' : g.header} ••••${g.token.slice(-4)}`
      : this.t('authInheritDesc');
    const options: { id: ReqAuth['mode']; label: string; desc: string }[] = [
      { id: 'inherit', label: this.t('authInherit'), desc: inheritDesc },
      { id: 'bearer', label: this.t('authBearer'), desc: this.t('authBearerDesc') },
      { id: 'apikey', label: this.t('authApiKey'), desc: this.t('authApiKeyDesc') },
      { id: 'none', label: this.t('authNone'), desc: this.t('authNoneDesc') },
    ];
    return html`
      <div class="auth-options">
        ${options.map(o => html`
          <button class="auth-opt ${auth.mode === o.id ? 'on' : ''}" @click=${() => set({ mode: o.id })}>
            <span class="radio"></span><span><b>${o.label}</b><small>${o.desc}</small></span>
          </button>`)}
      </div>
      ${auth.mode === 'bearer' || auth.mode === 'apikey' ? html`
        <div class="auth-fields">
          ${auth.mode === 'apikey' ? html`
            <label class="field"><span>${this.t('header')}</span>
              <input .value=${auth.header} placeholder="X-API-Key" spellcheck="false"
                @input=${(e: Event) => set({ header: (e.target as HTMLInputElement).value })} />
            </label>` : nothing}
          <label class="field"><span>${auth.mode === 'bearer' ? 'Token' : this.t('value')}</span>
            <input class="mono" .value=${auth.token} placeholder="{{token}}" spellcheck="false"
              @input=${(e: Event) => set({ token: (e.target as HTMLInputElement).value })} />
          </label>
        </div>` : nothing}
      ${auth.mode === 'inherit' && !(g.type !== 'none' && g.token) ? html`
        <div class="hint">${icon('info')}${this.t('tipAuth')}</div>` : nothing}
    `;
  }

  private renderHeadersTab(op: OperationInfo) {
    const url = this.requestTarget(op).display;
    const auto = Object.entries(this.authHeadersFor(url, this.effectiveAuth()));
    const { body, contentType } = this.currentBody();
    if (body !== undefined && !this.headerRows.some(r => r.key.trim().toLowerCase() === 'content-type')) {
      auto.unshift(['Content-Type', contentType ?? 'multipart/form-data; boundary=…']);
    }
    const update = (i: number, patch: Partial<{ key: string; value: string }>) => {
      const rows = [...this.headerRows];
      rows[i] = { ...rows[i], ...patch };
      this.headerRows = rows;
    };
    return html`
      <table class="kv">
        <thead><tr><th>${this.t('key')}</th><th>${this.t('value')}</th><th class="c-act"><span class="sr-only">${this.t('actions')}</span></th></tr></thead>
        <tbody>
          ${auto.map(([k, v]) => html`
            <tr class="auto">
              <td><span class="key-name">${k}</span></td>
              <td class="mono ellipsis">${/^authorization$/i.test(k) || k === this.effectiveAuth().header
                ? v.replace(/(.{12}).+(.{4})$/, '$1••••$2') : v}</td>
              <td class="c-act"><span class="badge">${this.t('autoHeaders')}</span></td>
            </tr>`)}
          ${this.headerRows.map((row, i) => html`
            <tr>
              <td><input placeholder="Header" .value=${row.key} spellcheck="false"
                @input=${(e: Event) => update(i, { key: (e.target as HTMLInputElement).value })} /></td>
              <td><input placeholder="Value" .value=${row.value} spellcheck="false"
                @input=${(e: Event) => update(i, { value: (e.target as HTMLInputElement).value })} /></td>
              <td class="c-act"><button class="btn ghost sm icon-only" title=${this.t('delete')} @click=${() => {
                this.headerRows = this.headerRows.filter((_, j) => j !== i);
              }}>${icon('trash')}</button></td>
            </tr>`)}
        </tbody>
      </table>
      <button class="btn ghost sm add-row" @click=${() => { this.headerRows = [...this.headerRows, { key: '', value: '' }]; }}>
        ${icon('plus')}${this.t('addHeader')}
      </button>
    `;
  }

  private renderEditor(value: string, onInput: (v: string) => void, size = '', placeholder = '') {
    const lines = Math.min(2000, Math.max(1, value.split('\n').length));
    return html`
      <div class="editor ${size}" style="--rows:${Math.min(lines, 26)}">
        <div class="gutter" aria-hidden="true">${Array.from({ length: lines }, (_, i) => html`<div>${i + 1}</div>`)}</div>
        <textarea spellcheck="false" .value=${value} placeholder=${placeholder}
          @input=${(e: Event) => onInput((e.target as HTMLTextAreaElement).value)}
          @scroll=${(e: Event) => {
            const ta = e.target as HTMLTextAreaElement;
            const gutter = ta.previousElementSibling as HTMLElement | null;
            if (gutter) gutter.scrollTop = ta.scrollTop;
          }}
          @keydown=${(e: KeyboardEvent) => {
            const ta = e.target as HTMLTextAreaElement;
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
              onInput(ta.value);
            } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
              // Keep the current indentation; indent one level after an opener.
              e.preventDefault();
              const before = ta.value.slice(0, ta.selectionStart);
              const indent = /[^\n]*$/.exec(before)?.[0].match(/^\s*/)?.[0] ?? '';
              const opener = /[{[]\s*$/.test(before);
              const closer = /^\s*[}\]]/.test(ta.value.slice(ta.selectionEnd));
              const inner = indent + (opener ? '  ' : '');
              const insert = opener && closer ? `\n${inner}\n${indent}` : `\n${inner}`;
              ta.setRangeText(insert, ta.selectionStart, ta.selectionEnd, 'end');
              if (opener && closer) ta.selectionStart = ta.selectionEnd = ta.selectionStart - indent.length - 1;
              onInput(ta.value);
            }
          }}></textarea>
      </div>
    `;
  }

  private jsonState(text: string) {
    if (!text.trim()) return nothing;
    const ok = isJsonish(text);
    return html`<span class="json-state ${ok ? 'ok' : 'bad'}">${icon(ok ? 'check' : 'alert')}${ok ? this.t('validJson') : this.t('invalidJson')}</span>`;
  }

  private beautify(text: string, apply: (v: string) => void): void {
    const parsed = parseSafe(text);
    if (parsed === undefined) { this.showToast(this.t('invalidJson')); return; }
    apply(JSON.stringify(parsed, null, 2));
  }

  private renderBodyTab(hasBody: boolean) {
    if (!hasBody) return this.emptyState('inbox', this.t('noBody'));
    const set = (v: string) => { this.bodyText = v; };
    const modes: { id: BodyMode; label: string }[] = [
      { id: 'json', label: 'JSON' },
      { id: 'form', label: this.t('formData') },
      { id: 'urlencoded', label: this.t('urlencoded') },
      { id: 'none', label: this.t('none') },
    ];
    return html`
      <div class="editor-bar">
        <div class="seg inline" role="radiogroup" aria-label=${this.t('bodyType')}>
          ${modes.map(m => html`
            <button role="radio" aria-checked=${String(this.bodyMode === m.id)} class=${this.bodyMode === m.id ? 'on' : ''}
              @click=${() => { this.bodyMode = m.id; }}>${m.label}</button>`)}
        </div>
        ${this.bodyMode === 'json' ? html`
          ${this.jsonState(this.bodyText)}
          <span class="spacer"></span>
          <button class="btn ghost sm" @click=${() => this.beautify(this.bodyText, set)}>${icon('wand')}${this.t('beautify')}</button>
          ${this.bodyExample && this.bodyText !== this.bodyExample ? html`
            <button class="btn ghost sm" @click=${() => set(this.bodyExample)}>${icon('reset')}${this.t('reset')}</button>` : nothing}`
          : html`<span class="spacer"></span><span class="ct">${CONTENT_TYPES[this.bodyMode] || '—'}</span>`}
      </div>
      ${this.bodyMode === 'json' ? this.renderEditor(this.bodyText, set, '', '{ }')
        : this.bodyMode === 'none' ? this.emptyState('inbox', this.t('noBodySent'))
        : this.renderFormTable()}
    `;
  }

  /** Form-data / URL-encoded fields, with file pickers for uploads. */
  private renderFormTable() {
    const files = this.bodyMode === 'form';
    const update = (i: number, patch: Partial<FormRow>) => {
      const next = [...this.formRows];
      next[i] = { ...next[i], ...patch };
      this.formRows = next;
    };
    const size = (n: number) => formatBytes(n);
    return html`
      <table class="kv form-table">
        <thead><tr><th class="c-check"><span class="sr-only">${this.t('enable')}</span></th><th>${this.t('key')}</th>${files ? html`<th class="c-kind">${this.t('type')}</th>` : nothing}<th>${this.t('value')}</th><th class="c-act"><span class="sr-only">${this.t('actions')}</span></th></tr></thead>
        <tbody>
          ${this.formRows.map((r, i) => html`
            <tr class=${r.enabled ? '' : 'off'}>
              <td class="c-check"><input type="checkbox" .checked=${r.enabled} aria-label="${this.t('enable')} ${r.key}"
                @change=${(e: Event) => update(i, { enabled: (e.target as HTMLInputElement).checked })} /></td>
              <td>
                <input .value=${r.key} placeholder=${this.t('key')} spellcheck="false" aria-label=${this.t('key')}
                  @input=${(e: Event) => update(i, { key: (e.target as HTMLInputElement).value })} />
                ${r.required || r.description ? html`<div class="field-desc">${r.required ? html`<span class="req-star">*</span> ` : nothing}${r.description ?? ''}</div>` : nothing}
              </td>
              ${files ? html`<td class="c-kind">
                <select class="mini-select" .value=${r.kind} aria-label=${this.t('type')}
                  @change=${(e: Event) => update(i, { kind: (e.target as HTMLSelectElement).value as FormRow['kind'], files: [] })}>
                  <option value="text" ?selected=${r.kind === 'text'}>${this.t('textKind')}</option>
                  <option value="file" ?selected=${r.kind === 'file'}>${this.t('fileKind')}</option>
                </select></td>` : nothing}
              <td>
                ${r.kind === 'file' ? html`
                  <label class="file-pick">
                    <input type="file" ?multiple=${!!r.multiple}
                      @change=${(e: Event) => update(i, { files: Array.from((e.target as HTMLInputElement).files ?? []) })} />
                    ${icon('plus')}<span>${r.files.length ? this.t('changeFile') : this.t('chooseFile')}</span>
                  </label>
                  ${r.files.map(f => html`<span class="file-chip" title=${f.type || ''}>${f.name} <i>${size(f.size)}</i></span>`)}`
                  : html`<input .value=${r.value} placeholder=${this.t('value')} spellcheck="false" aria-label=${this.t('value')}
                    @input=${(e: Event) => update(i, { value: (e.target as HTMLInputElement).value })} />`}
              </td>
              <td class="c-act"><button class="btn ghost sm icon-only" title=${this.t('delete')} aria-label=${this.t('delete')}
                @click=${() => { this.formRows = this.formRows.filter((_, j) => j !== i); }}>${icon('trash')}</button></td>
            </tr>`)}
        </tbody>
      </table>
      <button class="btn ghost sm add-row" @click=${() => { this.formRows = [...this.formRows, { key: '', kind: 'text', value: '', files: [], enabled: true }]; }}>
        ${icon('plus')}${this.t('addField')}
      </button>
    `;
  }

  private renderSchemaTable(schema: SchemaLike | undefined) {
    const resolved = this.resolveSchema(schema);
    const rows: { name: string; type: string; required: boolean; desc: string }[] = [];
    const walk = (s: SchemaLike | undefined, prefix: string, depth: number) => {
      const r = this.resolveSchema(s);
      if (!r || depth > 2) return;
      const props = r.type === 'array' ? this.resolveSchema(r.items)?.properties : r.properties;
      const req = new Set((r.type === 'array' ? this.resolveSchema(r.items)?.required : r.required) ?? []);
      for (const [key, sub] of Object.entries(props ?? {})) {
        const child = this.resolveSchema(sub);
        const itemType = child?.type === 'array' ? `${this.resolveSchema(child.items)?.type || 'object'}[]` : '';
        rows.push({
          name: prefix + key,
          type: itemType || child?.type || 'object',
          required: req.has(key),
          desc: [child?.description, this.constraintsOf(child)].filter(Boolean).join(' — '),
        });
        if (child?.properties || this.resolveSchema(child?.items)?.properties) {
          walk(child, `${prefix}${key}${child?.type === 'array' ? '[]' : ''}.`, depth + 1);
        }
      }
    };
    walk(resolved, '', 0);
    if (!rows.length) return nothing;
    return html`
      <table class="kv">
        <thead><tr><th>${this.t('field')}</th><th class="c-type">${this.t('type')}</th><th>${this.t('description')}</th></tr></thead>
        <tbody>${rows.map(r => html`
          <tr>
            <td><span class="key-name">${r.name}</span>${r.required ? html` <span class="badge req">${this.t('required')}</span>` : nothing}</td>
            <td class="c-type"><span class="type-tag">${r.type}</span></td>
            <td class="dim">${r.desc}</td>
          </tr>`)}
        </tbody>
      </table>
    `;
  }

  private renderDocsTab(op: OperationInfo) {
    const jsonBody = op.requestBody?.content?.['application/json'];
    const responseEntries = Object.entries(op.responses ?? {});
    return html`
      ${op.description ? html`<div class="sub-title">${this.t('description')}</div><p class="doc-text">${op.description}</p>` : nothing}
      ${jsonBody?.schema ? html`
        <div class="sub-title">${this.t('requestBody')}<span class="ct">application/json</span></div>
        ${this.renderSchemaTable(jsonBody.schema)}
        <pre class="code mt">${unsafeHTML(hljson(JSON.stringify(jsonBody.example ?? this.example(jsonBody.schema) ?? {}, null, 2)))}</pre>
      ` : nothing}
      ${responseEntries.length ? html`
        <div class="sub-title">${this.t('responses')}</div>
        ${responseEntries.map(([code, res]) => {
          const content = res.content?.['application/json'];
          const example = content?.example ?? this.example(content?.schema);
          return html`
            <details class="resp-doc" ?open=${code.startsWith('2')}>
              <summary>
                <span class="status-pill ${statusClass(Number(code) || 0)}">${code}</span>
                <span>${res.description || STATUS_TEXT[Number(code)] || ''}</span>
                ${icon('chevron', 'chev')}
              </summary>
              ${content?.schema ? this.renderSchemaTable(content.schema) : nothing}
              ${example !== undefined ? html`<pre class="code mt">${unsafeHTML(hljson(JSON.stringify(example, null, 2)))}</pre>` : nothing}
            </details>`;
        })}
      ` : nothing}
      ${!op.description && !jsonBody?.schema && !responseEntries.length ? this.emptyState('info', this.t('docs')) : nothing}
    `;
  }

  private renderCodeTab(op: OperationInfo) {
    const snippet = this.snippetFor(op);
    const langs: { id: 'curl' | 'fetch' | 'axios'; label: string }[] = [
      { id: 'curl', label: 'cURL' }, { id: 'fetch', label: 'fetch' }, { id: 'axios', label: 'axios' },
    ];
    return html`
      <div class="code-bar">
        <div class="seg inline">
          ${langs.map(l => html`
            <button class=${this.codeLang === l.id ? 'on' : ''} @click=${() => { this.codeLang = l.id; }}>${l.label}</button>`)}
        </div>
        <span class="spacer"></span>
        <button class="btn sm" @click=${() => this.copyText(snippet)}>${icon('copy')}${this.t('copy')}</button>
      </div>
      <pre class="code">${snippet}</pre>
    `;
  }

  /* ---------------------------- JSON response viewer ---------------------------- */

  private respScroll = false;

  /** Match counter + current-match highlight; runs after each render. */
  private syncResponseSearch(): void {
    const counter = this.querySelector<HTMLElement>('.resp-count');
    if (!counter) return;
    const marks = [...this.querySelectorAll<HTMLElement>('.resp-card mark.hit')];
    if (!this.respSearch.trim()) { counter.textContent = ''; return; }
    if (!marks.length) { counter.textContent = '0'; return; }
    const index = ((this.respHit % marks.length) + marks.length) % marks.length;
    marks.forEach((m, i) => m.classList.toggle('cur', i === index));
    counter.textContent = `${index + 1}/${marks.length}`;
    if (this.respScroll) {
      this.respScroll = false;
      marks[index].scrollIntoView({ block: 'nearest' });
    }
  }

  private respSearchResult(): SearchResult | null {
    const needle = this.respSearch.trim();
    if (!needle || this.lastResponseJson === null) return null;
    const cached = this.respSearchCache;
    if (cached && cached.json === this.lastResponseJson && cached.needle === needle) return cached.result;
    const result = searchJson(this.lastResponseJson, needle);
    this.respSearchCache = { json: this.lastResponseJson, needle, result };
    return result;
  }

  /** Wraps search matches in <mark> (text stays escaped by Lit). */
  private marked(text: string): unknown {
    if (!this.respSearch.trim()) return text;
    return splitMatches(text, this.respSearch).map(p => (p.hit ? html`<mark class="hit">${p.text}</mark>` : p.text));
  }

  private renderResponseBody() {
    const json = this.lastResponseJson;
    if (this.resRaw || json === null) {
      const text = this.resRaw && json !== null ? JSON.stringify(json) : this.responseText;
      return html`<pre class="code flush">${text.length > RAW_HIGHLIGHT_LIMIT ? text : this.marked(text)}</pre>`;
    }
    const search = this.respSearchResult();
    return html`
      <div class="code flush jt" role="group" aria-label=${this.t('response')}
        @click=${(e: Event) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>('[data-path]');
          if (el) this.pickJsonValue(el.dataset.path!);
        }}>${this.renderJsonNode(json, '', null, 0, true, search)}</div>
      ${search && search.count === 0 ? html`<div class="jt-none">${this.t('noMatches')}</div>` : nothing}`;
  }

  private jsonIsOpen(path: string, depth: number, search: SearchResult | null): boolean {
    if (search?.open.has(path)) return true;
    const byDefault = depth < this.jsonOpenDepth;
    return this.jsonToggled.has(path) ? !byDefault : byDefault;
  }

  private toggleJson(path: string): void {
    const next = new Set(this.jsonToggled);
    if (next.has(path)) next.delete(path); else next.add(path);
    this.jsonToggled = next;
  }

  /** Clicking a value fills the capture row with its path, ready to save as a {{variable}}. */
  private pickJsonValue(path: string): void {
    this.capturePath = path;
    this.captureName = suggestName(path);
    void this.updateComplete.then(() => (this.querySelector('.capture input') as HTMLInputElement | null)?.select());
  }

  private renderJsonNode(value: unknown, path: string, key: string | number | null, depth: number, last: boolean,
    search: SearchResult | null): unknown[] {
    const comma = last ? '' : ',';
    const keyPart = typeof key === 'string' ? html`<span class="j-key">"${this.marked(key)}"</span>: ` : nothing;
    const line = (content: unknown) => html`<div class="jl" style="--d:${depth}">${content}</div>`;
    if (!isContainer(value)) {
      const kind = typeof value === 'string' ? 'str' : typeof value === 'number' ? 'num' : 'bool';
      return [line(html`${keyPart}<span class="j-${kind} jv" data-path=${path} title=${`${path || '$'} — ${this.t('clickToCapture')}`}>${this.marked(literal(value))}</span>${comma}`)];
    }
    const isArray = Array.isArray(value);
    const [openB, closeB] = isArray ? ['[', ']'] : ['{', '}'];
    const entries: [string | number, unknown][] = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
    if (!entries.length) return [line(html`${keyPart}${openB}${closeB}${comma}`)];
    const open = this.jsonIsOpen(path, depth, search);
    const name = typeof key === 'string' ? key : typeof key === 'number' ? `[${key}]` : this.t('response');
    const toggle = html`<button class="jt-tog" aria-expanded=${String(open)}
      aria-label=${`${open ? this.t('collapse') : this.t('expand')} ${name}`}
      @click=${(e: Event) => { e.stopPropagation(); this.toggleJson(path); }}>${icon('chevron', open ? '' : 'closed')}</button>`;
    if (!open) {
      return [line(html`${toggle}${keyPart}<button class="jt-fold" @click=${(e: Event) => { e.stopPropagation(); this.toggleJson(path); }}>${openB} … ${closeB}</button><span class="jt-sum">${summary(value)}</span>${comma}`)];
    }
    // While searching, open containers list only the children that lead to a match.
    const visible = search
      ? entries.filter(([k]) => { const p = childPath(path, k); return search.hits.has(p) || search.open.has(p); })
      : entries;
    const limit = search || this.jsonShowAll.has(path) ? visible.length : Math.min(visible.length, JSON_PAGE);
    const out: unknown[] = [line(html`${toggle}${keyPart}${openB}`)];
    visible.slice(0, limit).forEach(([k, child], i) => {
      out.push(...this.renderJsonNode(child, childPath(path, k), k, depth + 1, i === limit - 1 && limit === entries.length, search));
    });
    const hidden = entries.length - limit;
    if (hidden > 0) {
      out.push(html`<div class="jl" style="--d:${depth + 1}">${search
        ? html`<span class="jt-sum">${this.t('hiddenNoMatch').replace('{n}', String(hidden))}</span>`
        : html`<button class="jt-more" @click=${(e: Event) => { e.stopPropagation(); this.jsonShowAll = new Set([...this.jsonShowAll, path]); }}>
            ${this.t('showMore').replace('{n}', String(hidden))}</button>`}</div>`);
    }
    out.push(line(html`${closeB}${comma}`));
    return out;
  }

  private renderResponsePanel() {
    const has = this.responseStatus > 0 || !!this.responseText;
    const headerCount = Object.keys(this.responseHeaders).length;
    const speed = this.responseMs < 300 ? 'fast' : this.responseMs < 1000 ? 'mid' : 'slow';
    return html`
      <section class="card resp-card ${has && !this.running ? statusClass(this.responseStatus) + '-edge' : ''}">
        <div class="card-head resp-head">
          <div class="resp-status">
            <span class="card-title">${this.t('response')}</span>
            ${has && !this.running ? keyed(this.respSeq, html`
              <span class="status-pill pop-in ${statusClass(this.responseStatus)}">
                ${this.responseStatus || 'ERR'} ${STATUS_TEXT[this.responseStatus] ?? ''}
              </span>
              ${this.responseMock ? html`<span class="mock-badge" title=${this.t('mockNote')}>${icon('bolt')}MOCK</span>` : nothing}
              <span class="meta speed-${speed}" title="Response time">${icon('clock')}${formatMs(this.responseMs)}</span>
              <span class="meta" title="Response size">${formatBytes(this.responseSize)}</span>`) : nothing}
          </div>
          ${has && !this.running ? html`
          <div class="resp-tools">
            <div class="seg inline">
              <button class=${this.resTab === 'body' ? 'on' : ''} @click=${() => { this.resTab = 'body'; }}>${this.t('body')}</button>
              <button class=${this.resTab === 'headers' ? 'on' : ''} @click=${() => { this.resTab = 'headers'; }}>
                ${this.t('headers')}${headerCount ? html`<span class="count">${headerCount}</span>` : nothing}
              </button>
            </div>
            ${this.resTab === 'body' && this.lastResponseJson !== null ? html`
              <div class="seg inline">
                <button class=${!this.resRaw ? 'on' : ''} @click=${() => { this.resRaw = false; }}>${this.t('pretty')}</button>
                <button class=${this.resRaw ? 'on' : ''} @click=${() => { this.resRaw = true; }}>${this.t('raw')}</button>
              </div>
              ${!this.resRaw && isContainer(this.lastResponseJson) ? html`
                <button class="btn ghost sm icon-only tree-all" title=${this.t('expandAll')} aria-label=${this.t('expandAll')}
                  @click=${() => { this.jsonOpenDepth = Infinity; this.jsonToggled = new Set(); this.jsonShowAll = new Set(); }}>${icon('rows')}</button>
                <button class="btn ghost sm icon-only tree-all" title=${this.t('collapseAll')} aria-label=${this.t('collapseAll')}
                  @click=${() => { this.jsonOpenDepth = 1; this.jsonToggled = new Set(); }}>${icon('columns')}</button>` : nothing}` : nothing}
            <label class="resp-search">
              ${icon('search')}
              <input type="search" .value=${this.respSearch} placeholder=${this.t('searchResponse')} aria-label=${this.t('searchResponse')}
                spellcheck="false"
                @input=${(e: Event) => { this.respSearch = (e.target as HTMLInputElement).value; this.respHit = 0; this.respScroll = true; }}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') { e.preventDefault(); this.respHit += e.shiftKey ? -1 : 1; this.respScroll = true; this.requestUpdate(); }
                  else if (e.key === 'Escape' && this.respSearch) { e.stopPropagation(); this.respSearch = ''; }
                }} />
              <span class="resp-count" aria-live="polite"></span>
            </label>
            <button class="btn ghost sm icon-only" title=${this.t('copy')} @click=${() => this.copyText(this.responseText)}>${icon('copy')}</button>
            <button class="btn ghost sm icon-only" title=${this.t('download')} @click=${this.downloadResponse}>${icon('download')}</button>
          </div>` : nothing}
        </div>
        ${this.running
          ? html`<div class="skeleton" aria-label=${this.t('waiting')}>
              <div class="sk-line" style="width:38%"></div><div class="sk-line" style="width:72%"></div>
              <div class="sk-line" style="width:56%"></div><div class="sk-line" style="width:64%"></div>
              <div class="sk-caption"><span class="spinner"></span>${this.t('waiting')}</div>
            </div>`
          : this.responseError
            ? html`<div class="empty-state error" role="alert">${icon('alert')}<b>${this.responseError}</b>
                <button class="btn sm" @click=${this.send}>${icon('reset')}${this.t('retry')}</button></div>`
          : !has
            ? html`<div class="empty-state">${icon('send')}<b>${this.t('emptyResponse')}</b><span><kbd>${this.t('sendHint')}</kbd></span></div>`
            : this.resTab === 'body'
              ? this.renderResponseBody()
              : html`<table class="kv flush"><tbody>${Object.entries(this.responseHeaders)
                  .filter(([k, v]) => !this.respSearch.trim() || `${k} ${v}`.toLowerCase().includes(this.respSearch.trim().toLowerCase()))
                  .map(([k, v]) => html`
                  <tr><td><span class="key-name">${this.marked(k)}</span></td><td class="mono dim break">${this.marked(v)}</td></tr>`)}</tbody></table>`}
        ${has && !this.running && this.responseMock ? html`
          <div class="mock-note" role="note">${icon('info')}<span>${this.responseNote ? `${this.responseNote} — ` : ''}${this.t('mockNote')}</span></div>` : nothing}
        ${has && !this.running ? this.renderCaptureRow() : nothing}
      </section>
    `;
  }

  private renderScenarioDetail() {
    const sc = this.scenarios[this.scenarioIndex];
    if (!sc) return this.emptyState('layers', this.t('noScenarios'));
    const runs = this.scenarioRuns;
    const count = (state: StepRun['state']) => runs.filter(r => r.state === state).length;
    const passed = count('pass');
    const failed = count('fail');
    const done = passed + failed + count('skipped');
    const target = this.mockMode && this.mockPrefix() ? location.origin + this.mockPrefix() : this.baseUrl();
    const stateIcon = (r: StepRun, i: number) => r.state === 'running' ? html`<span class="spinner"></span>`
      : r.state === 'pass' ? icon('check') : r.state === 'fail' ? icon('x') : r.state === 'skipped' ? html`–` : html`${i + 1}`;
    const toggle = (i: number) => {
      const next = new Set(this.scenarioOpen);
      if (next.has(i)) next.delete(i); else next.add(i);
      this.scenarioOpen = next;
    };
    const sourceLabel = sc.source === 'recorded' ? this.t('recorded') : sc.source === 'imported' ? this.t('imported') : this.t('generated');
    return html`
      <div class="crumbs">
        <button @click=${this.goOverview}>${this.t('overview')}</button>
        <span class="sep">/</span><span>${this.t('scenarios')}</span>
      </div>
      <div class="req-title">
        <div class="req-title-text">
          <h1 dir="auto">${sc.name}</h1>
          <p class="desc">${sc.steps.length} ${this.t('steps')} · <span class="badge">${sourceLabel}</span> · ${this.t('scenarioHint')}</p>
        </div>
        <div class="title-actions">
          <button class="btn ghost sm" @click=${() => this.download(scenarioFileName(sc), toScenarioFile(sc), 'application/json')}>
            ${icon('download')}${this.t('exportScenario')}</button>
          <button class="btn ghost sm" ?disabled=${this.scenarioRunning}
            @click=${() => { this.scenarioDraft = this.scenarioDraft === null ? toScenarioFile(sc) : null; }}>
            ${icon('braces')}${this.scenarioDraft === null ? this.t('editJson') : this.t('cancel')}</button>
          ${sc.source === 'imported' ? html`<button class="btn ghost sm danger" ?disabled=${this.scenarioRunning}
            @click=${() => this.deleteScenario()}>${icon('trash')}${this.t('delete')}</button>` : nothing}
        </div>
      </div>

      ${this.renderUrlBar(
        html`<span class="m m-flow lg">FLOW</span>`,
        html`<input class="url-input" .value=${target} readonly aria-label=${this.t('baseUrl')} />`,
        this.scenarioRunning
          ? html`<button class="send-btn danger" @click=${this.cancelRequest} title=${this.t('cancelHint')}>
              <span class="spinner"></span><span>${this.t('stop')}</span>
            </button>`
          : html`<button class="send-btn" ?disabled=${this.scenarioDraft !== null} @click=${() => this.runCurrentScenario()}>
              ${icon('send')}<span>${done ? this.t('runAgain') : this.t('runAll')}</span>
            </button>`,
        false,
        this.renderMockSwitch(),
      )}

      <div class="scenario-bar">
        <label class="check-row"><input type="checkbox" .checked=${this.scenarioStopOnFail}
          @change=${(e: Event) => { this.scenarioStopOnFail = (e.target as HTMLInputElement).checked; }} />${this.t('stopOnFail')}</label>
        <span class="spacer"></span>
        ${done ? html`
          <div class="run-summary" role="status">
            <span class="pass">${icon('check')}${passed} ${this.t('passed')}</span>
            ${failed ? html`<span class="fail">${icon('x')}${failed} ${this.t('failed')}</span>` : nothing}
            ${this.scenarioMs ? html`<span class="meta">${icon('clock')}${formatMs(this.scenarioMs)}</span>` : nothing}
          </div>` : nothing}
      </div>
      ${done || this.scenarioRunning ? html`
        <div class="run-progress" aria-hidden="true">${runs.map(r => html`<span class="seg-${r.state}"></span>`)}</div>` : nothing}

      ${this.scenarioDraft !== null ? html`
        <section class="card">
          <div class="card-head"><span class="card-title">${this.t('editJson')}</span><span class="spacer"></span>
            ${this.jsonState(this.scenarioDraft)}
            <button class="btn primary sm" @click=${() => this.saveScenarioDraft()}>${icon('check')}${this.t('save')}</button></div>
          <div class="card-body">${this.renderEditor(this.scenarioDraft, v => { this.scenarioDraft = v; }, 'lg')}</div>
        </section>` : html`
        <ol class="steps">
          ${sc.steps.map((step, i) => this.renderStep(step, runs[i] ?? { state: 'pending', failures: [] }, i, stateIcon, toggle))}
        </ol>`}

      ${Object.keys(this.scenarioVars).length ? html`
        <section class="card">
          <div class="card-head"><span class="card-title">${this.t('capturedVars')}</span><span class="spacer"></span>
            <button class="btn sm" @click=${() => {
              for (const [k, v] of Object.entries(this.scenarioVars)) this.saveVar(k, v);
              this.showToast(this.t('varsSaved'));
            }}>${icon('variable')}${this.t('useVars')}</button></div>
          <div class="card-body vars-bar">
            ${Object.entries(this.scenarioVars).map(([k, v]) => html`<span class="var-chip" title=${v}><span>{{${k}}}</span></span>`)}
          </div>
        </section>` : nothing}
    `;
  }

  private renderStep(
    step: Scenario['steps'][number], r: StepRun, i: number,
    stateIcon: (r: StepRun, i: number) => unknown, toggle: (i: number) => void,
  ) {
    const open = this.scenarioOpen.has(i);
    const expected = step.expect?.status;
    const expectLabel = expected === undefined ? '2xx' : Array.isArray(expected) ? expected.join(' / ') : String(expected);
    const clip = (text: string) => (text.length > 20000 ? `${text.slice(0, 20000)}…` : text);
    return html`
      <li class="step ${r.state}">
        <button class="step-head" aria-expanded=${String(open)} @click=${() => toggle(i)}>
          <span class="step-ix">${stateIcon(r, i)}</span>
          ${this.methodPill(step.request.method)}
          <span class="step-text">
            <span class="step-name">${step.name}</span>
            <span class="step-path"><bdi dir="ltr">${r.url ?? step.request.path}</bdi></span>
          </span>
          ${r.status !== undefined ? html`<span class="status-pill ${statusClass(r.status)}">${r.status}</span>` : nothing}
          ${r.ms !== undefined ? html`<span class="meta">${formatMs(r.ms)}</span>` : nothing}
          ${icon('chevron', `chev ${open ? '' : 'closed'}`)}
        </button>
        <div class="step-chips">
          <span class="chip-x">${this.t('expects')} ${expectLabel}</span>
          ${step.expect?.bodyContains !== undefined ? html`<span class="chip-x">${this.t('bodyContains')}</span>` : nothing}
          ${step.expect?.matchesSpec ? html`<span class="chip-x">${this.t('matchesSpec')}</span>` : nothing}
          ${Object.entries(step.capture ?? {}).map(([name, path]) => html`
            <span class="chip-x cap ${r.captured?.[name] !== undefined ? 'got' : ''}" title=${path}>${icon('variable')}{{${name}}}</span>`)}
        </div>
        ${r.failures.length ? html`<ul class="step-failures">${r.failures.map(f => html`<li>${f}</li>`)}</ul>` : nothing}
        ${open ? html`
          <div class="step-detail">
            ${r.request || step.request.body !== undefined ? html`
              <div><div class="sub-title">${this.t('request')}</div>
                <pre class="code">${unsafeHTML(hljson(r.request ?? JSON.stringify(step.request.body, null, 2)))}</pre></div>` : nothing}
            <div><div class="sub-title">${this.t('response')}</div>
              ${r.response !== undefined
                ? html`<pre class="code">${unsafeHTML(hljson(clip(r.response)))}</pre>`
                : html`<div class="dim small">${this.t('notRunYet')}</div>`}</div>
          </div>` : nothing}
      </li>`;
  }

  private renderWsDetail() {
    const sel = this.wsSelected;
    if (!sel) return this.emptyState('arrows', this.t('selectWs'));
    const ev = sel.event;
    const status = this.wsStatusText();
    const connected = !!this.wsConn;
    return html`
      <div class="crumbs">
        <button @click=${this.goOverview}>${this.t('overview')}</button>
        <span class="sep">/</span><span>${sel.gateway.name}</span>
      </div>
      <div class="req-title">
        <div class="req-title-text">
          <h1 dir="auto">${ev.event}</h1>
          ${ev.summary || ev.description ? html`<p class="desc" dir="auto">${[ev.summary, ev.description].filter(Boolean).join(' — ')}</p>` : nothing}
        </div>
        <div class="title-actions">
          <span class="conn ${status.replace('…', '')}">${status}</span>
        </div>
      </div>

      ${this.renderUrlBar(
        this.methodPill('ws', 'lg'),
        html`<input class="url-input" aria-label=${this.t('requestUrl')} .value=${this.wsUrl} spellcheck="false"
          @input=${(e: Event) => { this.wsUrl = (e.target as HTMLInputElement).value; }} />`,
        html`<button class="send-btn ${connected ? 'danger' : ''}" @click=${this.wsToggle}>
          ${icon('plug')}<span>${connected ? this.t('disconnect') : this.t('connect')}</span>
        </button>`,
        false,
        html`<select class="url-select" aria-label=${this.t('transport')} title=${this.t('transport')} .value=${this.wsTransport} ?disabled=${connected}
          @change=${(e: Event) => { this.wsTransport = (e.target as HTMLSelectElement).value as WsTransport; }}>
          <option value="auto" ?selected=${this.wsTransport === 'auto'}>${this.t('autoDetect')}</option>
          <option value="socketio" ?selected=${this.wsTransport === 'socketio'}>Socket.IO</option>
          <option value="ws" ?selected=${this.wsTransport === 'ws'}>Raw WebSocket</option>
        </select>`,
      )}

      <div class="split">
        <section class="card">
          <div class="card-head">
            <span class="card-title">${this.t('composer')}</span>
            <span class="spacer"></span>
            ${this.jsonState(this.wsPayloadText)}
            <button class="btn ghost sm" @click=${() => this.beautify(this.wsPayloadText, v => { this.wsPayloadText = v; })}>
              ${icon('wand')}${this.t('beautify')}
            </button>
          </div>
          <div class="card-body composer">
            <label class="field"><span>${this.t('eventName')}</span>
              <input class="mono" .value=${this.wsEventName} spellcheck="false" placeholder="chat.send"
                @input=${(e: Event) => { this.wsEventName = (e.target as HTMLInputElement).value; }} />
            </label>
            <label class="field"><span>${this.t('payload')} <small>JSON</small></span></label>
            ${this.renderEditor(this.wsPayloadText, v => { this.wsPayloadText = v; }, 'sm', '{ }')}
            <button class="btn primary block" @click=${this.wsSend}>
              ${icon('send')}${this.t('send')}<kbd>${this.t('sendHint')}</kbd>
            </button>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <span class="card-title">${this.t('liveLog')}</span>
            ${this.wsLog.length ? html`<span class="count">${this.wsLog.length}</span>` : nothing}
            <span class="spacer"></span>
            <button class="btn ghost sm" ?disabled=${!this.wsLog.length} @click=${() => { this.wsLog = []; }}>
              ${icon('trash')}${this.t('clear')}
            </button>
          </div>
          <div class="log">
            ${this.wsLog.length === 0 ? this.emptyState('arrows', this.t('noMessages')) : nothing}
            ${this.wsLog.map(l => html`
              <div class="log-entry ${l.dir}">
                <div class="log-head">
                  <span class="log-dir">${l.dir === 'in' ? '↓' : l.dir === 'out' ? '↑' : '•'}</span>
                  <b>${l.label}</b>
                  <span class="log-time">${clock(l.at)}</span>
                </div>
                ${l.text && l.text !== 'null' ? html`<pre class="log-body">${l.dir === 'sys' ? l.text : unsafeHTML(hljson(l.text))}</pre>` : nothing}
              </div>`)}
          </div>
        </section>
      </div>

      ${ev.payload || ev.response ? html`
        <section class="card">
          <div class="card-head"><span class="card-title">${this.t('schema')}</span>
            ${ev.direction ? html`<span class="badge">${ev.direction}</span>` : nothing}</div>
          <div class="card-body split flat">
            ${ev.payload ? html`<div><div class="sub-title">${this.t('payload')}</div>
              ${this.renderSchemaTable(ev.payload)}
              <pre class="code mt">${unsafeHTML(hljson(JSON.stringify(this.example(ev.payload) ?? {}, null, 2)))}</pre></div>` : nothing}
            ${ev.response ? html`<div><div class="sub-title">${this.t('response')}</div>
              ${this.renderSchemaTable(ev.response)}
              <pre class="code mt">${unsafeHTML(hljson(JSON.stringify(this.example(ev.response) ?? {}, null, 2)))}</pre></div>` : nothing}
          </div>
          ${ev.emits?.length ? html`
            <div class="card-body emits">
              <div class="sub-title">${this.t('emits')}</div>
              ${ev.emits.map(e => html`
                <div class="emit-row">
                  <span class="m m-ws">↓</span><b class="mono">${e.event}</b>
                  ${e.payload ? html`<code class="dim">${JSON.stringify(this.example(e.payload) ?? {})}</code>` : nothing}
                </div>`)}
            </div>` : nothing}
        </section>` : nothing}
    `;
  }

  private renderGqlDetail() {
    const sel = this.gqlSelected;
    if (!sel) return this.emptyState('hex', this.t('selectGql'));
    const op = sel.operation;
    const isSub = op.kind === 'subscription';
    const busy = this.gqlRunning || !!this.gqlWs;
    return html`
      <div class="crumbs">
        <button @click=${this.goOverview}>${this.t('overview')}</button>
        ${sel.resolver.name === 'GraphQL' ? nothing : html`<span class="sep">/</span><span>GraphQL</span>`}
        <span class="sep">/</span><span>${sel.resolver.name}</span>
      </div>
      <div class="req-title">
        <div class="req-title-text">
          <h1 dir="auto">${op.name}</h1>
          ${op.summary ? html`<p class="desc" dir="auto">${op.summary}</p>` : nothing}
        </div>
      </div>

      ${this.renderUrlBar(
        this.methodPill(op.kind, 'lg'),
        html`<input class="url-input" aria-label=${this.t('requestUrl')} .value=${this.gqlUrl()} readonly />`,
        this.gqlRunning
          ? html`<button class="send-btn danger" @click=${this.cancelRequest} title=${this.t('cancelHint')}>
              <span class="spinner"></span><span>${this.t('cancel')}</span>
            </button>`
          : html`<button class="send-btn ${isSub && this.gqlWs ? 'danger' : ''}" @click=${this.runGql}>
              ${icon(isSub ? 'bolt' : 'send')}
              <span>${isSub ? (this.gqlWs ? this.t('stop') : this.t('subscribe')) : this.t('run')}</span>
            </button>`,
      )}

      <div class="split">
        <section class="card">
          <div class="card-head">
            <span class="card-title">${this.t('operation')}</span>
            <span class="spacer"></span>
            <button class="btn ghost sm" ?disabled=${!op.sample || this.gqlQueryText === op.sample}
              @click=${() => { this.gqlQueryText = op.sample || ''; }}>${icon('reset')}${this.t('reset')}</button>
          </div>
          <div class="card-body">
            ${this.renderEditor(this.gqlQueryText, v => { this.gqlQueryText = v; }, 'lg', 'query { … }')}
            <div class="editor-bar mt">
              <span class="sub-title inline">${this.t('variables')}</span>
              ${this.jsonState(this.gqlVarsText)}
              <span class="spacer"></span>
              <button class="btn ghost sm" @click=${() => this.beautify(this.gqlVarsText, v => { this.gqlVarsText = v; })}>
                ${icon('wand')}${this.t('beautify')}
              </button>
            </div>
            ${this.renderEditor(this.gqlVarsText, v => { this.gqlVarsText = v; }, 'sm', '{ }')}
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <span class="card-title">${this.t('response')}</span>
            ${this.gqlResponseMeta ? html`<span class="badge">${this.gqlResponseMeta}</span>` : nothing}
            <span class="spacer"></span>
            ${this.gqlResponseText ? html`
              <button class="btn ghost sm icon-only" title=${this.t('copy')} @click=${() => this.copyText(this.gqlResponseText)}>${icon('copy')}</button>` : nothing}
          </div>
          ${busy && !this.gqlResponseText
            ? html`<div class="loading"><span class="spinner"></span>${this.t('waiting')}</div>`
            : this.gqlResponseText
              ? html`<pre class="code flush tall">${this.gqlResponseText.length > RAW_HIGHLIGHT_LIMIT ? this.gqlResponseText : unsafeHTML(hljson(this.gqlResponseText))}</pre>`
              : html`<div class="empty-state">${icon('hex')}<b>${this.t('emptyResponse')}</b><span><kbd>${this.t('sendHint')}</kbd></span></div>`}
          ${this.gqlResponseText ? this.renderCaptureRow() : nothing}
        </section>
      </div>

      ${op.args?.length || op.response ? html`
        <section class="card">
          <div class="card-head"><span class="card-title">${this.t('schema')}</span></div>
          <div class="card-body">
            ${op.args?.length ? html`
              <div class="sub-title">Arguments</div>
              <table class="kv">
                <thead><tr><th>${this.t('field')}</th><th class="c-type">${this.t('type')}</th></tr></thead>
                <tbody>${op.args.map(a => html`
                  <tr><td><span class="key-name">${a.name}</span></td>
                  <td class="c-type"><span class="type-tag">${this.resolveSchema(a.schema)?.type ?? 'any'}</span></td></tr>`)}</tbody>
              </table>` : nothing}
            ${op.response ? html`
              <div class="sub-title">${this.t('response')}</div>
              ${this.renderSchemaTable(op.response)}
              <pre class="code mt">${unsafeHTML(hljson(JSON.stringify(this.example(op.response) ?? {}, null, 2)))}</pre>` : nothing}
          </div>
        </section>` : nothing}
    `;
  }

  render() {
    if (this.error) {
      return html`<div class="boot">${icon('alert')}<span>Failed to load spec — ${this.error}</span></div>`;
    }
    if (!this.spec) {
      return html`<div class="boot">
        <span class="logo boot-logo">${icon('logo')}</span>
        <span class="boot-text"><span class="spinner"></span>${this.t('loading')}</span>
      </div>`;
    }
    const viewKey = this.view === 'rest' ? `rest:${this.selected ? this.opId(this.selected) : ''}`
      : this.view === 'ws' ? `ws:${this.wsSelected?.event.event ?? ''}`
      : this.view === 'gql' ? `gql:${this.gqlSelected?.operation.name ?? ''}`
      : this.view === 'scenario' ? `scenario:${this.scenarioIndex}` : 'overview';
    // Wide mode lets split request/response (and WS/GQL two-pane) views use the screen.
    const wide = (this.view === 'rest' && this.splitView) || this.view === 'ws' || this.view === 'gql';
    return html`
      ${this.renderTopbar()}
      <div class="layout">
        <aside class=${this.sidebarOpen ? 'open' : ''}>
          ${this.renderSidebar()}
          <div class="side-resizer" title="Drag to resize · double-click to reset"
            @pointerdown=${this.startResize}
            @dblclick=${() => { this.setSideWidth(300); try { localStorage.setItem(SIDE_KEY, JSON.stringify({ w: 300, hidden: false })); } catch { /* ignore */ } }}></div>
        </aside>
        ${this.sidebarOpen ? html`<div class="scrim" @click=${() => { this.sidebarOpen = false; }}></div>` : nothing}
        <main>
          ${this.renderTabBar()}
          <div class="content ${wide ? 'wide' : ''}" data-view=${viewKey}>
            ${this.view === 'overview' ? this.renderOverview()
              : this.view === 'rest' ? this.renderRestDetail()
              : this.view === 'ws' ? this.renderWsDetail()
              : this.view === 'scenario' ? this.renderScenarioDetail()
              : this.renderGqlDetail()}
          </div>
        </main>
      </div>
      ${this.paletteOpen ? this.renderPalette() : nothing}
      ${this.toast ? html`<div class="toast" role="status">${icon('check')}<span>${this.toast}</span><i class="toast-bar"></i></div>` : nothing}
    `;
  }
}
