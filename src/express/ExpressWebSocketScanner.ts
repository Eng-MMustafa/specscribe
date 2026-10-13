/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as fs from 'fs';
import * as path from 'path';
import { friendlyNames } from './ExpressNaming';
import { balancedSlice, isStringLiteral, matchBracket, objectEntries, splitTopLevel, stripComments, unquote } from './ExpressLexical';
import { ExpressSymbolRegistry } from './ExpressSymbolRegistry';
import { ExpressResponseInference } from './ExpressResponseInference';

export type WsTransport = 'socket.io' | 'ws';

export interface ExpressWebSocketEvent {
  event: string;
  summary?: string;
  /** Shape of the payload the client sends. */
  payload?: any;
  /** Shape of the acknowledgement the handler calls back with. */
  response?: any;
  /** Events the handler emits back (`socket.emit('x', …)`, `io.to(r).emit('x', …)`). */
  emits?: { event: string; payload?: any }[];
}

export interface ExpressWebSocketGateway {
  name: string;
  filePath: string;
  namespace?: string;
  transport: WsTransport;
  events: ExpressWebSocketEvent[];
  /**
   * How a message is framed on a plain WebSocket: `event-data` sends
   * `{ event, data }`; `raw` sends the payload itself (the endpoint reads a
   * discriminator such as `type` from it).
   */
  frame?: 'event-data' | 'raw';
}

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', 'test', 'tests', '__tests__']);
const IGNORED_EVENTS = new Set(['connection', 'disconnect', 'disconnecting', 'connect', 'connect_error', 'reconnect', 'error']);
const CALLBACK_NAMES = /^(cb|callback|ack|ackFn|done|respond|reply|fn|next)$/i;

/**
 * The block comment that ends `text`, if any: the closest one — not a match
 * starting at the first comment of the file, which swallowed every comment in
 * between and gave every event the same summary.
 */
function lastBlockComment(text: string): [string, string] | null {
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed.endsWith('*/')) return null;
  const start = trimmed.lastIndexOf('/*', trimmed.length - 3);
  if (start === -1) return null;
  return [trimmed.slice(start), trimmed.slice(start + 2, -2).replace(/^\*/, '')];
}

/**
 * Heuristic scanner for Socket.IO events in Express/Node.js projects.
 *
 * It looks for `socket.on('eventName', handler)` calls and groups them as one
 * gateway per file — the common `io.on('connection', (socket) => …)` pattern.
 * From each handler it reads the payload shape (destructured parameters and
 * `payload.field` accesses), the acknowledgement (`callback({...})`) and the
 * events it emits back. The transport comes from what the project imports.
 */
