// Entrance animation of the commerce app (~2.1 s), a full-screen "store wireframe" sequence:
//   1. a blueprint grid flashes in and a large browser frame draws its outline (stroke-dash);
//   2. a store homepage wireframe draws itself inside it — nav (logo, links, cart), hero (headline, button, image
//      placeholder with an X), four product cards, footer — stroke by stroke with a slight stagger while a scan line sweeps;
//   3. the wireframe fills: colours and photo-like gradients fade in, a cursor glides to "Add to cart" and clicks, a
//      product dot flies to the cart and its badge pops "1";
//   4. the screen zooms into the frame and wipes away into the admin (CommerceApp then adds .caEnter for a moment).
// Desktop and phone get their own layout (chosen once from the window shape). Pure SVG + CSS keyframes
// (dist/css/commerce-intro.css, "caIntro*" / "ci*"). Click, Enter, Space or Esc skips it. With prefers-reduced-motion
// the finished store is shown still and cross-fades out.
import React, { useEffect, useRef } from 'react';

export const INTRO_MS = 2150;
const KEY = 'zertake-commerce-intro-seen';
let seenThisPage = false;

/** Default policy when the host does not decide: first open in this browser session. */
export function shouldPlayIntro() {
  if (seenThisPage) return false;
  try { if (sessionStorage.getItem(KEY)) return false; } catch { /* storage blocked: the module flag still limits it to once */ }
  return true;
}
export function markIntroSeen() { seenThisPage = true; try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ } }
const reduced = () => { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };
const isNarrow = () => { try { return window.innerWidth < 720 || window.innerWidth / window.innerHeight < 0.8; } catch { return false; } };

// ---------------------------------------------------------------- layouts
// Shapes: { k: 'rect'|'circle'|'line'|'path', …geometry, d: draw delay (ms), f: fill colour/gradient (optional), fd: fill delay }
// "x" adds an image placeholder cross. All times are absolute from the start of the intro.
function desktop() {
  const V = { w: 1600, h: 1000 }, F = { x: 100, y: 70, w: 1400, h: 860, r: 18, bar: 46 };
  const top = F.y + F.bar, L = 170, R = F.x + F.w - 70;
  const s = [];
  // nav
  s.push({ k: 'line', x1: F.x, y1: top + 72, x2: F.x + F.w, y2: top + 72, d: 300 });
  s.push({ k: 'circle', cx: L + 16, cy: top + 36, r: 17, d: 330, f: 'url(#ciGOrange)', fd: 1020 });
  s.push({ k: 'rect', x: L + 44, y: top + 30, w: 118, h: 13, r: 6.5, d: 360, f: '#1f1a17', fd: 1030 });
  [0, 1, 2, 3].forEach(i => s.push({ k: 'rect', x: 610 + i * 110, y: top + 31, w: 72, h: 10, r: 5, d: 380 + i * 25, f: '#6d625b', fd: 1040 }));
  s.push({ k: 'path', p: `M${R - 44} ${top + 22}h8l7 24h24l6-17h-34`, d: 470, ink: '#1f1a17', fd: 1040 });
  s.push({ k: 'circle', cx: R - 25, cy: top + 52, r: 3, d: 490, f: '#1f1a17', fd: 1050 });
  s.push({ k: 'circle', cx: R - 6, cy: top + 52, r: 3, d: 495, f: '#1f1a17', fd: 1050 });
  // hero
  const hy = top + 112;
  s.push({ k: 'rect', x: L, y: hy + 36, w: 540, h: 40, r: 8, d: 470, f: '#1f1a17', fd: 1060 });
  s.push({ k: 'rect', x: L, y: hy + 92, w: 430, h: 40, r: 8, d: 510, f: '#1f1a17', fd: 1070 });
  s.push({ k: 'rect', x: L, y: hy + 158, w: 470, h: 11, r: 5.5, d: 550, f: '#8a7f77', fd: 1080 });
  s.push({ k: 'rect', x: L, y: hy + 182, w: 380, h: 11, r: 5.5, d: 570, f: '#8a7f77', fd: 1085 });
  s.push({ k: 'rect', x: L, y: hy + 222, w: 196, h: 56, r: 28, d: 600, f: 'url(#ciGOrange)', fd: 1090, cls: 'ciHeroBtn' });
  s.push({ k: 'rect', x: L + 40, y: hy + 245, w: 116, h: 10, r: 5, d: 640, f: '#fff', fd: 1100 });
  s.push({ k: 'rect', x: 790, y: hy, w: R - 790, h: 300, r: 16, d: 520, f: 'url(#ciGHero)', fd: 1000, xmark: true, photo: 'hero' });
  // products
  const py = hy + 340, cw = (R - L - 3 * 32) / 4;
  for (let i = 0; i < 4; i++) {
    const x = L + i * (cw + 32), d = 640 + i * 60;
    s.push({ k: 'rect', x, y: py, w: cw, h: 190, r: 14, d, f: `url(#ciGP${i})`, fd: 1110 + i * 40, xmark: true, photo: 'p' + i });
    s.push({ k: 'rect', x, y: py + 208, w: cw * 0.58, h: 12, r: 6, d: d + 70, f: '#1f1a17', fd: 1150 + i * 40 });
    s.push({ k: 'rect', x, y: py + 232, w: cw * 0.28, h: 12, r: 6, d: d + 90, f: '#c2410c', fd: 1160 + i * 40 });
    s.push({ k: 'rect', x: x + cw - 116, y: py + 210, w: 116, h: 36, r: 18, d: d + 110, f: '#1f1a17', fd: 1170 + i * 40, cls: i === 1 ? 'ciAddBtn' : '' });
    s.push({ k: 'rect', x: x + cw - 96, y: py + 224, w: 76, h: 8, r: 4, d: d + 130, f: '#fff', fd: 1180 + i * 40 });
  }
  // footer
  const fy = F.y + F.h - 96;
  s.push({ k: 'rect', x: F.x, y: fy, w: F.w, h: 96, r: 0, d: 880, f: '#1f1a17', fd: 1200, flatBottom: F.r });
  [[L, 130], [L + 200, 90], [L + 330, 90], [L + 460, 90]].forEach(([x, w], i) => s.push({ k: 'rect', x, y: fy + 42, w, h: 10, r: 5, d: 910 + i * 20, f: i ? '#5c534d' : '#ff8a4c', fd: 1220 }));
  [0, 1, 2].forEach(i => s.push({ k: 'circle', cx: R - 10 - i * 34, cy: fy + 47, r: 11, d: 960 + i * 20, f: '#3a332e', fd: 1230 }));
  const add = s.find(x => x.cls === 'ciAddBtn');
  return { V, F, shapes: s, cart: { x: R - 22, y: top + 22 }, click: { x: add.x + 58, y: add.y + 18 }, labels: [['NAV', top + 36], ['HERO', hy + 150], ['GRID', py + 120], ['FOOTER', fy + 48]], dims: true };
}

