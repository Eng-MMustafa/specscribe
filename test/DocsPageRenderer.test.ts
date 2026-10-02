import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StaticDocsExporter } from '../src/standalone/StaticDocsExporter';
import {
  escapeHtml,
  renderDocsPage,
  sanitizeHexColor,
} from '../src/utils/DocsPageRenderer';

describe('escapeHtml', () => {
  it('escapes characters that could break out of an attribute or tag', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a"b')).toBe('a&quot;b');
    expect(escapeHtml("a'b")).toBe('a&#39;b');
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes the ampersand first so entities are not double-encoded incorrectly', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('sanitizeHexColor', () => {
  it('accepts 3- and 6-digit hex colours', () => {
    expect(sanitizeHexColor('#fff')).toBe('#fff');
    expect(sanitizeHexColor('#00f2ff')).toBe('#00f2ff');
    expect(sanitizeHexColor('#A855F7')).toBe('#A855F7');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeHexColor('  #123456  ')).toBe('#123456');
  });

  it('rejects values that are not hex colours', () => {
    expect(sanitizeHexColor('red')).toBe('#00f2ff');
    expect(sanitizeHexColor('#12345')).toBe('#00f2ff');
    expect(sanitizeHexColor('')).toBe('#00f2ff');
    expect(sanitizeHexColor(undefined)).toBe('#00f2ff');
  });

  it('rejects CSS injection attempts', () => {
    expect(sanitizeHexColor('#fff; } body { display:none')).toBe('#00f2ff');
  });

  it('honours a custom fallback', () => {
    expect(sanitizeHexColor('nope', '#000000')).toBe('#000000');
  });
});

