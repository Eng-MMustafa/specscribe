/**
 * Request tabs and environment files (src/ui/lit/workspace.ts).
 */
import {
  closeTab, mergeEnvironments, openTab, parseEnvironmentFile, stepTab, toEnvironmentFile, type TabRef,
} from '../src/ui/lit/workspace';

const tab = (key: string): TabRef => ({ key, title: key, badge: 'GET' });

describe('request tabs', () => {
  it('opens new tabs at the end and focuses existing ones without duplicating', () => {
    let tabs = openTab([], tab('a'));
    tabs = openTab(tabs, tab('b'));
    tabs = openTab(tabs, { key: 'a', title: 'renamed', badge: 'POST' });
    expect(tabs.map((t) => t.key)).toEqual(['a', 'b']);
    expect(tabs[0]).toMatchObject({ title: 'renamed', badge: 'POST' });
  });

  it('drops the oldest tab when full, never the active one', () => {
    let tabs = ['a', 'b', 'c'].map(tab);
    tabs = openTab(tabs, tab('d'), 'a', 3);
    expect(tabs.map((t) => t.key)).toEqual(['a', 'c', 'd']);
  });

  it('closing the active tab activates its right neighbour, then the left one', () => {
    const tabs = ['a', 'b', 'c'].map(tab);
    expect(closeTab(tabs, 'b', 'b')).toEqual({ tabs: [tab('a'), tab('c')], active: 'c' });
    expect(closeTab(tabs, 'c', 'c').active).toBe('b');
    expect(closeTab(tabs, 'a', 'c')).toEqual({ tabs: [tab('b'), tab('c')], active: 'c' });
    expect(closeTab([tab('a')], 'a', 'a')).toEqual({ tabs: [], active: '' });
    expect(closeTab(tabs, 'zzz', 'a').tabs).toBe(tabs);
  });

  it('steps through tabs with wrap-around', () => {
    const tabs = ['a', 'b', 'c'].map(tab);
    expect(stepTab(tabs, 'c', 1)).toBe('a');
    expect(stepTab(tabs, 'a', -1)).toBe('c');
    expect(stepTab([], 'a', 1)).toBe('');
  });
});

describe('environment files', () => {
  const envs = [{ name: 'staging', baseUrl: 'https://staging.example.com', vars: { token: 't' }, allowCredentials: true }];

  it('round-trips our own file without the credential switch', () => {
    const file = toEnvironmentFile(envs);
    expect(JSON.parse(file)).toMatchObject({ format: 'specscribe-environments', version: 1 });
    expect(file).not.toContain('allowCredentials');
    expect(parseEnvironmentFile(file)).toEqual([{ ...envs[0], allowCredentials: false }]);
  });

  it('imports Postman environments, taking baseUrl from a variable', () => {
    const postman = {
      name: 'Prod', _postman_variable_scope: 'environment',
      values: [
        { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
        { key: 'apiKey', value: 'k', enabled: true },
        { key: 'old', value: 'x', enabled: false },
      ],
    };
    expect(parseEnvironmentFile(JSON.stringify(postman))).toEqual([{
      name: 'Prod', baseUrl: 'https://api.example.com', vars: { baseUrl: 'https://api.example.com', apiKey: 'k' }, allowCredentials: false,
    }]);
  });

  it('never trusts an imported file to send credentials, and rejects unsafe content', () => {
    // Written as text so `__proto__` is a real own key, as JSON.parse would make it.
    const file = '{"environments":[' +
      '{"name":"evil","baseUrl":"javascript:alert(1)","vars":{}},' +
      '{"name":"ok","baseUrl":"http://localhost:3000","allowCredentials":true,"vars":{"__proto__":{"polluted":1},"bad key":2,"good":3}}]}';
    const [only] = parseEnvironmentFile(file);
    expect(only).toEqual({ name: 'ok', baseUrl: 'http://localhost:3000', vars: { good: '3' }, allowCredentials: false });
    expect(() => parseEnvironmentFile('not json')).toThrow('Not a JSON file');
    expect(() => parseEnvironmentFile('{"foo":1}')).toThrow('No environments found');
  });

  it('replaces same-named environments on import and keeps the rest', () => {
    const existing = [
      { name: 'local', baseUrl: '', vars: {}, allowCredentials: true },
      { name: 'staging', baseUrl: 'old', vars: {}, allowCredentials: true },
    ];
    const merged = mergeEnvironments(existing, [{ name: 'staging', baseUrl: 'new', vars: {}, allowCredentials: false }]);
    expect(merged.map((e) => `${e.name}:${e.baseUrl}`)).toEqual(['local:', 'staging:new']);
  });
});