function phone() {
  const V = { w: 400, h: 820 }, F = { x: 26, y: 34, w: 348, h: 752, r: 34, bar: 34 };
  const top = F.y + F.bar, L = F.x + 22, R = F.x + F.w - 22, W = R - L;
  const s = [];
  s.push({ k: 'line', x1: F.x, y1: top + 54, x2: F.x + F.w, y2: top + 54, d: 300 });
  s.push({ k: 'circle', cx: L + 12, cy: top + 27, r: 12, d: 320, f: 'url(#ciGOrange)', fd: 1020 });
  s.push({ k: 'rect', x: L + 32, y: top + 22, w: 80, h: 10, r: 5, d: 350, f: '#1f1a17', fd: 1030 });
  s.push({ k: 'path', p: `M${R - 30} ${top + 16}h6l5 17h17l4-12h-24`, d: 400, ink: '#1f1a17', fd: 1040 });
  [0, 1, 2].forEach(i => s.push({ k: 'line', x1: R - 78, y1: top + 19 + i * 8, x2: R - 58, y2: top + 19 + i * 8, d: 420 + i * 20, ink: '#1f1a17', fd: 1040 }));
  const hy = top + 78;
  s.push({ k: 'rect', x: L, y: hy, w: W, h: 150, r: 14, d: 450, f: 'url(#ciGHero)', fd: 1000, xmark: true, photo: 'hero' });
  s.push({ k: 'rect', x: L, y: hy + 166, w: W * 0.86, h: 22, r: 6, d: 520, f: '#1f1a17', fd: 1060 });
  s.push({ k: 'rect', x: L, y: hy + 196, w: W * 0.6, h: 22, r: 6, d: 550, f: '#1f1a17', fd: 1070 });
  s.push({ k: 'rect', x: L, y: hy + 234, w: 132, h: 38, r: 19, d: 590, f: 'url(#ciGOrange)', fd: 1090, cls: 'ciHeroBtn' });
  const py = hy + 292, cw = (W - 16) / 2;
  for (let i = 0; i < 4; i++) {
    const x = L + (i % 2) * (cw + 16), y = py + Math.floor(i / 2) * 146, d = 620 + i * 60;
    s.push({ k: 'rect', x, y, w: cw, h: 92, r: 12, d, f: `url(#ciGP${i})`, fd: 1110 + i * 40, xmark: true, photo: 'p' + i });
    s.push({ k: 'rect', x, y: y + 102, w: cw * 0.6, h: 9, r: 4.5, d: d + 60, f: '#1f1a17', fd: 1150 + i * 40 });
    s.push({ k: 'rect', x, y: y + 118, w: cw * 0.3, h: 9, r: 4.5, d: d + 80, f: '#c2410c', fd: 1160 + i * 40 });
    s.push({ k: 'rect', x: x + cw - 30, y: y + 101, w: 30, h: 28, r: 14, d: d + 100, f: '#1f1a17', fd: 1170 + i * 40, cls: i === 1 ? 'ciAddBtn' : '' });
    s.push({ k: 'path', p: `M${x + cw - 15} ${y + 109}v12M${x + cw - 21} ${y + 115}h12`, d: d + 120, ink: '#fff', fd: 1190 + i * 40 });
  }
  const fy = F.y + F.h - 44;
  s.push({ k: 'rect', x: F.x, y: fy, w: F.w, h: 44, r: 0, d: 900, f: '#1f1a17', fd: 1200, flatBottom: F.r });
  s.push({ k: 'rect', x: L, y: fy + 18, w: 90, h: 8, r: 4, d: 930, f: '#ff8a4c', fd: 1220 });
  const add = s.find(x => x.cls === 'ciAddBtn');
  return { V, F, shapes: s, cart: { x: R - 14, y: top + 16 }, click: { x: add.x + 15, y: add.y + 13 }, labels: [], dims: false };
}

