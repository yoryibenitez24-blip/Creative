// Entrance animation of the commerce app (~2.2 s): a flat line-art illustration of a little shopping street that
// draws itself stroke by stroke (white lines on a very dark blue, like an editorial spot illustration): a storefront with a
// scalloped awning and an OPEN sign, a tall shopping bag, a phone with a wifi antenna, a swinging price tag, a drifting
// cloud, a credit card that slides in, a parcel that drops onto the street and a few sparkles. Then a circular wipe
// reveals the admin (CommerceApp adds .caEnter for a moment so its cards rise in).
// Pure SVG + CSS (dist/css/commerce-intro.css, "caIntro*" / "ci*"); every stroke uses pathLength=1 so one keyframe
// draws them all. Click, Enter, Space or Esc skips it. It always animates (also with "reduce motion" on)
// and fades out.
import React, { useEffect, useRef } from 'react';

export const INTRO_MS = 2250;
const KEY = 'zertake-commerce-intro-seen';
let seenThisPage = false;

/** Default policy when the host does not decide: first open in this browser session. */
export function shouldPlayIntro() {
  if (seenThisPage) return false;
  try { if (sessionStorage.getItem(KEY)) return false; } catch { /* storage blocked: the module flag still limits it to once */ }
  return true;
}
export function markIntroSeen() { seenThisPage = true; try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ } }


// A stroked shape that draws itself `t` ms after the start. `occ` fills it with the background so it hides lines behind it.
function L({ as: Tag = 'path', t = 0, occ, thin, className = '', ...p }) {
  return <Tag pathLength="1" className={'ciLn' + (occ ? ' ciOcc' : '') + (thin ? ' thin' : '') + (className ? ' ' + className : '')} style={{ '--t': t + 'ms' }} {...p} />;
}
const scallops = (x, y, n, w) => { let p = `M${x} ${y} v10`; for (let i = 0; i < n; i++) p += ` a${w / 2} ${w / 2} 0 0 0 ${w} 0`; return p + ' v-10'; };
// diagonal hatching clipped to a box
function hatch(x0, y0, x1, y1, step, t) {
  const out = [], h = y1 - y0;
  for (let x = x0 - h + step; x < x1; x += step) {
    const ax = Math.max(x, x0), bx = Math.min(x + h, x1);
    if (bx - ax > 2) out.push(<L key={x} as="line" thin x1={ax} y1={y1 - (ax - x)} x2={bx} y2={y1 - (bx - x)} t={t + out.length * 22} />);
  }
  return out;
}

export default function Intro({ onDone, storeName }) {
  const done = useRef(false);
  // Always animated: it is short (~2 s), decorative and skippable. (Systems with "reduce motion" on — e.g. Windows with
  // animation effects off — used to get a still drawing, which read as a broken animation.)
  const calm = false;
  const finish = () => { if (done.current) return; done.current = true; markIntroSeen(); onDone(); };
  useEffect(() => {
    const timer = setTimeout(finish, calm ? 900 : INTRO_MS);
    const onKey = e => { if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); finish(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className={'caIntro' + (calm ? ' calm' : '')} role="presentation" onClick={finish} data-testid="commerce-intro">
    <div className="caIntroStage">
      <svg className="caIntroArt" viewBox="0 0 400 330" aria-hidden="true">
        {/* cloud (drifts) */}
        <g className="ciCloud"><L t={150} d="M212 70 a9 9 0 0 1 4 -17 a12 12 0 0 1 22 -5 a10 10 0 0 1 18 4 a8 8 0 0 1 2 16 z" /></g>

        {/* price tag (swings from its hole) */}
        <g className="ciTag">
          <L t={60} occ d="M58 58 h62 l22 22 l-22 22 h-62 z" />
          <L t={260} as="circle" cx="122" cy="80" r="5" />
          <L t={330} d="M70 72 h36 M70 88 h24" />
        </g>
        {/* measuring arrow */}
        <L t={520} d="M60 130 h86 M68 123 l-8 7 l8 7 M138 123 l8 7 l-8 7" />

        {/* storefront */}
        <L t={90} occ as="rect" x="66" y="160" width="104" height="130" />
        <L t={280} occ d={scallops(60, 160, 7, 16.57)} />
        <L t={380} as="rect" x="104" y="232" width="30" height="58" />
        <L t={430} as="circle" cx="127" cy="262" r="1.8" />
        <L t={420} as="rect" x="76" y="196" width="22" height="30" />
        <L t={470} d="M87 196 v30 M76 211 h22" thin />
        <g className="ciSign">
          <L t={520} d="M147 186 l-6 12 M147 186 l6 12" thin />
          <L t={560} occ as="rect" x="134" y="198" width="26" height="13" rx="2" />
          <text x="147" y="207.6" className="ciTxt" textAnchor="middle">OPEN</text>
        </g>

        {/* tall shopping bag */}
        <L t={230} d="M212 140 v-16 a18 18 0 0 1 36 0 v16" />
        <L t={180} occ d="M188 140 h84 l8 150 h-100 z" />
        <L t={420} as="circle" cx="230" cy="196" r="17" />
        <L t={600} d="M222 196 l6 6 l11 -12" />
        <L t={520} d="M196 252 h68" thin />
        {hatch(194, 258, 268, 284, 9, 620)}

        {/* phone with antenna */}
        <L t={330} d="M318 112 v-30 M311 92 h14 M313 100 h10" />
        <L t={480} d="M306 74 a16 16 0 0 1 24 0 M300 66 a25 25 0 0 1 36 0" thin className="ciWave" />
        <L t={140} occ as="rect" x="288" y="112" width="60" height="178" rx="9" />
        <L t={300} as="rect" x="296" y="128" width="44" height="122" rx="3" />
        <L t={420} d="M302 140 h22 M302 148 h14" thin />
        <L t={460} as="rect" x="302" y="158" width="32" height="26" rx="2" thin />
        {hatch(302, 194, 334, 242, 8, 560)}
        <L t={380} as="circle" cx="318" cy="270" r="5" />

        {/* credit card sliding towards the phone */}
        <g className="ciCard">
          <L t={760} occ as="rect" x="240" y="118" width="58" height="36" rx="5" />
          <L t={860} d="M240 128 h58 M248 143 h16" thin />
        </g>

        {/* parcel dropping onto the street */}
        <g className="ciBox">
          <L t={820} occ as="rect" x="150" y="250" width="44" height="40" />
          <L t={900} d="M172 250 v40 M150 262 h44" thin />
        </g>

        {/* street */}
        <L t={0} d="M40 290 h320" />

        {/* sparkles */}
        <g className="ciSpark a"><L t={980} d="M48 168 v12 M42 174 h12" thin /></g>
        <g className="ciSpark b"><L t={1040} d="M282 48 v12 M276 54 h12" thin /></g>
        <g className="ciSpark c"><L t={1100} d="M362 196 v10 M357 201 h10" thin /></g>
      </svg>
    </div>
    <button type="button" className="caIntroSkip" onClick={e => { e.stopPropagation(); finish(); }}>Skip</button>
  </div>;
}
