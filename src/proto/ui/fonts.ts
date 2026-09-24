// The HUD's two typefaces, bundled so the page needs no font server (both SIL Open Font Licence,
// via @fontsource): League Spartan, a heavy geometric sans in the Futura mould, for the wordmark,
// headings and tab labels; Archivo, a plain grotesque that stays legible small, for everything
// else. Only the Latin subset and the weights in use, and only woff2, which every current
// browser reads, rather than the woff fallbacks the stock stylesheets would also pull in.
import spartan700 from '@fontsource/league-spartan/files/league-spartan-latin-700-normal.woff2?url';
import archivo400 from '@fontsource/archivo/files/archivo-latin-400-normal.woff2?url';
import archivo600 from '@fontsource/archivo/files/archivo-latin-600-normal.woff2?url';
import archivo700 from '@fontsource/archivo/files/archivo-latin-700-normal.woff2?url';

const face = (family: string, weight: number, url: string) =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(${url}) format('woff2')}`;
const style = document.createElement('style');
style.textContent = [
  face('League Spartan', 700, spartan700),
  face('Archivo', 400, archivo400),
  face('Archivo', 600, archivo600),
  face('Archivo', 700, archivo700),
].join('\n');
document.head.appendChild(style);