// a rect whose bottom corners follow the frame's rounded corners (footer)
const footerPath = (x, y, w, h, r) => `M${x} ${y}h${w}v${h - r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}z`;

// the wire stage is authored on a relaxed timeline and squeezed so everything is drawn by ~1 s
const T = d => d <= 300 ? d : Math.round(300 + (d - 300) * 0.6);

function Shape({ s, as }) {
  const style = { '--d': `${T(s.d)}ms`, '--f': `${s.fd || 0}ms` };
  const geom = s.k === 'rect' ? (s.flatBottom ? { d: footerPath(s.x, s.y, s.w, s.h, s.flatBottom) } : { x: s.x, y: s.y, width: s.w, height: s.h, rx: s.r })
    : s.k === 'circle' ? { cx: s.cx, cy: s.cy, r: s.r } : s.k === 'line' ? { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 } : { d: s.p };
  const Tag = s.k === 'rect' && s.flatBottom ? 'path' : s.k;
  if (as === 'fill') {
    if (s.ink) return <Tag {...geom} className="ciF ciInk" stroke={s.ink} style={style} />;
    if (!s.f) return null;
    return <Tag {...geom} className={'ciF' + (s.cls ? ' ' + s.cls : '')} fill={s.f} style={style} />;
  }
  return <g className="ciWg" style={style}>
    <Tag {...geom} className="ciW" pathLength="1" />
    {s.xmark && <><line className="ciW ciX" x1={s.x + 8} y1={s.y + 8} x2={s.x + s.w - 8} y2={s.y + s.h - 8} pathLength="1" style={{ '--d': `${T(s.d + 120)}ms` }} />
      <line className="ciW ciX" x1={s.x + s.w - 8} y1={s.y + 8} x2={s.x + 8} y2={s.y + s.h - 8} pathLength="1" style={{ '--d': `${T(s.d + 160)}ms` }} /></>}
  </g>;
}

