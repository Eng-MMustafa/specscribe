/** SpecScribe | Developed by Mohamed Mustafa | MIT License **/
// Bundles the Lit docs UI into a single self-contained IIFE that
// DocsPageRenderer inlines into the generated HTML page.
import { build, transform } from 'esbuild';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import * as path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(root, '../src/ui/lit/main.ts');
const outfile = path.resolve(root, '../src/ui/lit/lit-docs.bundle.js');

// `import css from './styles.css'` → minified CSS string. Nesting is kept
// as-is (no browser target), so the stylesheet stays scoped and compact.
const cssAsMinifiedText = {
  name: 'css-as-minified-text',
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /\.css$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const { code } = await transform(source, { loader: 'css', minify: true });
      return { contents: `export default ${JSON.stringify(code.trim())};`, loader: 'js' };
    });
  },
};

await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile,
  logLevel: 'info',
  plugins: [cssAsMinifiedText],
});