describe('renderDocsPage (built-in UI, default)', () => {
  it('fetches the OpenAPI document from the given spec URL', () => {
    const html = renderDocsPage({ specUrl: '/api/reference-json' });
    expect(html).toContain('<specscribe-docs spec-url="/api/reference-json"');
  });

  it('escapes the spec URL attribute', () => {
    const html = renderDocsPage({ specUrl: '/x" onload="alert(1)' });
    expect(html).not.toContain('onload="alert(1)"');
    expect(html).toContain('&quot;');
  });

  it('inlines the UI bundle without letting it close the script tag early', () => {
    const html = renderDocsPage({ specUrl: '/docs-json' });
    const inline = html.slice(html.indexOf('<script>') + '<script>'.length, html.indexOf('</script>'));
    expect(inline.length).toBeGreaterThan(50_000);
    expect(inline).toContain('specscribe-docs');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('is fully self-contained: no CDN, no external fonts, no external scripts', () => {
    const html = renderDocsPage({ specUrl: '/docs-json' });
    // Nothing on the page loads from the network: no script/style/font tags
    // pointing anywhere, and no CSS imports.
    expect(html).not.toContain('<script src');
    expect(html).not.toContain('<link href');
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).not.toContain('@import');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('cdn.');
  });

  it('starts dark for the futuristic theme', () => {
    const html = renderDocsPage({ specUrl: '/docs-json', theme: 'futuristic' });
    expect(html).toContain('theme="futuristic"');
    expect(html).toContain('content="dark"');
  });

  it('starts light for the classic theme', () => {
    const html = renderDocsPage({ specUrl: '/docs-json', theme: 'classic' });
    expect(html).toContain('theme="classic"');
    expect(html).toContain('content="light"');
  });

  it('defaults to the futuristic theme', () => {
    const html = renderDocsPage({ specUrl: '/docs-json' });
    expect(html).toContain('theme="futuristic"');
  });

  it('passes the primary colour to the UI', () => {
    const html = renderDocsPage({ specUrl: '/docs-json', primaryColor: '#a855f7' });
    expect(html).toContain('primary-color="#a855f7"');
  });

  it('falls back to the default colour for malformed input', () => {
    const html = renderDocsPage({ specUrl: '/docs-json', primaryColor: 'javascript:alert(1)' });
    expect(html).toContain('primary-color="#00f2ff"');
    expect(html).not.toContain('javascript:alert(1)');
  });

  it('defaults to English LTR', () => {
    const html = renderDocsPage({ specUrl: '/docs-json' });
    expect(html).toContain('lang="en"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('language="en"');
  });

  it('renders Arabic RTL when language is set to ar', () => {
    const html = renderDocsPage({ specUrl: '/docs-json', language: 'ar' });
    expect(html).toContain('lang="ar"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('language="ar"');
  });

  describe('ships every console in the bundle', () => {
    const html = renderDocsPage({ specUrl: '/docs-json' });

    it('only sends inherited credentials to trusted origins', () => {
      expect(html).toContain('allowCredentials');
    });

    it('executes GraphQL subscriptions over graphql-ws', () => {
      expect(html).toContain('graphql-ws');
      expect(html).toContain('connection_init');
    });

    it('auto-detects Socket.IO vs raw WebSocket', () => {
      expect(html).toContain('/socket.io/socket.io.js');
    });

    it('supports the mock server, scenarios and static inline documents', () => {
      expect(html).toContain('x-specscribe-mock');
      expect(html).toContain('scenarios-json');
      expect(html).toContain('specscribe-spec');
    });

    it('sends multipart uploads and URL-encoded forms', () => {
      expect(html).toContain('multipart/form-data');
      expect(html).toContain('application/x-www-form-urlencoded');
    });
  });
});

describe('renderDocsPage (Scalar opt-in)', () => {
  it('hosts the Scalar bundle only when scalarUrl is set', () => {
    const html = renderDocsPage({
      specUrl: '/docs-json',
      scalarUrl: '/assets/scalar.js',
    });
    expect(html).toContain('src="/assets/scalar.js"');
    expect(html).toContain('data-url="/docs-json"');
  });

  it('does not load fonts from a CDN even on the Scalar page', () => {
    const html = renderDocsPage({
      specUrl: '/docs-json',
      scalarUrl: '/assets/scalar.js',
    });
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
  });

  it('enables dark mode for the futuristic theme', () => {
    const html = renderDocsPage({
      specUrl: '/docs-json',
      theme: 'futuristic',
      scalarUrl: '/assets/scalar.js',
    });
    expect(html).toContain('&quot;darkMode&quot;:true');
  });

  it('disables dark mode for the classic theme', () => {
    const html = renderDocsPage({
      specUrl: '/docs-json',
      theme: 'classic',
      scalarUrl: '/assets/scalar.js',
    });
    expect(html).toContain('&quot;darkMode&quot;:false');
  });

  it('applies the primary colour to the Scalar accent variables', () => {
    const html = renderDocsPage({
      specUrl: '/docs-json',
      primaryColor: '#a855f7',
      scalarUrl: '/assets/scalar.js',
    });
    expect(html).toContain('--scalar-color-accent: #a855f7;');
  });
});

describe('renderDocsPage (shared behaviour)', () => {

  it('renders a favicon link when one is configured', () => {
    const html = renderDocsPage({ specUrl: '/docs-json', faviconUrl: '/logo.png' });
    expect(html).toContain('<link rel="icon" href="/logo.png" />');
  });

  it('renders the favicon on the Scalar page too', () => {
    const html = renderDocsPage({
      specUrl: '/docs-json',
      faviconUrl: '/logo.png',
      scalarUrl: '/assets/scalar.js',
    });
    expect(html).toContain('<link rel="icon" href="/logo.png" />');
  });

  it('omits the favicon link when none is configured', () => {
    const html = renderDocsPage({ specUrl: '/docs-json' });
    expect(html).not.toContain('rel="icon"');
  });

  it('uses the configured title', () => {
    const html = renderDocsPage({ specUrl: '/docs-json', title: 'Billing API' });
    expect(html).toContain('<title>Billing API</title>');
  });

  it('escapes the title so it cannot inject markup', () => {
    const html = renderDocsPage({ specUrl: '/docs-json', title: '</title><script>x()</script>' });
    expect(html).not.toContain('<script>x()</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('produces a complete HTML document', () => {
    const html = renderDocsPage({ specUrl: '/docs-json' });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
  });
});

describe('StaticDocsExporter security', () => {
  it('redacts absolute source paths from public artifacts', () => {
    const html = StaticDocsExporter.render({
      spec: { openapi: '3.0.0', paths: {}, filePath: path.resolve('private', 'controller.ts') },
      graphqlDocument: { resolvers: [{ filePath: path.resolve('private', 'schema.ts') }] },
    });
    expect(html).not.toContain(path.resolve('private'));
    expect(html).toContain('controller.ts');
    expect(html).toContain('schema.ts');
  });

  it('rejects a symlink output directory', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'specscribe-export-'));
    const target = path.join(parent, 'target');
    const link = path.join(parent, 'link');
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      expect(() => StaticDocsExporter.write(link, { spec: { openapi: '3.0.0', paths: {} } }))
        .toThrow(/must not be a symbolic link/);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});