// photo-like decorations drawn over the filled image blocks (sun + hills in the hero, simple products on the cards)
function Photo({ s }) {
  const { x, y, w, h } = s, style = { '--f': `${(s.fd || 0) + 60}ms` }, cx = x + w / 2, cy = y + h / 2, m = Math.min(w, h);
  if (s.photo === 'hero') return <g className="ciPhoto" style={style} clipPath={`url(#ciClip-${s.photo})`}>
    <circle cx={x + w * 0.72} cy={y + h * 0.36} r={m * 0.16} fill="#fff1d6" opacity=".9" />
    <path d={`M${x} ${y + h * 0.78}C${x + w * 0.2} ${y + h * 0.56} ${x + w * 0.38} ${y + h * 0.62} ${x + w * 0.55} ${y + h * 0.74}S${x + w * 0.85} ${y + h * 0.55} ${x + w} ${y + h * 0.66}V${y + h}H${x}z`} fill="#7c2d12" opacity=".55" />
    <path d={`M${x} ${y + h * 0.9}C${x + w * 0.3} ${y + h * 0.76} ${x + w * 0.6} ${y + h * 0.84} ${x + w} ${y + h * 0.8}V${y + h}H${x}z`} fill="#431407" opacity=".7" />
  </g>;
  const i = +s.photo.slice(1);
  const shapes = [
    <rect key="a" x={cx - m * 0.18} y={cy - m * 0.3} width={m * 0.36} height={m * 0.58} rx={m * 0.08} fill="#fff" opacity=".88" />,
    <circle key="b" cx={cx} cy={cy} r={m * 0.26} fill="#fff" opacity=".85" />,
    <path key="c" d={`M${cx - m * 0.3} ${cy + m * 0.22}L${cx} ${cy - m * 0.3}L${cx + m * 0.3} ${cy + m * 0.22}z`} fill="#fff" opacity=".85" />,
    <rect key="d" x={cx - m * 0.28} y={cy - m * 0.18} width={m * 0.56} height={m * 0.38} rx={m * 0.19} fill="#fff" opacity=".85" />,
  ];
  return <g className="ciPhoto" style={style}><ellipse cx={cx} cy={y + h * 0.86} rx={m * 0.3} ry={m * 0.05} fill="#000" opacity=".12" />{shapes[i]}</g>;
}

