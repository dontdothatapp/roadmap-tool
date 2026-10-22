// Turns the demo build (dist/demo) into one self-contained HTML file: dist/demo/roadmap-demo.html.
// The demo keeps all data in the browser, so the file can be opened or hosted anywhere as a preview.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/demo';
const html = readFileSync(join(dir, 'index.html'), 'utf8');

// The server build serves its fonts as files next to the stylesheet; one file can't carry them, so their
// @font-face rules go and the demo loads the same families from Google Fonts instead.
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g)].map((m) =>
  readFileSync(join(dir, m[1]), 'utf8').replace(/@font-face\s*\{[^}]*\}/g, ''),
);
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g)].map((m) => readFileSync(join(dir, m[1]), 'utf8'));
if (js.length === 0) throw new Error('No script found in dist/demo/index.html');

const fonts = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400..700&display=swap';
const title = html.match(/<title>[^<]*<\/title>/)?.[0] ?? '<title>Roadmap Anywhere</title>';

const page = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  // Added by a script, so it doesn't hold up the first paint: the page shows in the fallback font and swaps when
  // the fonts arrive. (No onload attribute trick: a host's content policy may allow inline scripts but not those.)
  `<script>document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: ${JSON.stringify(fonts)} }))</script>`,
  ...css.map((c) => `<style>\n${c}\n</style>`),
  '<div id="root"></div>',
  ...js.map((j) => `<script type="module">\n${j.replace(/<\/script/gi, '<\\/script')}\n</script>`),
  '',
].join('\n');

writeFileSync(join(dir, 'roadmap-demo.html'), page);
console.log(`Wrote ${join(dir, 'roadmap-demo.html')} (${Math.round(page.length / 1024)} KB)`);
