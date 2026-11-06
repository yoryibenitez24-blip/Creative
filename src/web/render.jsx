import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { nodeStyle } from './codegen.js';
import { textLayout } from './model.js';

// DOM renderer for web design nodes. Every node is an absolutely positioned div styled by codegen.nodeStyle (the
// same rules the HTML export uses); auto layout positions are already resolved into x/y/w/h by model.normalize.
// NodeView is memoized on node identity: model.finalize gives every ancestor of a changed node a new identity.

const camelStyle = s => s; // nodeStyle already returns camelCase keys usable by React

export const NodeView = memo(function NodeView({ node: n, store }) {
  if (!n) return null;
  const { doc, measure, interactive } = store.current;
  const style = camelStyle(nodeStyle(doc, n, 'absolute'));
  const extra = interactive && n.proto?.target ? ' wbLink' : '';
  if (n.type === 'text') {
    const t = textLayout(n, measure);
    return <div data-id={n.id} className={'wbNode wbTextNode' + extra} style={style}>
      <div className="wbText">{t.lines.map((l, i) => <div key={i} style={{ height: t.lineHeight }}>{l || '​'}</div>)}</div>
    </div>;
  }
  return <div data-id={n.id} className={'wbNode' + extra} style={style}>
    {(n.children || []).map(c => <NodeView key={c} node={store.current.doc.nodes[c]} store={store} />)}
  </div>;
}, (a, b) => a.node === b.node && a.store === b.store && a.images === b.images);

/** Render a top-level frame at its own origin (for presentation). */
export function FrameStage({ doc, id, measure, onLink }) {
  const store = useRef({}); store.current = { doc, measure, interactive: true };
  const n = doc.nodes[id]; if (!n) return null;
  const onClick = e => {
    for (let el = e.target; el && el !== e.currentTarget.parentNode; el = el.parentElement) {
      const nid = el.dataset?.id, node = nid && doc.nodes[nid];
      if (node?.proto?.target && doc.nodes[node.proto.target]) { onLink(node.proto); return; }
    }
  };
  return <div className="wbStageFrame" style={{ width: n.w, height: n.h }} onClick={onClick}>
    <NodeView node={{ ...n, x: 0, y: 0, rotation: 0 }} store={store} images={doc.images} />
  </div>;
}

/** Full-window prototype player. Follows "On click → Navigate to" links with their transitions. Esc exits. */
export function Present({ doc, startId, measure, onExit }) {
  const [cur, setCur] = useState({ id: startId, prev: null, transition: 'instant', duration: 0, key: 0 });
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  const root = useRef(null);
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onExit(); } };
    const r = () => setWin({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('keydown', k, true); window.addEventListener('resize', r);
    root.current?.focus();
    return () => { window.removeEventListener('keydown', k, true); window.removeEventListener('resize', r); };
  }, [onExit]);
  useEffect(() => {
    if (!cur.prev) return;
    const t = setTimeout(() => setCur(c => ({ ...c, prev: null })), cur.duration + 30);
    return () => clearTimeout(t);
  }, [cur.key]);
  const frame = doc.nodes[cur.id];
  const go = p => setCur(c => ({ id: p.target, prev: p.transition === 'instant' ? null : c.id, transition: p.transition || 'instant', duration: p.transition === 'instant' ? 0 : p.duration ?? 300, key: c.key + 1 }));
  const fit = n => n ? Math.min(1, (win.w - 40) / n.w, (win.h - 90) / n.h) : 1;
  const stage = (id, cls) => {
    const n = doc.nodes[id]; if (!n) return null; const s = fit(n);
    return <div key={id + cls + cur.key} className={'wbStage ' + cls} style={{ '--dur': cur.duration + 'ms' }}>
      <div style={{ width: n.w * s, height: n.h * s }}><div style={{ transform: `scale(${s})`, transformOrigin: '0 0' }}>
        <FrameStage doc={doc} id={id} measure={measure} onLink={go} /></div></div>
    </div>;
  };
  return <div className="wbPresent" role="dialog" aria-label="Prototype preview" tabIndex={-1} ref={root}>
    <header className="wbPresentBar">
      <span className="wbPresentTitle" data-testid="present-frame">{frame?.name || 'No frame'}</span>
      <button className="wbBtn" aria-label="Restart prototype" onClick={() => setCur(c => ({ id: startId, prev: null, transition: 'instant', duration: 0, key: c.key + 1 }))}><RotateCcw size={14} /> Restart</button>
      <button className="wbBtn" aria-label="Exit preview" onClick={onExit}><X size={14} /> Exit (Esc)</button>
    </header>
    <div className="wbPresentBody">
      {cur.prev && stage(cur.prev, 'out ' + cur.transition)}
      {frame ? stage(cur.id, 'in ' + (cur.prev ? cur.transition : 'instant')) : <p className="wbEmpty">Add a frame to present.</p>}
    </div>
  </div>;
}

export function useStableStore(value) { const r = useRef(value); r.current = value; return r; }
export { useMemo };
