// Procedural product artwork for the store templates (no photos, no network, no copyright).
//
// A generated image is referenced from the store document by a compact string:
//   gen:<kind>:<bg>:<fg>:<accent>:<seed>[:w]
// e.g. "gen:tshirt:f4efe6:1f2937:f59e0b:2" (hex colours without '#'; ":w" = wide 16:9 hero art).
// artSvg(ref) renders it to a deterministic SVG string (pure JS: works in Node and the browser),
// artDataUrl(ref) to a data: URL. The exporter writes the SVG as images/<name>.svg.

export const isGen = ref => typeof ref === 'string' && ref.startsWith('gen:');
export const gen = (kind, bg, fg, accent, seed = 1, wide = false) =>
  `gen:${kind}:${bg.replace('#', '')}:${fg.replace('#', '')}:${accent.replace('#', '')}:${seed}${wide ? ':w' : ''}`;

export function parseGen(ref) {
  const [, kind, bg, fg, ac, seed, w] = String(ref).split(':');
  const hex = (s, d) => /^[0-9a-f]{6}$/i.test(s || '') ? '#' + s.toLowerCase() : d;
  return { kind: kind || 'box', bg: hex(bg, '#eeeeee'), fg: hex(fg, '#333333'), ac: hex(ac, '#ff6600'), seed: +seed || 1, wide: w === 'w' };
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16), f = c => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => f(c).toString(16).padStart(2, '0')).join('');
}