export default function Intro({ onDone, storeName }) {
  const done = useRef(false);
  const calm = useRef(reduced()).current;
  const L = useRef(null);
  if (!L.current) L.current = isNarrow() ? phone() : desktop();
  const { V, F, shapes, cart, click, labels, dims } = L.current;
  const finish = () => { if (done.current) return; done.current = true; markIntroSeen(); onDone(); };
  useEffect(() => {
    const t = setTimeout(finish, calm ? 900 : INTRO_MS);
    const onKey = e => { if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); finish(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const photos = shapes.filter(s => s.photo);
  const pageTop = F.y + F.bar;
  // zoom origin: the centre of the frame, as a share of the viewBox (the stage is centred, so this maps to the screen)
  const origin = `${((F.x + F.w / 2) / V.w) * 100}% ${((F.y + F.h / 2) / V.h) * 100}%`;
  return <div className={'caIntro' + (calm ? ' calm' : '') + (dims ? ' wide' : ' narrow')} role="presentation" onClick={finish} data-testid="commerce-intro">
    <div className="caIntroGrid" aria-hidden="true" />
    <div className="caIntroGlow" aria-hidden="true" />
    <svg className="caIntroArt" viewBox={`0 0 ${V.w} ${V.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" style={{ transformOrigin: origin }}>
      <defs>
        <linearGradient id="ciGOrange" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#ffa149" /><stop offset="1" stopColor="#ff4f1f" /></linearGradient>
        <linearGradient id="ciGHero" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#ffb86b" /><stop offset=".55" stopColor="#ff6a3d" /><stop offset="1" stopColor="#b8326b" /></linearGradient>
        <linearGradient id="ciGP0" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#c7ead5" /><stop offset="1" stopColor="#5fa883" /></linearGradient>
        <linearGradient id="ciGP1" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#ffe0b8" /><stop offset="1" stopColor="#f59a52" /></linearGradient>
        <linearGradient id="ciGP2" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#d9ccff" /><stop offset="1" stopColor="#8a6ee6" /></linearGradient>
        <linearGradient id="ciGP3" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#bfe3f5" /><stop offset="1" stopColor="#4b93c4" /></linearGradient>
        <linearGradient id="ciScanG" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7fd8ff" stopOpacity="0" /><stop offset="1" stopColor="#9fe4ff" stopOpacity=".55" /></linearGradient>
        <clipPath id="ciFrameClip"><rect x={F.x} y={F.y} width={F.w} height={F.h} rx={F.r} /></clipPath>
        {photos.map(s => <clipPath key={s.photo} id={`ciClip-${s.photo}`}><rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} /></clipPath>)}
      </defs>
      {/* blueprint annotations around the frame */}
      {dims && <g className="ciDims">
        <path d={`M${F.x} ${F.y - 26}v-10M${F.x + F.w} ${F.y - 26}v-10M${F.x} ${F.y - 31}H${F.x + F.w}`} className="ciDim" pathLength="1" />
        <text x={F.x + F.w / 2} y={F.y - 40} textAnchor="middle">1440 px</text>
        {labels.map(([t, y], i) => <g key={t} className="ciLabel" style={{ '--d': `${320 + i * 180}ms` }}><text x={F.x - 22} y={y + 4} textAnchor="end">{t}</text><path d={`M${F.x - 16} ${y}h12`} /></g>)}
      </g>}
      <g clipPath="url(#ciFrameClip)">
        <rect className="ciPage" x={F.x} y={pageTop} width={F.w} height={F.h - F.bar} />
        <g className="ciFills">{shapes.map((s, i) => <Shape key={i} s={s} as="fill" />)}{photos.map(s => <Photo key={s.photo} s={s} />)}</g>
        <g className="ciWire">{shapes.map((s, i) => <Shape key={i} s={s} />)}</g>
        <g className="ciScan" style={{ '--scan': `${F.h - F.bar + 60}px` }}><rect x={F.x} y={pageTop - 60} width={F.w} height="60" fill="url(#ciScanG)" /><line x1={F.x} y1={pageTop} x2={F.x + F.w} y2={pageTop} /></g>
      </g>
      {/* browser / phone frame */}
      <g className="ciFrame">
        <path className="ciFrameFill" d={`M${F.x} ${pageTop}V${F.y + F.r}a${F.r} ${F.r} 0 0 1 ${F.r} -${F.r}H${F.x + F.w - F.r}a${F.r} ${F.r} 0 0 1 ${F.r} ${F.r}V${pageTop}z`} />
        <rect className="ciW frame" x={F.x} y={F.y} width={F.w} height={F.h} rx={F.r} pathLength="1" style={{ '--d': '60ms' }} />
        <line className="ciW frame" x1={F.x} y1={pageTop} x2={F.x + F.w} y2={pageTop} pathLength="1" style={{ '--d': '220ms' }} />
        {dims ? <>
          {[0, 1, 2].map(i => <circle key={i} className={'ciDot d' + i} cx={F.x + 26 + i * 22} cy={F.y + F.bar / 2} r="6.5" />)}
          <rect className="ciUrl" x={F.x + F.w / 2 - 300} y={F.y + 12} width="600" height="22" rx="11" />
          <text className="ciUrlText" x={F.x + F.w / 2} y={F.y + 27.5} textAnchor="middle">{(storeName || 'your-store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'your-store'}.shop</text>
        </> : <rect className="ciUrl" x={F.x + F.w / 2 - 50} y={F.y + 12} width="100" height="12" rx="6" />}
      </g>
      {/* add to cart: click ripple, flying product, cart badge, cursor */}
      <circle className="ciRipple" cx={click.x} cy={click.y} r={dims ? 26 : 16} />
      <g transform={`translate(${click.x} ${click.y})`}><circle className="ciFly" cx="0" cy="0" r={dims ? 9 : 6} style={{ '--tx': `${cart.x - click.x}px`, '--ty': `${cart.y - click.y}px` }} /></g>
      <g className="ciBadge" style={{ transformOrigin: `${cart.x + (dims ? 16 : 10)}px ${cart.y - (dims ? 2 : 2)}px` }}>
        <circle cx={cart.x + (dims ? 16 : 10)} cy={cart.y - 2} r={dims ? 13 : 9} />
        <text x={cart.x + (dims ? 16 : 10)} y={cart.y + (dims ? 3.5 : 1.5)} textAnchor="middle" style={{ fontSize: dims ? 15 : 11 }}>1</text>
      </g>
      <g className="ciCursor" style={{ '--sx': `${V.w * 0.92 - click.x}px`, '--sy': `${V.h * 0.96 - click.y}px`, transform: `translate(${click.x}px, ${click.y}px)` }}>
        <g className="ciCursorIn"><path d="M0 0v26l7-6.5 4.6 10.4 4.8-2.1-4.6-10.2h9.6z" transform={dims ? 'scale(1.25)' : 'scale(.9)'} /></g>
      </g>
    </svg>
    <div className="caIntroHud" aria-hidden="true">
      <span className="caIntroBrand"><i />Zertake Commerce</span>
      <span className="caIntroStatus">{storeName ? `Opening ${storeName}` : 'Opening your store'}<i className="caIntroBar"><b /></i></span>
    </div>
    <div className="caIntroWipe" aria-hidden="true" />
    <button type="button" className="caIntroSkip" onClick={e => { e.stopPropagation(); finish(); }}>Skip</button>
  </div>;
}
