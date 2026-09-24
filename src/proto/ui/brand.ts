// The look of the HUD: our own mark (a faceted two-peak ridge with a road running along its foot,
// on a lime tile with one corner cut) and the low-poly ridge that sits behind headings. The ridge
// is drawn in the current mode's colours, so it turns blue for rail and orange for stops.

export const NAME = 'Untitled'; // working title

export function markSvg(cls = 'mark') {
  return `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path fill="#5cb83a" d="M0 0H25L32 7V32H0Z"/>
    <path fill="#0f3322" d="M3 25L12 8.5L11 25Z"/><path fill="#1f5e3f" d="M12 8.5L17 17L11 25Z"/>
    <path fill="#174a31" d="M11 25L17 17L22 25Z"/><path fill="#0f3322" d="M17 17L22 11.5L22 25Z"/>
    <path fill="#2a7a50" d="M22 11.5L29 25H22Z"/>
    <path d="M3 29.3C10 26.7 20 30.9 29 27.7" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}

// The compass needle, pointing up: red to the north, white to the south.
export const needleSvg = () => `<svg class="needle" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path fill="#ff5a44" d="M12 1.5L16.2 12H7.8Z"/><path fill="#f4f1e8" d="M7.8 12H16.2L12 22.5Z"/><circle cx="12" cy="12" r="1.6" fill="#0f3322"/></svg>`;

// A ridge line across the box; each span between two points is split into a lit and a shaded
// facet, the lit one on the side facing the light (up the slope from the left).
const TOPS: [number, number][] = [[0, 40], [16, 30], [30, 36], [52, 16], [70, 28], [92, 8], [112, 26], [132, 18], [152, 34], [176, 12], [198, 26], [218, 16], [240, 24]];
const RIDGE = (() => {
  const B = 48, out: string[] = [];
  for (let i = 0; i + 1 < TOPS.length; i++) {
    const [x0, y0] = TOPS[i], [x1, y1] = TOPS[i + 1], up = y1 < y0;
    out.push(`<path class="${up ? 'r1' : 'r2'}" d="M${x0} ${y0}L${x1} ${y1}L${x0} ${B}Z"/>`);
    out.push(`<path class="${up ? 'r2' : 'r3'}" d="M${x1} ${y1}L${x1} ${B}L${x0} ${B}Z"/>`);
  }
  return out.join('');
})();
export const ridgeSvg = (cls = 'ridge') => `<svg class="${cls}" viewBox="0 0 240 48" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">${RIDGE}</svg>`;