export class ExpressWebSocketScanner {
  static scan(sourcePath: string): ExpressWebSocketGateway[] {
    const absolutePath = path.resolve(sourcePath);
    if (!fs.existsSync(absolutePath)) return [];

    const files = this.collectFiles(absolutePath);
    const texts = new Map(files.map((file) => [file, this.read(file)]));
    const transport = this.detectTransport([...texts.values()]);
    // Event names and namespaces are often constants (`socket.on(EVENTS.JOIN, …)`).
    const registry = new ExpressSymbolRegistry(absolutePath);
    const found: { file: string; events: ExpressWebSocketEvent[]; namespace?: string }[] = [];

    for (const [file, raw] of texts) {
      if (!/socket\.on\s*\(/.test(raw) && !/io\.on\s*\(\s*['"]connection['"]/.test(raw)) continue;
      // `socket.on('message')` inside a plain-WebSocket route is not Socket.IO.
      if (/\bwebsocket\s*:\s*true\b|\bupgradeWebSocket\s*\(/.test(raw) && !/\bio\s*\.\s*(?:on|of)\s*\(/.test(raw)) continue;
      const text = stripComments(raw);
      const resolve = (expr: string) => registry.resolveString(expr, file);
      const events = this.extractEvents(raw, text, resolve);
      if (events.length > 0) found.push({ file, events, namespace: this.namespaceOf(text, resolve) });
    }

    // `websocket/orders.gateway.js` reads as `OrdersGateway`, like a Nest gateway.
    const names = friendlyNames(found.map((f) => f.file));
    const gateways: ExpressWebSocketGateway[] = found.map(({ file, events, namespace }) => ({
      name: names.get(file) || path.basename(file, path.extname(file)),
      filePath: file,
      namespace,
      transport,
      events,
    }));

    // Plain WebSocket routes: Fastify (`@fastify/websocket`) and Hono (`upgradeWebSocket`).
    const rawFiles = [...texts].filter(([, raw]) => /\bwebsocket\s*:\s*true\b|\bupgradeWebSocket\s*\(/.test(raw));
    const rawNames = friendlyNames(rawFiles.map(([file]) => file));
    for (const [file, raw] of rawFiles) {
      const endpoints = this.extractRawEndpoints(raw, stripComments(raw));
      const base = rawNames.get(file) || path.basename(file, path.extname(file));
      for (const endpoint of endpoints) {
        gateways.push({
          name: endpoints.length > 1 ? `${base} ${endpoint.path}` : base,
          filePath: file,
          namespace: endpoint.path,
          transport: 'ws',
          frame: 'raw',
          events: endpoint.events,
        });
      }
    }
    return gateways;
  }

  /**
   * `fastify.get('/ws', { websocket: true }, (socket) => …)` and
   * `app.get('/ws', upgradeWebSocket((c) => ({ onMessage(event, ws) { … } })))`.
   * Messages are told apart by a field such as `type` (`switch (msg.type)` /
   * `msg.type === 'ping'`); without one the endpoint gets a single `message`.
   */
  private static extractRawEndpoints(raw: string, text: string): { path: string; events: ExpressWebSocketEvent[] }[] {
    const routes = /\.(?:get|all|route)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:\{[^{}]*\bwebsocket\s*:\s*true\b[^{}]*\}|(?:[\w$.]+\s*,\s*)*upgradeWebSocket\s*\()/g;
    const out: { path: string; events: ExpressWebSocketEvent[] }[] = [];
    let m: RegExpExecArray | null;
    while ((m = routes.exec(text)) !== null) {
      const open = text.indexOf('(', m.index);
      const close = matchBracket(text, open);
      const body = close === -1 ? text.slice(m.index) : text.slice(open, close);
      const routePath = m[1].startsWith('/') ? m[1] : `/${m[1]}`;
      const summary = this.commentBefore(raw, routePath);

      const names = new Set<string>();
      let key = '';
      const compare = /\.\s*(type|event|action|op|kind)\s*===?\s*['"`]([\w:./-]+)['"`]/g;
      let c: RegExpExecArray | null;
      while ((c = compare.exec(body)) !== null) { key ||= c[1]; names.add(c[2]); }
      const switched = /switch\s*\(\s*[\w$]+\s*\.\s*(\w+)\s*\)\s*\{/.exec(body);
      if (switched) {
        key ||= switched[1];
        const block = balancedSlice(body, body.indexOf('{', switched.index + switched[0].length - 1));
        const cases = /case\s+['"`]([\w:./-]+)['"`]\s*:/g;
        while ((c = cases.exec(block)) !== null) names.add(c[1]);
      }

      // `socket.send(JSON.stringify({...}))` / `ws.send(JSON.stringify({...}))` is the reply.
      const sent = /\.send\s*\(\s*JSON\.stringify\s*\(/.exec(body);
      let response: any;
      if (sent) {
        const argOpen = body.indexOf('(', sent.index + sent[0].length - 1);
        const argClose = matchBracket(body, argOpen);
        const arg = argClose === -1 ? '' : (splitTopLevel(body.slice(argOpen + 1, argClose - 1), ',')[0] || '').trim();
        response = arg ? ExpressResponseInference.expressionSchema(arg)?.schema : undefined;
      }

      const events: ExpressWebSocketEvent[] = names.size
        ? [...names].map((name) => ({
            event: name,
            summary: summary || `Send ${name}`,
            payload: { type: 'object', properties: { [key]: { type: 'string', enum: [name] } }, required: [key] },
            ...(response ? { response } : {}),
          }))
        : [{ event: 'message', summary: summary || 'Send a message', payload: {}, ...(response ? { response } : {}) }];
      out.push({ path: routePath, events });
      routes.lastIndex = close === -1 ? text.length : close;
    }
    return out;
  }

  /** A line or JSDoc comment directly above the route that mounts `routePath`. */
  private static commentBefore(raw: string, routePath: string): string | undefined {
    const escaped = routePath.replace(/[.*+?^$()|[\]\\{}]/g, (ch) => `\\${ch}`);
    const at = raw.search(new RegExp(`\\.(?:get|all|route)\\s*\\(\\s*['"\`]${escaped}['"\`]`));
    if (at === -1) return undefined;
    const lineStart = raw.lastIndexOf('\n', at) + 1;
    const before = raw.slice(0, lineStart).replace(/[ \t]+$/, '').replace(/\s+$/, '');
    const block = lastBlockComment(before);
    if (block) {
      const line = block[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).find((l) => l && !l.startsWith('@'));
      if (line) return line.replace(/\s*\.$/, '');
    }
    const last = before.split('\n').pop() || '';
    const comment = /^\s*\/\/\s*(.+)$/.exec(last);
    return comment ? comment[1].trim().replace(/\s*\.$/, '') : undefined;
  }

  /**
   * The `/docs-ws-json` document: same shape as the Nest one, without the
   * absolute file paths (the browser has no use for them).
   */
  static buildDocument(gateways: ExpressWebSocketGateway[], info: { title: string; version: string }): any {
    return {
      generator: 'specscribe',
      info,
      gateways: gateways.map(({ name, namespace, transport, events, frame }) => ({ name, namespace, transport, events, ...(frame ? { frame } : {}) })),
    };
  }

  /**
   * `socket.io` / `socket.io-client` imports mean Socket.IO; the `ws` package
   * (`new WebSocketServer`, `new WebSocket.Server`) means plain WebSockets.
   */
  static detectTransport(texts: string[]): WsTransport {
    const all = texts.join('\n');
    if (/(?:require\s*\(\s*|from\s+)['"]socket\.io['"]/.test(all)) return 'socket.io';
    if (/(?:require\s*\(\s*|from\s+)['"]ws['"]|new\s+WebSocket(?:\.Server|Server)\s*\(/.test(all)) return 'ws';
    return 'socket.io';
  }

  private static read(file: string): string {
    try { return fs.readFileSync(file, 'utf-8'); } catch { return ''; }
  }

  /** `io.of('/orders').on('connection', …)` → `/orders`. */
  /**
   * `io.of('/chat').on('connection', …)`, and `const chat = io.of(NAMESPACE);
   * chat.on('connection', …)` with the namespace written as a constant.
   */
  private static namespaceOf(text: string, resolve: (expr: string) => string | undefined = () => undefined): string | undefined {
    const ofCall = /\.of\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = ofCall.exec(text)) !== null) {
      const open = text.indexOf('(', m.index);
      const close = matchBracket(text, open);
      if (close === -1) continue;
      const arg = splitTopLevel(text.slice(open + 1, close - 1), ',')[0] || '';
      const value = isStringLiteral(arg.trim()) ? unquote(arg.trim()) : resolve(arg);
      if (!value) continue;
      return value.startsWith('/') ? value : `/${value}`;
    }
    return undefined;
  }


  private static collectFiles(dir: string, out: string[] = [], depth = 0): string[] {
    if (depth > 8) return out;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          this.collectFiles(full, out, depth + 1);
        }
      } else if (entry.isFile() && /\.(js|ts|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(full);
      }
    }

    return out;
  }

  private static extractEvents(
    raw: string,
    text: string,
    resolve: (expr: string) => string | undefined = () => undefined,
  ): ExpressWebSocketEvent[] {
    const events: ExpressWebSocketEvent[] = [];
    const seen = new Set<string>();
    const eventPattern = /socket\.on\s*\(/g;

    let match: RegExpExecArray | null;
    while ((match = eventPattern.exec(text)) !== null) {
      const open = text.indexOf('(', match.index);
      const close = matchBracket(text, open);
      const args = close === -1 ? [] : splitTopLevel(text.slice(open + 1, close - 1), ',');
      const nameArg = (args[0] || '').trim();
      // `'join'` or a constant: `EVENTS.JOIN`, `EVENTS['JOIN']`, `\`${NS}:join\``.
      const eventName = isStringLiteral(nameArg) ? unquote(nameArg) : resolve(nameArg);
      if (!eventName || args.length < 2 || IGNORED_EVENTS.has(eventName) || seen.has(eventName)) continue;
      seen.add(eventName);
      const handler = (args[1] || '').trim();
      events.push({
        event: eventName,
        summary: this.commentAbove(raw, nameArg) || `Handle ${eventName}`,
        ...this.analyzeHandler(handler),
      });
    }

    return events;
  }

  /** A line or JSDoc comment directly above `socket.on(<nameArg>` (a literal or a constant). */
  private static commentAbove(raw: string, nameArg: string): string | undefined {
    const escaped = nameArg.replace(/[.*+?^$()|[\]\\{}]/g, (c) => `\\${c}`).replace(/\s+/g, '\\s*');
    const at = raw.search(new RegExp(`socket\\.on\\s*\\(\\s*${escaped}`));
    if (at === -1) return undefined;
    const before = raw.slice(0, at).replace(/[ \t]+$/, '');
    const block = lastBlockComment(before);
    if (block) {
      const line = block[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).find((l) => l && !l.startsWith('@'));
      if (line) return line.replace(/\s*\.$/, '');
    }
    const lines = before.split('\n');
    const last = lines[lines.length - 1].trim() === '' ? lines[lines.length - 2] : lines[lines.length - 1];
    const comment = /^\s*\/\/\s*(.+)$/.exec(last || '');
    return comment ? comment[1].trim().replace(/\s*\.$/, '') : undefined;
  }

  /** Payload, ack and emitted events of `(payload, callback) => { … }`. */
  private static analyzeHandler(handler: string): Pick<ExpressWebSocketEvent, 'payload' | 'response' | 'emits'> {
    const fn = /^(?:async\s+)?(?:function\s*[\w$]*\s*)?\(([^)]*)\)\s*(?:=>)?\s*([\s\S]*)$/.exec(handler)
      || /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>\s*([\s\S]*)$/.exec(handler);
    if (!fn) return {};
    const params = this.splitParams(fn[1]);
    const body = fn[2] || '';
    const result: Pick<ExpressWebSocketEvent, 'payload' | 'response' | 'emits'> = {};

    const callbackIndex = params.findIndex((p, i) => i > 0 && CALLBACK_NAMES.test(p));
    const payloadParam = params[0] && !(CALLBACK_NAMES.test(params[0]) && params.length === 1) ? params[0] : '';
    if (payloadParam) result.payload = this.payloadSchema(payloadParam, body);

    const callback = callbackIndex !== -1 ? params[callbackIndex] : params.find((p, i) => i > 0 && /^[A-Za-z_$][\w$]*$/.test(p));
    if (callback) {
      const ack = this.callArgument(body, new RegExp(`(?<![\\w$.])${callback}\\s*\\(`));
      const literal = ack ? ExpressResponseInference.expressionSchema(ack) : null;
      if (literal) result.response = literal.schema;
    }

    const emits: { event: string; payload?: any }[] = [];
    let reply: any;
    // `socket.emit(…)`, `io.emit(…)`, `io.to(room).emit(…)`, `socket.broadcast.emit(…)`.
    const emitPattern = /(?:([\w$]+)|\))\s*\.emit\s*\(\s*['"`]([^'"`]+)['"`]\s*(,)?/g;
    let m: RegExpExecArray | null;
    while ((m = emitPattern.exec(body)) !== null) {
      if (emits.some((e) => e.event === m![2])) continue;
      let payload: any;
      if (m[3]) {
        const open = body.indexOf('(', body.indexOf('.emit', m.index));
        const close = matchBracket(body, open);
        const arg = close === -1 ? '' : (splitTopLevel(body.slice(open + 1, close - 1), ',')[1] || '').trim();
        payload = arg ? ExpressResponseInference.expressionSchema(arg)?.schema : undefined;
      }
      emits.push({ event: m[2], ...(payload ? { payload } : {}) });
      // `socket.emit` answers the sender; `io.to(room).emit` is a broadcast.
      if (m[1] === 'socket' && payload && reply === undefined) reply = payload;
    }
    if (emits.length) result.emits = emits;
    if (!result.response && reply) result.response = reply;
    return result;
  }

  private static splitParams(list: string): string[] {
    return splitTopLevel(list, ',').map((p) => p.trim().replace(/\s*=[\s\S]*$/, '').replace(/:\s*[^,]+$/, '')).filter(Boolean);
  }

  /** `{ orderId, status }` → object; `orderId` → scalar unless `orderId.x` is read. */
  private static payloadSchema(param: string, body: string): any {
    if (param.startsWith('{')) {
      const properties: Record<string, any> = {};
      for (const entry of objectEntries(balancedSlice(param, 0).slice(1, -1))) {
        if (entry.spread) continue;
        properties[entry.key] = { type: ExpressResponseInference.typeFromName(entry.key) };
      }
      return { type: 'object', properties, required: Object.keys(properties) };
    }
    if (param.startsWith('[')) return { type: 'array', items: {} };
    const name = param.replace(/^\.\.\./, '');
    const fields = new Set<string>();
    const access = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\??\\.([A-Za-z_$][\\w$]*)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = access.exec(body)) !== null) fields.add(m[1]);
    const destructured = new RegExp(`(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${name.replace(/\$/g, '\\$')}\\b`).exec(body);
    if (destructured) {
      for (const entry of objectEntries(destructured[1])) if (!entry.spread) fields.add(entry.key);
    }
    if (fields.size) {
      const properties: Record<string, any> = {};
      for (const field of fields) properties[field] = { type: ExpressResponseInference.typeFromName(field) };
      return { type: 'object', properties };
    }
    // A bare scalar: ids travel as strings over the wire far more often than numbers.
    const type = /id$/i.test(name) ? 'string' : ExpressResponseInference.typeFromName(name);
    return { type: type === 'array' ? 'string' : type, description: name };
  }

  /** First argument of the first call matching `pattern` inside `body`. */
  private static callArgument(body: string, pattern: RegExp): string {
    const match = pattern.exec(body);
    if (!match) return '';
    const open = match.index + match[0].length - 1;
    const close = matchBracket(body, open);
    if (close === -1) return '';
    return (splitTopLevel(body.slice(open + 1, close - 1), ',')[0] || '').trim();
  }
}
