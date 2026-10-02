/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
import * as fs from 'fs';
import * as path from 'path';

export type DocsTheme = 'classic' | 'futuristic';

export interface DocsPageOptions {
  /** URL the Scalar UI fetches the OpenAPI document from, e.g. `/docs-json` */
  specUrl: string;
  /** Browser tab title */
  title?: string;
  /** Accent colour, must be a hex value such as `#00f2ff` */
  primaryColor?: string;
  /** `futuristic` renders dark mode, `classic` renders light mode */
  theme?: DocsTheme;
  /** UI language; currently `en` or `ar`. */
  language?: 'en' | 'ar';
  /** Optional favicon URL */
  faviconUrl?: string;
  /**
   * Full URL of a Scalar standalone bundle. When set, the docs page hosts the
   * Scalar UI from that URL instead of the built-in zero-dependency UI. This
   * is an explicit opt-in to an external asset.
   */
  scalarUrl?: string;
}

const DEFAULT_PRIMARY_COLOR = '#00f2ff';

/**
 * Escapes a value for safe interpolation inside an HTML text node or a
 * double-quoted attribute.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Accepts only well-formed hex colours. Anything else falls back to the default
 * so a malformed config value cannot inject arbitrary CSS into the page.
 */
export function sanitizeHexColor(value: string | undefined, fallback = DEFAULT_PRIMARY_COLOR): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed) ? trimmed : fallback;
}

/**
 * Renders the docs page.
 *
 * This is the built-in, fully self-contained UI: one inline script (the
 * pre-built Web Components bundle), system fonts, nothing loaded from a CDN —
 * it works offline, behind proxies and on air-gapped networks. Setting
 * `scalarUrl` opts in to hosting the Scalar UI from that URL instead, for
 * teams that already standardised on Scalar and self-host its bundle.
 *
 * Kept free of NestJS imports so it can be unit tested without a Nest context.
 */
export function renderDocsPage(options: DocsPageOptions): string {
  const theme: DocsTheme = options.theme === 'classic' ? 'classic' : 'futuristic';
  const primaryColor = sanitizeHexColor(options.primaryColor);
  const faviconTag = options.faviconUrl
    ? `\n  <link rel="icon" href="${escapeHtml(options.faviconUrl)}" />`
    : '';

  return options.scalarUrl
    ? renderScalarHostPage(options, theme, primaryColor, faviconTag)
    : renderBuiltInPage(options, theme, primaryColor, faviconTag);
}

/**
 * The built-in UI. The bundle is pre-built with `npm run ui:build`
 * (`scripts/build-ui.mjs`) and shipped in the package, so the rendered page is
 * self-contained — no CDN, no npm install at runtime.
 */
function renderBuiltInPage(
  options: DocsPageOptions,
  theme: DocsTheme,
  primaryColor: string,
  faviconTag: string,
): string {
  const title = escapeHtml(options.title || 'API Documentation');
  const specUrl = escapeHtml(options.specUrl);
  const lang = options.language === 'ar' ? 'ar' : 'en';
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const background = theme === 'classic' ? '#f5f6f8' : '#0b0e14';
  // `</script` inside the bundle would end the inline tag early.
  const bundle = readUiBundle().replace(/<\/script/gi, '<\\/script');

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <title>${title}</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="${theme === 'classic' ? 'light' : 'dark'}" />${faviconTag}
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: ${background}; }
    specscribe-docs { display: block; height: 100%; }
  </style>
  <script>${bundle}</script>
</head>
<body>
  <specscribe-docs spec-url="${specUrl}" theme="${theme}" language="${lang}" primary-color="${primaryColor}"></specscribe-docs>
</body>
</html>`;
}

let uiBundleCache: string | null = null;

/** Reads the shipped UI bundle. Cached — the file is read once per process. */
function readUiBundle(): string {
  if (uiBundleCache) return uiBundleCache;
  // Works from both `src/utils` (tests / ts-node) and `dist/utils` (packaged).
  const bundlePath = path.resolve(__dirname, '..', '..', 'src', 'ui', 'lit', 'lit-docs.bundle.js');
  uiBundleCache = fs.readFileSync(bundlePath, 'utf-8');
  return uiBundleCache;
}

/** The legacy Scalar host page, rendered only on explicit opt-in. */
function renderScalarHostPage(
  options: DocsPageOptions,
  theme: DocsTheme,
  primaryColor: string,
  faviconTag: string,
): string {
  const title = escapeHtml(options.title || 'API Documentation');
  const specUrl = escapeHtml(options.specUrl);
  const scalarUrl = escapeHtml(options.scalarUrl!);

  // Scalar reads its options from this attribute; `darkMode` is what actually
  // switches the rendered theme.
  const scalarConfig = escapeHtml(
    JSON.stringify({
      darkMode: theme === 'futuristic',
    }),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${title}</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />${faviconTag}
  <style>
    body {
      margin: 0;
      padding: 0;
      font-size: 17px;
      line-height: 1.6;
      letter-spacing: 0.1px;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;
    }
    :root {
      --scalar-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;
      --scalar-font-code: ui-monospace, 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    }
    .light-mode {
      --scalar-color-1: #141824;
      --scalar-color-2: rgba(20, 24, 36, 0.7);
      --scalar-color-3: rgba(20, 24, 36, 0.55);
      --scalar-color-accent: ${primaryColor};
      --scalar-background-1: #ffffff;
      --scalar-background-2: #f5f7fb;
      --scalar-background-3: #eef2f8;
      --scalar-background-accent: ${primaryColor}12;
      --scalar-border-color: rgba(20, 24, 36, 0.08);
    }
    .dark-mode {
      --scalar-color-1: rgba(246, 249, 255, 0.94);
      --scalar-color-2: rgba(226, 235, 248, 0.76);
      --scalar-color-3: rgba(205, 219, 238, 0.6);
      --scalar-color-accent: ${primaryColor};
      --scalar-background-1: #1a2130;
      --scalar-background-2: #222b3a;
      --scalar-background-3: #2b3548;
      --scalar-background-accent: ${primaryColor}1a;
      --scalar-border-color: rgba(214, 226, 242, 0.12);
    }
    .scalar-api-reference nav,
    .scalar-api-reference aside,
    .scalar-api-reference .sidebar,
    .scalar-api-reference .toc,
    .scalar-api-reference .toc a,
    .scalar-api-reference .sidebar a {
      font-size: 1.05rem;
      letter-spacing: 0.2px;
    }
    .group\\/button-label {
      font-size: large;
      font-weight: 600;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <script id="api-reference" data-url="${specUrl}" data-configuration="${scalarConfig}"></script>
  <script src="${scalarUrl}"></script>
</body>
</html>`;
}
