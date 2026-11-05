import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Turns the build into one self-contained HTML file that runs when opened from
 * disk (`file://`), with no server: the entry script and stylesheet are inlined
 * into the page, and everything else must already be inlined by the build
 * (fonts as `data:` URLs, the engine and the worker via `workerFactory.single.ts`).
 *
 * The build fails if any other file would remain, so the result never refers to
 * a file that is not there.
 */
export function singleFile(options: { fileName: string; favicon: string }): Plugin {
  return {
    name: 'neuroform-single-file',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      const icon = `data:image/svg+xml;base64,${readFileSync(options.favicon).toString('base64')}`;
      return html
        .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="${icon}" />`)
        // Installation and the home-screen icon need a website; a local file has neither.
        .replace(/\s*<link rel="manifest"[^>]*>/, '')
        .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
        .replace(/\s*<meta name="(mobile-web-app-capable|apple-mobile-web-app-title)"[^>]*>/g, '');
    },
    generateBundle(_options, bundle) {
      const page = bundle['index.html'];
      if (!page || page.type !== 'asset') this.error('single-file build: index.html is missing from the bundle');
      let html = String(page.source);
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      for (const [name, item] of Object.entries(bundle)) {
        if (name === 'index.html') continue;
        if (item.type === 'chunk' && name.endsWith('.js')) {
          const tag = new RegExp(`<script[^>]*\\ssrc="\\./${esc(name)}"[^>]*></script>`);
          if (!tag.test(html)) this.error(`single-file build: no <script> refers to ${name}; is code splitting enabled?`);
          const code = inlineScript(item.code);
          // A function replacement, so `$` sequences in the code are not interpreted.
          html = html.replace(tag, () => `<script type="module">\n${code}\n</script>`);
          delete bundle[name];
        } else if (item.type === 'asset' && name.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*\\shref="\\./${esc(name)}"[^>]*>`);
          if (!tag.test(html)) this.error(`single-file build: no <link> refers to ${name}`);
          const css = String(item.source).replace(/<\/style/gi, '<\\/style');
          html = html.replace(tag, () => `<style>\n${css}\n</style>`);
          delete bundle[name];
        }
      }
      html = html.replace(/\s*<link rel="modulepreload"[^>]*>/g, '');

      const left = Object.keys(bundle).filter((f) => f !== 'index.html' && !f.endsWith('.map'));
      if (left.length) this.error(`single-file build: these files were not inlined: ${left.join(', ')}`);
      for (const f of Object.keys(bundle)) delete bundle[f];
      this.emitFile({ type: 'asset', fileName: options.fileName, source: html });
    },
  };
}

/**
 * Makes JavaScript safe to place inside a `<script>` element. The HTML parser
 * ends the element at `</script` and changes state at `<!--`; both can only
 * occur inside string, template or regular-expression literals in a module, where
 * `\/` and `\!` are equivalent identity escapes.
 */
function inlineScript(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}
