/**
 * Pure helpers behind the collapsible JSON response viewer: stable paths for
 * every node (the same syntax the capture box accepts), path lookup, and the
 * search that decides which nodes must open to reveal a match.
 * No DOM and no Lit, so it is unit tested under Node.
 */

export type JsonSegment = string | number;

const IDENT = /^[A-Za-z_$][\w$]*$/;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/** `childPath('', 'data')` → `data`, `childPath('data', 0)` → `data[0]`, odd keys → `["a.b"]`. */
export function childPath(parent: string, key: JsonSegment): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  if (IDENT.test(key)) return parent ? `${parent}.${key}` : key;
  return `${parent}[${JSON.stringify(key)}]`;
}

/** Inverse of `childPath`; also accepts a leading `$` / `$.`. Returns null for malformed input. */
export function parsePath(path: string): JsonSegment[] | null {
  const src = path.trim().replace(/^\$\.?/, '');
  const out: JsonSegment[] = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === '.') { i++; continue; }
    if (src[i] === '[' && src[i + 1] === '"') {
      // Quoted key: scan the JSON string (it may contain `.`, `]` or `\"`).
      let j = i + 2;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      if (src[j + 1] !== ']') return null;
      try { out.push(JSON.parse(src.slice(i + 1, j + 1)) as string); } catch { return null; }
      i = j + 2;
      continue;
    }
    if (src[i] === '[') {
      const m = /^\[(\d+)\]/.exec(src.slice(i));
      if (!m) return null;
      out.push(Number(m[1]));
      i += m[0].length;
      continue;
    }
    const m = /^[^.[\]]+/.exec(src.slice(i));
    if (!m) return null;
    out.push(m[0]);
    i += m[0].length;
  }
  return out;
}

/** Value at `path` (see `childPath`), or undefined. Never walks prototype keys. */
export function getAt(value: unknown, path: string): unknown {
  const segments = parsePath(path);
  if (!segments) return undefined;
  let node: unknown = value;
  for (const seg of segments) {
    if (node === null || typeof node !== 'object') return undefined;
    if (typeof seg === 'string' && UNSAFE.has(seg)) return undefined;
    if (typeof seg === 'number' && !Array.isArray(node)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(node, seg)) return undefined;
    node = (node as Record<string | number, unknown>)[seg];
  }
  return node;
}

export function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

/** `{ … } 3 keys` / `[ … ] 12 items` — what a collapsed node shows. */
export function summary(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (isContainer(value)) {
    const n = Object.keys(value).length;
    return `${n} ${n === 1 ? 'key' : 'keys'}`;
  }
  return '';
}

/** Number of nodes, counted up to `limit` (cheap "is this response big?" check). */
export function countNodes(value: unknown, limit = 5000): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length && count < limit) {
    const node = stack.pop();
    count++;
    if (Array.isArray(node)) for (const child of node) stack.push(child);
    else if (isContainer(node)) for (const child of Object.values(node)) stack.push(child);
  }
  return count;
}

/** How a primitive is printed in the viewer (JSON literal syntax). */
export function literal(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

export interface SearchResult {
  /** Container paths that must be open to reveal every match. */
  open: Set<string>;
  /** Paths whose key or primitive value matches. */
  hits: Set<string>;
  count: number;
}

/**
 * Case-insensitive search over keys and primitive values. Stops after
 * `maxHits` matches so a one-letter query on a huge response stays fast.
 */
export function searchJson(value: unknown, needle: string, maxHits = 500): SearchResult {
  const result: SearchResult = { open: new Set(), hits: new Set(), count: 0 };
  const query = needle.trim().toLowerCase();
  if (!query) return result;
  const visit = (node: unknown, path: string, key: string, ancestors: string[]): void => {
    if (result.count >= maxHits) return;
    const keyHit = key.toLowerCase().includes(query);
    const valueHit = !isContainer(node) && literal(node).toLowerCase().includes(query);
    if (keyHit || valueHit) {
      result.hits.add(path);
      result.count++;
      for (const a of ancestors) result.open.add(a);
    }
    if (!isContainer(node)) return;
    const next = [...ancestors, path];
    if (Array.isArray(node)) node.forEach((child, i) => visit(child, childPath(path, i), '', next));
    else for (const [k, child] of Object.entries(node)) visit(child, childPath(path, k), k, next);
  };
  visit(value, '', '', []);
  return result;
}

/** Splits `text` around case-insensitive occurrences of `needle` (for <mark> wrapping). */
export function splitMatches(text: string, needle: string): { text: string; hit: boolean }[] {
  const query = needle.trim().toLowerCase();
  if (!query) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(query); i !== -1; i = lower.indexOf(query, i + query.length)) {
    if (i > at) parts.push({ text: text.slice(at, i), hit: false });
    parts.push({ text: text.slice(i, i + query.length), hit: true });
    at = i + query.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

/** A capture-variable name suggested from a path: `data.items[0].id` → `id`, `[2]` → `item`. */
export function suggestName(path: string): string {
  const segments = parsePath(path) ?? [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (typeof seg === 'string') return seg.replace(/[^\w-]/g, '_') || 'value';
  }
  return 'item';
}
