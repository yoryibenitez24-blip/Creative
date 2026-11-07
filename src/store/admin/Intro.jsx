// Entrance animation of the commerce app (~2.5 s), a 2D "screen" sequence:
//   1. a blueprint grid draws in and a storefront assembles (base, pillars, wall, awning, sign, shopping bag);
//   2. the storefront slides into a browser window while dashboard panels (KPIs, a sales chart, product tiles,
//      an order list) pop in beside it and the chart line draws;
//   3. the whole screen zooms towards the viewer and a circular wipe reveals the commerce home, whose cards
//      then stagger in (CommerceApp adds .caEnter for a moment).
// Pure SVG + CSS keyframes (dist/css/admin.css, "caIntro*" / "ci*"). Click, Enter, Space or Esc skips it.
// With prefers-reduced-motion the sequence is replaced by a short cross-fade (it still shows, without movement).
import React, { useEffect, useRef } from 'react';

export const INTRO_MS = 2500;
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

export default function Intro({ onDone, storeName }) {
  const done = useRef(false);
  const calm = useRef(reduced()).current;
  const finish = () => { if (done.current) return; done.current = true; markIntroSeen(); onDone(); };
  useEffect(() => {
    const t = setTimeout(finish, calm ? 900 : INTRO_MS);
    const onKey = e => { if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); finish(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const stripes = [0, 1, 2, 3, 4, 5];
  const bars = [38, 52, 44, 66, 58, 80, 72];
  return <div className={'caIntro' + (calm ? ' calm' : '')} role="presentation" onClick={finish} data-testid="commerce-intro">
    <svg className="caIntroGrid" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {Array.from({ length: 13 }, (_, i) => <line key={'v' + i} x1={i * 100} y1="0" x2={i * 100} y2="700" style={{ animationDelay: `${i * 18}ms` }} />)}
      {Array.from({ length: 8 }, (_, i) => <line key={'h' + i} x1="0" y1={i * 100} x2="1200" y2={i * 100} style={{ animationDelay: `${120 + i * 18}ms` }} />)}
    </svg>
    <div className="caIntroStage">
      <svg className="caIntroArt" viewBox="0 0 760 360" aria-hidden="true">
        <defs>
          <linearGradient id="caIntroG" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#ffd9a8" /><stop offset="1" stopColor="#ff7a3d" /></linearGradient>
          <linearGradient id="caIntroV" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#b9e6c9" /><stop offset="1" stopColor="#4f9e78" /></linearGradient>
          <linearGradient id="caIntroL" x1="0" x2="1"><stop offset="0" stopColor="#ffb36b" /><stop offset="1" stopColor="#ff5a36" /></linearGradient>
        </defs>
        {/* browser window that the storefront slides into */}
        <g className="ciWindow">
          <rect x="20" y="40" width="330" height="290" rx="18" className="ciWinFrame" />
          <rect x="20" y="40" width="330" height="34" rx="18" className="ciWinBar" />
          <circle cx="44" cy="57" r="5" className="ciDot a" /><circle cx="62" cy="57" r="5" className="ciDot b" /><circle cx="80" cy="57" r="5" className="ciDot c" />
          <rect x="104" y="50" width="160" height="14" rx="7" className="ciUrl" />
        </g>
        {/* storefront */}
        <g className="ciStore">
          <ellipse className="ciShadow" cx="185" cy="306" rx="110" ry="9" />
          <rect className="ciBase" x="87" y="286" width="196" height="16" rx="4" />
          <rect className="ciPillar l" x="97" y="204" width="22" height="84" rx="4" />
          <rect className="ciPillar r" x="251" y="204" width="22" height="84" rx="4" />
          <rect className="ciWall" x="119" y="210" width="132" height="76" rx="3" />
          <rect className="ciDoor" x="169" y="230" width="32" height="56" rx="3" />
          <rect className="ciWin a" x="129" y="224" width="30" height="26" rx="3" />
          <rect className="ciWin b" x="211" y="224" width="30" height="26" rx="3" />
          <rect className="ciRoof" x="89" y="170" width="192" height="18" rx="5" />
          <g className="ciAwning">{stripes.map(i => <path key={i} d={`M${91 + i * 31.3} 188h31.3v18a15.65 15.65 0 0 1-31.3 0z`} className={i % 2 ? 'w' : 'g'} />)}</g>
          <rect className="ciSign" x="147" y="146" width="76" height="18" rx="9" />
          <g className="ciBag">
            <path d="M279 232h48l-5 62h-38z" fill="url(#caIntroV)" />
            <path d="M291 240v-10a12 12 0 0 1 24 0v10" fill="none" stroke="#f2f2f5" strokeWidth="4" strokeLinecap="round" />
            <path className="ciCheck" d="M293 266l8 8 14-16" fill="none" stroke="#10241a" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
        {/* dashboard panels */}
        <g className="ciPanels">
          <g className="ciPanel p1"><rect x="380" y="40" width="170" height="78" rx="16" /><rect x="398" y="58" width="60" height="8" rx="4" className="ciTxt" /><rect x="398" y="78" width="96" height="18" rx="6" className="ciNum" /></g>
          <g className="ciPanel p2 hot"><rect x="566" y="40" width="174" height="78" rx="16" /><rect x="584" y="58" width="60" height="8" rx="4" className="ciTxt" /><rect x="584" y="78" width="80" height="18" rx="6" className="ciNum" /><path d="M668 102c14-26 22 8 36-12s18-22 26-30" className="ciSpark" /></g>
          <g className="ciPanel p3"><rect x="380" y="134" width="360" height="118" rx="16" />
            {bars.map((h, i) => <rect key={i} className="ciBar" x={404 + i * 26} y={236 - h} width="14" height={h} rx="5" style={{ animationDelay: `${1180 + i * 40}ms` }} />)}
            <path d="M590 222c20-6 30-40 52-36s26 30 46 18 22-40 36-48" className="ciLine" />
          </g>
          <g className="ciPanel p4"><rect x="380" y="268" width="110" height="62" rx="14" /><rect x="394" y="282" width="34" height="34" rx="9" className="ciProd a" /><rect x="436" y="290" width="40" height="7" rx="3.5" className="ciTxt" /><rect x="436" y="303" width="26" height="7" rx="3.5" className="ciTxt" /></g>
          <g className="ciPanel p5"><rect x="504" y="268" width="110" height="62" rx="14" /><rect x="518" y="282" width="34" height="34" rx="9" className="ciProd b" /><rect x="560" y="290" width="40" height="7" rx="3.5" className="ciTxt" /><rect x="560" y="303" width="26" height="7" rx="3.5" className="ciTxt" /></g>
          <g className="ciPanel p6"><rect x="628" y="268" width="112" height="62" rx="14" /><circle cx="652" cy="299" r="12" className="ciProd c" /><rect x="672" y="290" width="52" height="7" rx="3.5" className="ciTxt" /><rect x="672" y="303" width="34" height="7" rx="3.5" className="ciTxt" /></g>
        </g>
      </svg>
      <div className="caIntroText"><strong>Zertake Commerce</strong><span>{storeName ? `Opening ${storeName}` : 'Opening your store'}</span>
        <i className="caIntroBar" aria-hidden="true"><b /></i></div>
    </div>
    <button type="button" className="caIntroSkip" onClick={e => { e.stopPropagation(); finish(); }}>Skip</button>
  </div>;
}