// Every shape draws inside a 400×400 box centred on (200, 200). f = main colour, a = accent, d = darker main.
const SHAPES = {
  tshirt: (f, a, d) => `<path d="M145 95 80 130l24 56 31-14v148h130V172l31 14 24-56-65-35c-8 18-28 30-55 30s-47-12-55-30z" fill="${f}"/><path d="M168 100c8 14 20 21 32 21s24-7 32-21" stroke="${a}" stroke-width="7" fill="none"/><rect x="160" y="200" width="80" height="34" rx="4" fill="${a}" opacity=".85"/>`,
  hoodie: (f, a, d) => `<path d="M150 100 82 140l18 150 36-8v40h128v-40l36 8 18-150-68-40z" fill="${f}"/><path d="M150 100c0 40 22 62 50 62s50-22 50-62c-10-20-30-30-50-30s-40 10-50 30z" fill="${d}"/><rect x="155" y="250" width="90" height="45" rx="10" fill="${d}"/><path d="M188 165v45M212 165v45" stroke="${a}" stroke-width="5"/>`,
  jacket: (f, a, d) => `<path d="M150 90 88 125l-10 200h60v-120 120h124v-120 120h60l-10-200-62-35-50 40z" fill="${f}"/><path d="M200 130v195" stroke="${d}" stroke-width="6"/><path d="M150 90l50 40 50-40" stroke="${a}" stroke-width="8" fill="none"/>`,
  dress: (f, a, d) => `<path d="M170 80h60l-8 60 70 190H108l70-190z" fill="${f}"/><path d="M170 80c10 20 50 20 60 0" stroke="${a}" stroke-width="6" fill="none"/><path d="M178 140h44" stroke="${a}" stroke-width="10"/>`,
  cap: (f, a, d) => `<path d="M105 245a95 95 0 0 1 190 0z" fill="${f}"/><path d="M105 245h215a14 14 0 0 1 0 28H105z" fill="${d}"/><circle cx="200" cy="150" r="9" fill="${a}"/><path d="M200 152v92" stroke="${a}" stroke-width="4" opacity=".6"/>`,
  tote: (f, a, d) => `<path d="M160 165v-35a40 40 0 0 1 80 0v35" stroke="${d}" stroke-width="11" fill="none"/><path d="M115 160h170l-12 175H127z" fill="${f}"/><circle cx="200" cy="245" r="32" fill="${a}"/>`,
  sneaker: (f, a, d) => `<path d="M70 265c0-35 12-70 36-92l46 8c18 34 60 48 108 50 46 2 76 16 86 40v22H70z" fill="${f}"/><rect x="66" y="288" width="276" height="26" rx="12" fill="${a}"/><path d="M150 195l20 25M170 190l20 25M190 188l18 26" stroke="${d}" stroke-width="6"/><path d="M110 250c40 6 120 6 200 0" stroke="${d}" stroke-width="5" fill="none"/>`,
  boot: (f, a, d) => `<path d="M140 90h80v150l90 30v50H120V180z" fill="${f}"/><rect x="116" y="300" width="198" height="24" rx="6" fill="${d}"/><path d="M150 120h60M150 150h60M150 180h60" stroke="${a}" stroke-width="6"/>`,
  watch: (f, a, d) => `<rect x="170" y="70" width="60" height="260" rx="16" fill="${d}"/><circle cx="200" cy="200" r="72" fill="${f}"/><circle cx="200" cy="200" r="56" fill="${a}" opacity=".9"/><path d="M200 200v-36M200 200l26 14" stroke="${d}" stroke-width="7" stroke-linecap="round"/>`,
  glasses: (f, a, d) => `<circle cx="140" cy="210" r="52" fill="${a}" opacity=".5" stroke="${f}" stroke-width="12"/><circle cx="260" cy="210" r="52" fill="${a}" opacity=".5" stroke="${f}" stroke-width="12"/><path d="M192 205q8-12 16 0M88 200 60 180M312 200l28-20" stroke="${f}" stroke-width="10" fill="none"/>`,
  ring: (f, a, d) => `<circle cx="200" cy="230" r="78" fill="none" stroke="${f}" stroke-width="22"/><path d="M200 112l32 30-32 34-32-34z" fill="${a}"/><path d="M168 142h64" stroke="#fff" stroke-width="3" opacity=".7"/>`,
  necklace: (f, a, d) => `<path d="M100 90c0 120 60 170 100 170s100-50 100-170" stroke="${f}" stroke-width="6" fill="none"/><path d="M200 260l26 30-26 40-26-40z" fill="${a}"/><circle cx="200" cy="262" r="8" fill="${f}"/>`,
  earrings: (f, a, d) => `<path d="M140 110v40M260 110v40" stroke="${f}" stroke-width="6"/><circle cx="140" cy="200" r="46" fill="none" stroke="${f}" stroke-width="10"/><circle cx="260" cy="200" r="46" fill="none" stroke="${f}" stroke-width="10"/><circle cx="140" cy="246" r="14" fill="${a}"/><circle cx="260" cy="246" r="14" fill="${a}"/>`,
  chair: (f, a, d) => `<path d="M135 95h130v140H135z" fill="${f}" rx="20"/><rect x="120" y="225" width="160" height="40" rx="12" fill="${d}"/><path d="M140 265l-14 80M260 265l14 80M160 265l-6 70M240 265l6 70" stroke="${a}" stroke-width="10" stroke-linecap="round"/>`,
  sofa: (f, a, d) => `<rect x="70" y="150" width="260" height="110" rx="26" fill="${d}"/><rect x="100" y="185" width="200" height="60" rx="14" fill="${f}"/><rect x="58" y="185" width="54" height="100" rx="20" fill="${f}"/><rect x="288" y="185" width="54" height="100" rx="20" fill="${f}"/><path d="M90 285v30M310 285v30" stroke="${a}" stroke-width="10" stroke-linecap="round"/>`,
  table: (f, a, d) => `<rect x="70" y="160" width="260" height="28" rx="8" fill="${f}"/><path d="M100 188l-10 140M300 188l10 140M140 188v110M260 188v110" stroke="${d}" stroke-width="14" stroke-linecap="round"/><circle cx="240" cy="140" r="18" fill="${a}"/><rect x="140" y="120" width="40" height="40" rx="6" fill="${a}" opacity=".7"/>`,
  lamp: (f, a, d) => `<path d="M140 90h120l30 90H110z" fill="${f}"/><path d="M200 180v130" stroke="${d}" stroke-width="10"/><ellipse cx="200" cy="320" rx="60" ry="14" fill="${d}"/><ellipse cx="200" cy="185" rx="90" ry="10" fill="${a}" opacity=".5"/>`,
  vase: (f, a, d) => `<path d="M170 90h60v30c40 30 60 70 60 110 0 60-40 100-90 100s-90-40-90-100c0-40 20-80 60-110z" fill="${f}"/><path d="M118 220h164" stroke="${a}" stroke-width="12"/><path d="M200 90c-10-40 30-60 40-70" stroke="${d}" stroke-width="5" fill="none"/>`,
  cushion: (f, a, d) => `<path d="M95 110q105-20 210 0 20 90 0 180-105 20-210 0-20-90 0-180z" fill="${f}"/><path d="M130 150h140M130 200h140M130 250h140" stroke="${a}" stroke-width="10" stroke-dasharray="20 14"/>`,
  candle: (f, a, d) => `<rect x="130" y="160" width="140" height="170" rx="14" fill="${f}"/><rect x="130" y="220" width="140" height="56" fill="${a}"/><path d="M200 160v-30" stroke="${d}" stroke-width="5"/><path d="M200 82c18 24 18 42 0 50-18-8-18-26 0-50z" fill="#ffb84d"/>`,
  mug: (f, a, d) => `<rect x="120" y="140" width="140" height="170" rx="18" fill="${f}"/><path d="M260 180h28a32 32 0 0 1 0 64h-28" stroke="${f}" stroke-width="16" fill="none"/><rect x="140" y="200" width="100" height="40" rx="8" fill="${a}"/><path d="M160 120q10-20 0-40M200 120q10-20 0-40" stroke="${d}" stroke-width="5" fill="none" opacity=".6"/>`,
  cup: (f, a, d) => `<path d="M135 130h130l-14 200h-102z" fill="${f}"/><rect x="128" y="112" width="144" height="26" rx="8" fill="${d}"/><rect x="140" y="200" width="120" height="50" fill="${a}"/>`,
  box: (f, a, d) => `<path d="M200 90l120 50v130l-120 50-120-50V140z" fill="${f}"/><path d="M80 140l120 50 120-50M200 190v130" stroke="${d}" stroke-width="6" fill="none"/><path d="M140 115l120 50v40" stroke="${a}" stroke-width="12" fill="none"/>`,
  bag: (f, a, d) => `<path d="M110 150h180l-14 180H124z" fill="${f}"/><path d="M160 150v-20a40 40 0 0 1 80 0v20" stroke="${d}" stroke-width="10" fill="none"/><path d="M110 150h180" stroke="${a}" stroke-width="10"/>`,
  headphones: (f, a, d) => `<path d="M110 230v-40a90 90 0 0 1 180 0v40" stroke="${f}" stroke-width="18" fill="none"/><rect x="88" y="215" width="54" height="100" rx="22" fill="${f}"/><rect x="258" y="215" width="54" height="100" rx="22" fill="${f}"/><rect x="100" y="235" width="30" height="60" rx="12" fill="${a}"/><rect x="270" y="235" width="30" height="60" rx="12" fill="${a}"/>`,
  laptop: (f, a, d) => `<rect x="105" y="105" width="190" height="140" rx="10" fill="${f}"/><rect x="117" y="117" width="166" height="116" rx="4" fill="${a}"/><path d="M75 255h250l-16 30H91z" fill="${d}"/>`,
  phone: (f, a, d) => `<rect x="140" y="70" width="120" height="260" rx="22" fill="${f}"/><rect x="150" y="90" width="100" height="210" rx="10" fill="${a}"/><circle cx="200" cy="315" r="6" fill="${d}"/>`,
  speaker: (f, a, d) => `<rect x="130" y="80" width="140" height="250" rx="20" fill="${f}"/><circle cx="200" cy="245" r="52" fill="${d}"/><circle cx="200" cy="245" r="24" fill="${a}"/><circle cx="200" cy="140" r="26" fill="${d}"/>`,
  camera: (f, a, d) => `<rect x="80" y="130" width="240" height="160" rx="20" fill="${f}"/><rect x="120" y="108" width="70" height="30" rx="8" fill="${d}"/><circle cx="200" cy="210" r="56" fill="${d}"/><circle cx="200" cy="210" r="34" fill="${a}"/>`,
  serum: (f, a, d) => `<rect x="150" y="160" width="100" height="170" rx="18" fill="${f}" opacity=".92"/><rect x="172" y="120" width="56" height="44" fill="${d}"/><path d="M182 120V90a18 18 0 0 1 36 0v30" fill="${a}"/><rect x="164" y="220" width="72" height="60" rx="6" fill="#fff" opacity=".7"/>`,
  jar: (f, a, d) => `<rect x="105" y="170" width="190" height="150" rx="28" fill="${f}"/><rect x="100" y="135" width="200" height="50" rx="14" fill="${d}"/><rect x="140" y="220" width="120" height="50" rx="8" fill="${a}"/>`,
  bottle: (f, a, d) => `<rect x="140" y="150" width="120" height="185" rx="30" fill="${f}"/><rect x="170" y="90" width="60" height="70" rx="10" fill="${d}"/><rect x="140" y="215" width="120" height="60" fill="${a}"/>`,
  perfume: (f, a, d) => `<rect x="115" y="170" width="170" height="150" rx="24" fill="${f}" opacity=".9"/><rect x="175" y="130" width="50" height="44" fill="${d}"/><rect x="160" y="95" width="80" height="40" rx="8" fill="${a}"/><rect x="150" y="230" width="100" height="40" rx="4" fill="#fff" opacity=".6"/>`,
  lipstick: (f, a, d) => `<rect x="160" y="200" width="80" height="130" rx="8" fill="${d}"/><rect x="168" y="160" width="64" height="48" fill="${a}"/><path d="M174 160v-50l52-30v80z" fill="${f}"/>`,
  palette: (f, a, d) => `<rect x="80" y="120" width="240" height="170" rx="22" fill="${d}"/>` + [0, 1, 2, 3, 4, 5].map(i => `<circle cx="${130 + (i % 3) * 70}" cy="${170 + Math.floor(i / 3) * 70}" r="26" fill="${[f, a, shade(f, .35), shade(a, -.3), shade(f, -.3), shade(a, .4)][i]}"/>`).join(''),
  coffeebag: (f, a, d) => `<path d="M130 100h140l12 230H118z" fill="${f}"/><path d="M130 100l14-20h112l14 20" fill="${d}"/><rect x="140" y="180" width="120" height="90" rx="6" fill="${a}"/><ellipse cx="200" cy="225" rx="18" ry="28" fill="${d}"/><path d="M200 200q-8 25 0 50" stroke="${a}" stroke-width="4" fill="none"/>`,
  croissant: (f, a, d) => `<path d="M80 250c20-80 80-120 120-120s100 40 120 120c-30 10-50-10-60-20-20 20-100 20-120 0-10 10-30 30-60 20z" fill="${f}"/><path d="M160 140q-10 50 0 105M240 140q10 50 0 105M200 130v118" stroke="${d}" stroke-width="7" fill="none"/>`,
  cake: (f, a, d) => `<rect x="100" y="190" width="200" height="120" rx="12" fill="${f}"/><path d="M100 200q25 30 50 0t50 0 50 0 50 0v-20H100z" fill="${a}"/><rect x="194" y="130" width="12" height="50" fill="${d}"/><path d="M200 102c12 14 12 26 0 30-12-4-12-16 0-30z" fill="#ffb84d"/>`,
  bread: (f, a, d) => `<path d="M90 230c0-70 50-110 110-110s110 40 110 110v60a20 20 0 0 1-20 20H110a20 20 0 0 1-20-20z" fill="${f}"/><path d="M150 160l-20 40M200 150l-10 50M250 160l-20 40" stroke="${d}" stroke-width="9" stroke-linecap="round"/>`,
  dish: (f, a, d) => `<ellipse cx="200" cy="235" rx="140" ry="60" fill="${shade(f, .75)}"/><ellipse cx="200" cy="225" rx="105" ry="40" fill="${f}"/><circle cx="170" cy="215" r="18" fill="${a}"/><circle cx="225" cy="225" r="14" fill="${d}"/><path d="M190 200q20-20 40 0" stroke="${a}" stroke-width="6" fill="none"/>`,
  pizza: (f, a, d) => `<circle cx="200" cy="210" r="120" fill="${d}"/><circle cx="200" cy="210" r="102" fill="${f}"/>` + [[160, 170], [240, 180], [190, 250], [250, 250], [150, 230]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" fill="${a}"/>`).join(''),
  plant: (f, a, d) => `<path d="M140 250h120l-14 80h-92z" fill="${a}"/><path d="M200 250c-8-50-50-80-80-90 10 40 40 80 80 90zM200 250c8-60 50-110 90-120-6 50-40 100-90 120zM200 250c0-60-10-110-20-150 30 30 40 90 20 150z" fill="${f}"/><rect x="132" y="240" width="136" height="20" rx="6" fill="${d}"/>`,
  book: (f, a, d) => `<path d="M120 90h150a10 10 0 0 1 10 10v220a10 10 0 0 1-10 10H120z" fill="${f}"/><rect x="108" y="90" width="22" height="240" rx="6" fill="${d}"/><rect x="160" y="140" width="90" height="12" rx="3" fill="${a}"/><rect x="160" y="165" width="70" height="8" rx="3" fill="${a}" opacity=".6"/>`,
  petbowl: (f, a, d) => `<path d="M90 230h220l-26 70H116z" fill="${f}"/><ellipse cx="200" cy="230" rx="110" ry="20" fill="${d}"/><circle cx="175" cy="222" r="10" fill="${a}"/><circle cx="205" cy="218" r="10" fill="${a}"/><circle cx="230" cy="224" r="10" fill="${a}"/><path d="M182 268l18-14 18 14" stroke="${a}" stroke-width="5" fill="none"/>`,
  bone: (f, a, d) => `<path d="M125 170a25 25 0 1 1 30-35l95 0a25 25 0 1 1 30 35 25 25 0 1 1-30 35h-95a25 25 0 1 1-30-35z" fill="${f}" transform="rotate(-20 200 180)"/><circle cx="270" cy="285" r="34" fill="${a}"/>`,
  ball: (f, a, d) => `<circle cx="200" cy="210" r="100" fill="${f}"/><path d="M110 170q90 40 180 0M110 250q90-40 180 0" stroke="${a}" stroke-width="10" fill="none"/>`,
  blocks: (f, a, d) => `<rect x="100" y="230" width="90" height="90" rx="10" fill="${f}"/><rect x="200" y="230" width="90" height="90" rx="10" fill="${a}"/><rect x="150" y="140" width="90" height="90" rx="10" fill="${d}"/><text x="195" y="200" font-family="Arial" font-weight="700" font-size="48" fill="#fff" text-anchor="middle">A</text>`,
  teddy: (f, a, d) => `<circle cx="140" cy="115" r="30" fill="${d}"/><circle cx="260" cy="115" r="30" fill="${d}"/><circle cx="200" cy="160" r="72" fill="${f}"/><ellipse cx="200" cy="285" rx="85" ry="65" fill="${f}"/><ellipse cx="200" cy="180" rx="30" ry="22" fill="${a}"/><circle cx="175" cy="145" r="7" fill="#222"/><circle cx="225" cy="145" r="7" fill="#222"/>`,
  rocket: (f, a, d) => `<path d="M200 70c50 40 60 120 40 190h-80c-20-70-10-150 40-190z" fill="${f}"/><circle cx="200" cy="160" r="22" fill="${a}"/><path d="M160 230l-40 50 46-10zM240 230l40 50-46-10z" fill="${d}"/><path d="M180 262q20 60 40 0" fill="#ffb84d"/>`,
  print: (f, a, d, s) => `<rect x="95" y="70" width="210" height="270" fill="#fff"/><rect x="110" y="85" width="180" height="240" fill="${shade(f, .82)}"/><circle cx="${170 + (s % 3) * 15}" cy="${170 + (s % 2) * 20}" r="${50 + (s % 4) * 6}" fill="${a}"/><path d="M110 ${270 - (s % 3) * 15}q60-${40 + s * 5} 180 0v55H110z" fill="${f}"/>`,
  file: (f, a, d) => `<path d="M130 70h100l50 50v210H130z" fill="${f}"/><path d="M230 70v50h50" fill="${d}"/><path d="M205 170v90M170 225l35 35 35-35" stroke="${a}" stroke-width="14" fill="none" stroke-linecap="round"/>`,
  vinyl: (f, a, d) => `<circle cx="200" cy="200" r="120" fill="${f}"/><circle cx="200" cy="200" r="95" fill="none" stroke="${d}" stroke-width="2"/><circle cx="200" cy="200" r="75" fill="none" stroke="${d}" stroke-width="2"/><circle cx="200" cy="200" r="40" fill="${a}"/><circle cx="200" cy="200" r="6" fill="${d}"/>`,
  wave: (f, a, d) => `<rect x="70" y="110" width="260" height="180" rx="20" fill="${f}"/>` + Array.from({ length: 13 }, (_, i) => { const h = 20 + Math.abs(Math.sin(i * 1.7)) * 100; return `<rect x="${92 + i * 17}" y="${200 - h / 2}" width="9" height="${h}" rx="4" fill="${a}"/>`; }).join(''),
  play: (f, a, d) => `<rect x="70" y="100" width="260" height="170" rx="18" fill="${f}"/><circle cx="200" cy="185" r="44" fill="${a}"/><path d="M188 162v46l38-23z" fill="#fff"/><rect x="150" y="285" width="100" height="14" rx="7" fill="${d}"/>`,
  chart: (f, a, d) => `<rect x="70" y="90" width="260" height="220" rx="16" fill="${f}"/>` + [[100, 230, 40, 1], [130, 200, 60, 0], [160, 180, 50, 1], [190, 150, 70, 1], [220, 160, 40, 0], [250, 120, 60, 1], [280, 110, 50, 1]].map(([x, y, h, up]) => `<path d="M${x + 7} ${y - 12}v${h + 24}" stroke="${up ? a : d}" stroke-width="3"/><rect x="${x}" y="${y}" width="14" height="${h}" fill="${up ? a : d}"/>`).join(''),
  target: (f, a, d) => `<circle cx="200" cy="200" r="120" fill="${f}"/><circle cx="200" cy="200" r="85" fill="#fff"/><circle cx="200" cy="200" r="50" fill="${f}"/><circle cx="200" cy="200" r="18" fill="${a}"/><path d="M200 200l90-90" stroke="${d}" stroke-width="8"/>`,
  grid: (f, a, d) => [0, 1, 2, 3].map(i => `<rect x="${100 + (i % 2) * 110}" y="${100 + Math.floor(i / 2) * 110}" width="90" height="90" rx="${i === 1 ? 45 : 12}" fill="${[f, a, d, f][i]}"/>`).join(''),
  dumbbell: (f, a, d) => `<rect x="120" y="190" width="160" height="20" rx="6" fill="${d}"/><rect x="80" y="140" width="36" height="120" rx="8" fill="${f}"/><rect x="284" y="140" width="36" height="120" rx="8" fill="${f}"/><rect x="60" y="160" width="24" height="80" rx="6" fill="${a}"/><rect x="316" y="160" width="24" height="80" rx="6" fill="${a}"/>`,
  kettlebell: (f, a, d) => `<path d="M150 170v-30a50 50 0 0 1 100 0v30" stroke="${d}" stroke-width="22" fill="none"/><circle cx="200" cy="240" r="90" fill="${f}"/><rect x="170" y="225" width="60" height="30" rx="6" fill="${a}"/>`,
  band: (f, a, d) => `<ellipse cx="200" cy="200" rx="120" ry="70" fill="none" stroke="${f}" stroke-width="22"/><ellipse cx="200" cy="215" rx="100" ry="55" fill="none" stroke="${a}" stroke-width="16"/>`,
  shaker: (f, a, d) => `<path d="M140 130h120l-10 200H150z" fill="${f}" opacity=".9"/><rect x="134" y="100" width="132" height="36" rx="8" fill="${d}"/><rect x="185" y="76" width="30" height="28" rx="6" fill="${a}"/><path d="M150 200h100" stroke="${a}" stroke-width="6"/>`,
  backpack: (f, a, d) => `<rect x="115" y="100" width="170" height="230" rx="40" fill="${f}"/><rect x="140" y="220" width="120" height="80" rx="14" fill="${d}"/><path d="M165 100v-20a35 35 0 0 1 70 0v20" stroke="${d}" stroke-width="10" fill="none"/><path d="M150 160h100" stroke="${a}" stroke-width="10"/>`,
  tent: (f, a, d) => `<path d="M200 90 330 320H70z" fill="${f}"/><path d="M200 90v230l-50 0z" fill="${d}"/><path d="M200 210 245 320h-90z" fill="${a}"/><path d="M200 90l-20-30M200 90l20-30" stroke="${d}" stroke-width="5"/>`,
  ticket: (f, a, d) => `<path d="M80 140h240v40a20 20 0 0 0 0 40v40H80v-40a20 20 0 0 0 0-40z" fill="${f}"/><path d="M240 140v120" stroke="${a}" stroke-width="5" stroke-dasharray="10 8"/><rect x="110" y="175" width="100" height="16" rx="4" fill="${a}"/><rect x="110" y="205" width="70" height="12" rx="4" fill="${d}"/>`,
};
export const ART_KINDS = Object.keys(SHAPES);

function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

export function artSvg(ref) {
  const { kind, bg, fg, ac, seed, wide } = parseGen(ref);
  const draw = SHAPES[kind] || SHAPES.box, d = shade(fg, -0.35), id = 'g' + kind + seed;
  const body = draw(fg, ac, d, seed);
  const W = wide ? 1600 : 600, H = wide ? 900 : 600;
  const bg2 = shade(bg, -0.08), spot = shade(bg, 0.35);
  // decorative circles positioned from the seed (deterministic)
  const r = n => ((Math.sin(seed * 9301 + n * 49297) + 1) / 2);
  const deco = wide
    ? `<circle cx="${300 + r(1) * 300}" cy="${200 + r(2) * 400}" r="${160 + r(3) * 120}" fill="${ac}" opacity=".18"/><circle cx="${1350}" cy="${150 + r(4) * 200}" r="${90 + r(5) * 60}" fill="${fg}" opacity=".1"/>`
    : `<circle cx="${80 + r(1) * 440}" cy="${60 + r(2) * 120}" r="${30 + r(3) * 50}" fill="${ac}" opacity=".16"/>`;
  const group = wide ? `<g transform="translate(860 110) scale(1.7)">` : `<g transform="translate(100 90)">`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(kind)}">` +
    `<defs><radialGradient id="${id}" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="${spot}"/><stop offset="1" stop-color="${bg2}"/></radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#${id})"/>${deco}` +
    `<ellipse cx="${wide ? 1200 : 300}" cy="${wide ? 760 : 500}" rx="${wide ? 300 : 170}" ry="${wide ? 34 : 22}" fill="#000" opacity=".12"/>` +
    `${group}${body}</g></svg>`;
}

export function artDataUrl(ref) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(artSvg(ref)); }
