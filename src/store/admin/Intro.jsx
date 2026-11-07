// Entrance animation of the commerce app (~1.6 s): blocks assemble into a storefront, the awning unrolls and a
// shopping bag drops in, then the overlay fades into the admin. Pure SVG + CSS keyframes (dist/css/admin.css,
// "caIntro*"). Click, Enter, Space or Esc skips it; prefers-reduced-motion skips it entirely.
import React, { useEffect, useRef } from 'react';

const DURATION = 1650;
const KEY = 'zertake-commerce-intro-seen';
let seenThisPage = false;

/** True when the intro should play (first open in this browser session and motion allowed). */
export function shouldPlayIntro() {
  if (seenThisPage) return false;
  try { if (sessionStorage.getItem(KEY)) return false; } catch { /* storage blocked: the module flag still limits it to once */ }
  try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { markIntroSeen(); return false; } } catch { /* ignore */ }
  return true;
}
export function markIntroSeen() { seenThisPage = true; try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ } }

export default function Intro({ onDone, storeName }) {
  const done = useRef(false);
  const finish = () => { if (done.current) return; done.current = true; markIntroSeen(); onDone(); };
  useEffect(() => {
    const t = setTimeout(finish, DURATION);
    const onKey = e => { if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); finish(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const stripes = [0, 1, 2, 3, 4, 5];
  return <div className="caIntro" role="presentation" onClick={finish} data-testid="commerce-intro">
    <svg className="caIntroArt" viewBox="0 0 320 240" width="320" height="240" aria-hidden="true">
      <defs>
        <linearGradient id="caIntroG" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#a8f0c4" /><stop offset="1" stopColor="#5fd39a" /></linearGradient>
        <linearGradient id="caIntroV" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#cdb8ff" /><stop offset="1" stopColor="#8a63ff" /></linearGradient>
      </defs>
      <ellipse className="ciShadow" cx="150" cy="206" rx="110" ry="9" />
      <rect className="ciBase" x="52" y="186" width="196" height="16" rx="4" />
      <rect className="ciPillar l" x="62" y="104" width="22" height="84" rx="4" />
      <rect className="ciPillar r" x="216" y="104" width="22" height="84" rx="4" />
      <rect className="ciWall" x="84" y="110" width="132" height="76" rx="3" />
      <rect className="ciDoor" x="134" y="130" width="32" height="56" rx="3" />
      <rect className="ciWin a" x="94" y="124" width="30" height="26" rx="3" />
      <rect className="ciWin b" x="176" y="124" width="30" height="26" rx="3" />
      <rect className="ciRoof" x="54" y="70" width="192" height="18" rx="5" />
      <g className="ciAwning">{stripes.map(i => <path key={i} d={`M${56 + i * 31.3} 88h31.3v18a15.65 15.65 0 0 1-31.3 0z`} className={i % 2 ? 'w' : 'g'} />)}</g>
      <rect className="ciSign" x="112" y="48" width="76" height="18" rx="9" />
      <g className="ciBag">
        <path d="M244 132h48l-5 62h-38z" fill="url(#caIntroV)" />
        <path d="M256 140v-10a12 12 0 0 1 24 0v10" fill="none" stroke="#f2f2f5" strokeWidth="4" strokeLinecap="round" />
        <path className="ciCheck" d="M258 166l8 8 14-16" fill="none" stroke="#111" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle className="ciSpark s1" cx="40" cy="60" r="4" /><circle className="ciSpark s2" cx="282" cy="56" r="3" /><circle className="ciSpark s3" cx="300" cy="110" r="2.5" />
    </svg>
    <div className="caIntroText"><strong>Zertake Commerce</strong><span>{storeName ? `Opening ${storeName}` : 'Opening your store'}</span></div>
    <button type="button" className="caIntroSkip" onClick={e => { e.stopPropagation(); finish(); }}>Skip</button>
  </div>;
}
