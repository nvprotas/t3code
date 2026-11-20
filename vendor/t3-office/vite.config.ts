import { defineConfig, type Plugin } from 'vite';

/**
 * T3 Code mobile build (replaces upstream's dev-server config): one self-contained index.html that the
 * app loads from its APK assets, where file:// cannot fetch module chunks.
 */
function inlineIntoHtml(): Plugin {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    name: 't3-office-inline',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!page || page.type !== 'asset') throw new Error('no index.html in the bundle');
      let html = String(page.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk') {
          const tag = new RegExp(`<script[^>]*src="[^"]*${escape(name)}"[^>]*></script>`);
          if (!tag.test(html)) throw new Error(`no script tag for ${name}`);
          const code = file.code.replace(/<\/script/gi, '<\\/script');
          html = html.replace(tag, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (name.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${escape(name)}"[^>]*>`);
          if (!tag.test(html)) throw new Error(`no stylesheet link for ${name}`);
          html = html.replace(tag, () => `<style>${String(file.source)}</style>`);
          delete bundle[name];
        }
      }
      page.source = html;
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [inlineIntoHtml()],
  build: {
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 4000,
  },
});
