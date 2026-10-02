/**
 * Helpers behind the collapsible JSON response viewer (src/ui/lit/json-view.ts).
 */
import {
  childPath, countNodes, getAt, literal, parsePath, searchJson, splitMatches, suggestName, summary,
} from '../src/ui/lit/json-view';

describe('JSON viewer paths', () => {
  const data = { data: { items: [{ id: 7, 'a.b': 'dot', 'x]"y': 1 }] }, list: [[1, 2]] };

  it('builds paths the capture box understands, and reads them back', () => {
    const items = childPath(childPath('data', 'items'), 0);
    expect(items).toBe('data.items[0]');
    expect(childPath(items, 'id')).toBe('data.items[0].id');
    expect(childPath('', 0)).toBe('[0]');
    expect(childPath(items, 'a.b')).toBe('data.items[0]["a.b"]');
    for (const key of ['id', 'a.b', 'x]"y']) {
      const p = childPath(items, key);
      expect(getAt(data, p)).toBe((data.data.items[0] as Record<string, unknown>)[key]);
    }
    expect(getAt(data, 'list[0][1]')).toBe(2);
    expect(getAt([{ id: 3 }], '[0].id')).toBe(3);
    expect(getAt(data, '$.data.items[0].id')).toBe(7);
  });

  it('rejects malformed paths and never walks prototype keys', () => {
    expect(parsePath('a[')).toBeNull();
    expect(parsePath('a["unterminated')).toBeNull();
    expect(getAt(data, 'data[x]')).toBeUndefined();
    // lodash-style `items.0` is accepted too.
    expect(getAt(data, 'data.items.0.id')).toBe(7);
    expect(getAt({}, '__proto__')).toBeUndefined();
    expect(getAt({}, 'constructor')).toBeUndefined();
    expect(getAt({ a: 1 }, 'a.b')).toBeUndefined();
  });

  it('summarises and counts nodes', () => {
    expect(summary([1])).toBe('1 item');
    expect(summary([1, 2])).toBe('2 items');
    expect(summary({ a: 1 })).toBe('1 key');
    expect(summary(5)).toBe('');
    expect(countNodes(data)).toBe(11);
    expect(countNodes(Array.from({ length: 100 }), 20)).toBe(20);
    expect(literal('a"b')).toBe('"a\\"b"');
    expect(literal(null)).toBe('null');
  });

  it('searches keys and values, opening the containers that hold matches', () => {
    const res = searchJson({ users: [{ name: 'Ada' }, { name: 'Bob', role: 'admin' }] }, 'ad');
    expect([...res.hits].sort()).toEqual(['users[0].name', 'users[1].role']);
    expect([...res.open].sort()).toEqual(['', 'users', 'users[0]', 'users[1]']);
    expect(res.count).toBe(2);
    expect(searchJson({ a: 1 }, '  ').count).toBe(0);
    expect(searchJson(Array.from({ length: 1000 }, () => ({ x: 'hit' })), 'hit', 10).count).toBe(10);
  });

  it('splits text around matches for highlighting', () => {
    expect(splitMatches('Ada and ada', 'ADA')).toEqual([
      { text: 'Ada', hit: true }, { text: ' and ', hit: false }, { text: 'ada', hit: true },
    ]);
    expect(splitMatches('abc', '')).toEqual([{ text: 'abc', hit: false }]);
  });

  it('suggests a variable name from a path', () => {
    expect(suggestName('data.items[0].id')).toBe('id');
    expect(suggestName('[2]')).toBe('item');
    expect(suggestName('x["a b"]')).toBe('a_b');
  });
});
