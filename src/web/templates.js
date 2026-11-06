// Starter documents for the Web / UI workspace, built from the workspace's own primitives (frames with auto layout,
// text, rectangles, ellipses, components and shared styles). createWebDoc(id) returns a normalized document.

import { emptyDoc, makeNode, normalize, newId, DEFAULT_FONT } from './model.js';

export const WEB_TEMPLATES = [
  { id: 'desktop', name: 'Blank desktop', description: 'One empty 1440 × 1024 frame', w: 1440, h: 1024 },
  { id: 'mobile', name: 'Blank mobile', description: 'One empty 390 × 844 frame', w: 390, h: 844 },
  { id: 'tablet', name: 'Blank tablet', description: 'One empty 834 × 1194 frame', w: 834, h: 1194 },
  { id: 'landing', name: 'Landing page', description: 'Navigation, hero, feature cards and footer with a Button component', w: 1440, h: 1024 },
  { id: 'login', name: 'Mobile app login', description: 'Sign-in screen with fields, button and a linked sign-up screen', w: 390, h: 844 },
  { id: 'dashboard', name: 'Dashboard', description: 'Sidebar, KPI cards, bar chart and activity list', w: 1440, h: 1024 },
  { id: 'pricing', name: 'Pricing section', description: 'Three plan cards with a highlighted plan', w: 1440, h: 900 },
];

// ─── tiny builder ───
const el = (type, props = {}, children = []) => ({ type, props, children });
const col = (props, kids) => el('frame', { fill: null, clip: false, sizing: { h: 'hug', v: 'hug' }, ...props, layout: { direction: 'vertical', gap: 12, padding: [0, 0, 0, 0], align: 'top-left', wrap: false, wrapGap: 12, distribute: 'packed', ...(props.layout || {}) } }, kids);
const row = (props, kids) => el('frame', { fill: null, clip: false, sizing: { h: 'hug', v: 'hug' }, ...props, layout: { direction: 'horizontal', gap: 12, padding: [0, 0, 0, 0], align: 'center-left', wrap: false, wrapGap: 12, distribute: 'packed', ...(props.layout || {}) } }, kids);
const txt = (text, props = {}) => el('text', { text, fontFamily: DEFAULT_FONT, ...props });
const para = (text, props = {}) => txt(text, { textMode: 'auto-height', sizing: { h: 'fill', v: 'hug' }, ...props });

function build(doc, spec, parentId, refs) {
  const { children, ...p } = spec.props;
  const n = makeNode(spec.type, { ...p, parent: parentId || null, children: spec.type === 'frame' || spec.type === 'group' ? [] : undefined });
  if (n.children === undefined) delete n.children;
  if (spec.props.ref$) { refs[spec.props.ref$] = n.id; delete n.ref$; }
  doc.nodes[n.id] = n;
  if (parentId) doc.nodes[parentId].children.push(n.id); else doc.root.push(n.id);
  for (const c of spec.children) build(doc, c, n.id, refs);
  return n.id;
}

/** Build a document from frame specs; `instances` places component instances: [{ of: refName, into: refName, index }]. */
function assemble(name, specs, setup = () => {}) {
  const doc = emptyDoc(name), refs = {};
  setup(doc, refs);
  for (const s of specs) build(doc, s, null, refs);
  return { doc, refs };
}

const P = '#5b4bff', INK = '#14141a', MUTED = '#6b6b78', LINE = '#e4e4ea', SOFT = '#f4f4f8';
function baseStyles(doc) {
  doc.styles.colors.push({ id: 'cs-primary', name: 'Primary', color: P, opacity: 1 }, { id: 'cs-ink', name: 'Ink', color: INK, opacity: 1 }, { id: 'cs-muted', name: 'Muted', color: MUTED, opacity: 1 }, { id: 'cs-surface', name: 'Surface', color: SOFT, opacity: 1 });
  doc.styles.texts.push(
    { id: 'ts-display', name: 'Display', fontFamily: DEFAULT_FONT, fontSize: 56, fontWeight: 700, italic: false, lineHeight: 64, letterSpacing: -1 },
    { id: 'ts-heading', name: 'Heading', fontFamily: DEFAULT_FONT, fontSize: 24, fontWeight: 600, italic: false, lineHeight: 32, letterSpacing: 0 },
    { id: 'ts-body', name: 'Body', fontFamily: DEFAULT_FONT, fontSize: 16, fontWeight: 400, italic: false, lineHeight: 24, letterSpacing: 0 });
}
const ink = { fill: INK, fillStyle: 'cs-ink' }, muted = { fill: MUTED, fillStyle: 'cs-muted' };
const card = { fill: '#ffffff', radius: 16, stroke: LINE, strokeWidth: 1, effects: [{ type: 'drop-shadow', x: 0, y: 8, blur: 24, spread: 0, color: '#14141a', opacity: 0.06, visible: true }] };

function blank(t) {
  const { doc } = assemble(t.name, [el('frame', { name: t.id === 'desktop' ? 'Desktop' : t.id === 'mobile' ? 'Mobile' : 'Tablet', x: 0, y: 0, w: t.w, h: t.h })]);
  return doc;
}

function landing() {
  const button = (label, ref) => row({ name: label + ' button', ref$: ref, fill: P, fillStyle: 'cs-primary', radius: 10, layout: { padding: [12, 22, 12, 22], align: 'center' } }, [txt(label, { fill: '#ffffff', fontWeight: 600, fontSize: 15 })]);
  const feature = (title, body, color) => col({ name: 'Feature card', ...card, sizing: { h: 'fill', v: 'hug' }, layout: { padding: [28, 28, 28, 28], gap: 14 } }, [
    el('ellipse', { name: 'Icon', w: 44, h: 44, fill: color }), txt(title, { ...ink, textStyle: 'ts-heading', fontSize: 24, fontWeight: 600, lineHeight: 32 }), para(body, { ...muted, textStyle: 'ts-body', lineHeight: 24 })]);
  const { doc, refs } = assemble('Landing page', [
    col({ name: 'Landing page', ref$: 'page', x: 0, y: 0, w: 1440, h: 1024, fill: '#ffffff', clip: true, sizing: { h: 'fixed', v: 'hug' }, layout: { gap: 0 } }, [
      row({ name: 'Navigation', sizing: { h: 'fill', v: 'hug' }, layout: { padding: [24, 80, 24, 80], distribute: 'space-between' } }, [
        row({ name: 'Logo', layout: { gap: 10 } }, [el('rect', { name: 'Mark', w: 28, h: 28, radius: 8, fill: P, fillStyle: 'cs-primary' }), txt('Northwind', { ...ink, fontSize: 20, fontWeight: 700 })]),
        row({ name: 'Links', layout: { gap: 32 } }, ['Product', 'Pricing', 'Customers', 'Docs'].map(l => txt(l, { ...muted, fontSize: 15 }))),
        el('frame', { name: 'Nav CTA slot', ref$: 'navSlot', fill: null, clip: false, w: 1, h: 1, sizing: { h: 'hug', v: 'hug' }, layout: { direction: 'horizontal', gap: 0, padding: [0, 0, 0, 0], align: 'center', wrap: false, wrapGap: 0, distribute: 'packed' } }, []),
      ]),
      col({ name: 'Hero', sizing: { h: 'fill', v: 'hug' }, layout: { padding: [96, 200, 96, 200], gap: 24, align: 'top-center' } }, [
        txt('Ship interfaces your team is proud of', { ...ink, textStyle: 'ts-display', textMode: 'auto-height', w: 900, align: 'center', fontSize: 56, fontWeight: 700, lineHeight: 64, letterSpacing: -1 }),
        txt('Plan, design and hand off product screens in one calm workspace. Auto layout, components and shared styles keep every screen consistent.', { ...muted, textMode: 'auto-height', w: 680, align: 'center', fontSize: 19, lineHeight: 30 }),
        row({ name: 'Hero actions', ref$: 'heroActions', layout: { gap: 14 } }, [
          row({ name: 'Secondary button', radius: 10, stroke: LINE, strokeWidth: 1, fill: '#ffffff', layout: { padding: [12, 22, 12, 22], align: 'center' } }, [txt('Watch the tour', { ...ink, fontWeight: 600, fontSize: 15 })]),
        ]),
      ]),
      row({ name: 'Features', sizing: { h: 'fill', v: 'hug' }, layout: { padding: [0, 80, 96, 80], gap: 24, align: 'top-left' } }, [
        feature('Auto layout', 'Frames grow and shrink with their content, with gaps and padding you control.', '#ffd166'),
        feature('Components', 'Build a button once. Every instance updates when the main component changes.', '#7bdff2'),
        feature('Prototypes', 'Link frames together and present the flow full screen with smooth transitions.', '#b2f7a1'),
      ]),
      row({ name: 'Footer', sizing: { h: 'fill', v: 'hug' }, fill: SOFT, fillStyle: 'cs-surface', layout: { padding: [28, 80, 28, 80], distribute: 'space-between' } }, [
        txt('© 2026 Northwind Labs', { ...muted, fontSize: 14 }), txt('Privacy · Terms · Contact', { ...muted, fontSize: 14 })]),
    ]),
    button('Get started', 'button'),
  ], baseStyles);
  // the button is a main component placed next to the page; the page uses instances of it
  const b = doc.nodes[refs.button]; b.isComponent = true; b.name = 'Button'; b.x = 1540; b.y = 0;
  const inst = (into, index) => { const n = makeNode('frame', { name: 'Button', componentId: b.id, overrides: {}, children: [], parent: into, sizing: { h: 'hug', v: 'hug' } }); doc.nodes[n.id] = n; doc.nodes[into].children.splice(index, 0, n.id); return n; };
  inst(refs.navSlot, 0);
  const hero = inst(refs.heroActions, 0);
  let out = normalize(doc);
  // label override for the hero instance
  const heroText = out.nodes[hero.id].children[0];
  const ref = out.nodes[heroText].ref;
  out = normalize({ ...out, nodes: { ...out.nodes, [hero.id]: { ...out.nodes[hero.id], overrides: { [ref]: { text: 'Start free trial' } } } } });
  return out;
}

function login() {
  const field = (label, placeholder) => col({ name: label + ' field', sizing: { h: 'fill', v: 'hug' }, layout: { gap: 8 } }, [
    txt(label, { ...ink, fontSize: 14, fontWeight: 600 }),
    row({ name: 'Input', sizing: { h: 'fill', v: 'hug' }, fill: '#ffffff', radius: 12, stroke: LINE, strokeWidth: 1, layout: { padding: [14, 16, 14, 16] } }, [txt(placeholder, { fill: '#9a9aa6', fontSize: 16 })])]);
  const { doc, refs } = assemble('Mobile app login', [
    col({ name: 'Sign in', ref$: 'signin', x: 0, y: 0, w: 390, h: 844, fill: '#ffffff', clip: true, sizing: { h: 'fixed', v: 'fixed' }, layout: { padding: [96, 24, 40, 24], gap: 28, align: 'top-center' } }, [
      el('ellipse', { name: 'App icon', w: 72, h: 72, fill: P, fillStyle: 'cs-primary', effects: [{ type: 'drop-shadow', x: 0, y: 10, blur: 24, spread: 0, color: P, opacity: 0.35, visible: true }] }),
      col({ name: 'Heading', sizing: { h: 'fill', v: 'hug' }, layout: { gap: 8, align: 'top-center' } }, [
        txt('Welcome back', { ...ink, fontSize: 28, fontWeight: 700, align: 'center' }), para('Sign in to continue to your workspace', { ...muted, fontSize: 15, align: 'center', lineHeight: 22 })]),
      col({ name: 'Form', sizing: { h: 'fill', v: 'hug' }, layout: { gap: 18 } }, [field('Email', 'you@example.com'), field('Password', '••••••••')]),
      row({ name: 'Sign in button', fill: P, fillStyle: 'cs-primary', radius: 12, sizing: { h: 'fill', v: 'hug' }, layout: { padding: [16, 16, 16, 16], align: 'center' } }, [txt('Sign in', { fill: '#ffffff', fontSize: 16, fontWeight: 600 })]),
      txt('Forgot password?', { fill: P, fillStyle: 'cs-primary', fontSize: 15, fontWeight: 500 }),
      txt('New here? Create an account', { ref$: 'toSignup', ...muted, fontSize: 15 }),
    ]),
    col({ name: 'Create account', ref$: 'signup', x: 490, y: 0, w: 390, h: 844, fill: '#ffffff', clip: true, sizing: { h: 'fixed', v: 'fixed' }, layout: { padding: [96, 24, 40, 24], gap: 28, align: 'top-center' } }, [
      txt('Create your account', { ...ink, fontSize: 28, fontWeight: 700 }),
      col({ name: 'Form', sizing: { h: 'fill', v: 'hug' }, layout: { gap: 18 } }, [field('Name', 'Ada Lovelace'), field('Email', 'you@example.com')]),
      row({ name: 'Create button', fill: P, fillStyle: 'cs-primary', radius: 12, sizing: { h: 'fill', v: 'hug' }, layout: { padding: [16, 16, 16, 16], align: 'center' } }, [txt('Create account', { fill: '#ffffff', fontSize: 16, fontWeight: 600 })]),
      txt('Back to sign in', { ref$: 'toSignin', fill: P, fillStyle: 'cs-primary', fontSize: 15, fontWeight: 500 }),
    ]),
  ], baseStyles);
  doc.nodes[refs.toSignup].proto = { target: refs.signup, transition: 'slide-left', duration: 300 };
  doc.nodes[refs.toSignin].proto = { target: refs.signin, transition: 'slide-right', duration: 300 };
  doc.startFrame = refs.signin;
  return normalize(doc);
}

function dashboard() {
  const kpi = (label, value, delta) => col({ name: 'KPI card', ...card, sizing: { h: 'fill', v: 'hug' }, layout: { padding: [20, 20, 20, 20], gap: 6 } }, [
    txt(label, { ...muted, fontSize: 13 }), txt(value, { ...ink, fontSize: 30, fontWeight: 700 }), txt(delta, { fill: delta.startsWith('-') ? '#d64545' : '#1f9d55', fontSize: 13, fontWeight: 600 })]);
  const bars = [120, 180, 150, 220, 260, 210, 300, 280, 240, 320, 290, 340];
  const { doc } = assemble('Dashboard', [
    row({ name: 'Dashboard', x: 0, y: 0, w: 1440, h: 1024, fill: SOFT, fillStyle: 'cs-surface', clip: true, sizing: { h: 'fixed', v: 'fixed' }, layout: { gap: 0, align: 'top-left' } }, [
      col({ name: 'Sidebar', w: 240, fill: INK, sizing: { h: 'fixed', v: 'fill' }, layout: { padding: [28, 20, 28, 20], gap: 6 } }, [
        txt('Northwind', { fill: '#ffffff', fontSize: 20, fontWeight: 700 }), el('rect', { name: 'Spacer', w: 10, h: 18, fill: null }),
        ...['Overview', 'Analytics', 'Customers', 'Orders', 'Settings'].map((l, i) => row({ name: l, fill: i === 0 ? '#2a2a35' : null, radius: 8, sizing: { h: 'fill', v: 'hug' }, layout: { padding: [10, 12, 10, 12], gap: 10 } }, [
          el('rect', { name: 'Icon', w: 16, h: 16, radius: 4, fill: i === 0 ? '#ffffff' : '#6d6d7d' }), txt(l, { fill: i === 0 ? '#ffffff' : '#a5a5b5', fontSize: 15 })]))]),
      col({ name: 'Main', sizing: { h: 'fill', v: 'fill' }, layout: { padding: [32, 40, 32, 40], gap: 24 } }, [
        row({ name: 'Header', sizing: { h: 'fill', v: 'hug' }, layout: { distribute: 'space-between' } }, [
          txt('Overview', { ...ink, textStyle: 'ts-heading', fontSize: 24, fontWeight: 600, lineHeight: 32 }),
          row({ name: 'Search', fill: '#ffffff', radius: 10, stroke: LINE, strokeWidth: 1, w: 280, sizing: { h: 'fixed', v: 'hug' }, layout: { padding: [10, 14, 10, 14] } }, [txt('Search…', { fill: '#9a9aa6', fontSize: 14 })])]),
        row({ name: 'KPIs', sizing: { h: 'fill', v: 'hug' }, layout: { gap: 20 } }, [kpi('Revenue', '$84,210', '+12.4%'), kpi('Active users', '12,931', '+4.1%'), kpi('Orders', '1,284', '+8.0%'), kpi('Refunds', '23', '-2.3%')]),
        col({ name: 'Chart card', ...card, sizing: { h: 'fill', v: 'hug' }, layout: { padding: [24, 24, 24, 24], gap: 16 } }, [
          txt('Monthly revenue', { ...ink, fontSize: 17, fontWeight: 600 }),
          row({ name: 'Bars', h: 340, sizing: { h: 'fill', v: 'fixed' }, layout: { gap: 18, align: 'bottom-left' } }, bars.map((b, i) => el('rect', { name: 'Bar ' + (i + 1), w: 40, h: b, radius: [6, 6, 0, 0], fill: i === bars.length - 1 ? P : '#cfc9ff', sizing: { h: 'fill', v: 'fixed' } })))]),
        col({ name: 'Activity', ...card, sizing: { h: 'fill', v: 'hug' }, layout: { padding: [20, 24, 20, 24], gap: 14 } }, [
          txt('Recent activity', { ...ink, fontSize: 17, fontWeight: 600 }),
          ...[['Order #1042 paid', '2 min ago'], ['New customer: Rosa Diaz', '18 min ago'], ['Refund issued #1031', '1 h ago']].map(([a, b]) => row({ name: 'Row', sizing: { h: 'fill', v: 'hug' }, layout: { distribute: 'space-between' } }, [txt(a, { ...ink, fontSize: 14 }), txt(b, { ...muted, fontSize: 13 })]))]),
      ]),
    ]),
  ], baseStyles);
  return normalize(doc);
}

function pricing() {
  const plan = (name, price, feats, hi) => col({ name: name + ' plan', ...card, fill: hi ? INK : '#ffffff', stroke: hi ? null : LINE, sizing: { h: 'fill', v: 'hug' }, layout: { padding: [32, 28, 32, 28], gap: 18 } }, [
    txt(name, { fill: hi ? '#cfc9ff' : P, fontSize: 15, fontWeight: 600 }),
    row({ name: 'Price', layout: { gap: 6, align: 'bottom-left' } }, [txt(price, { fill: hi ? '#ffffff' : INK, fontSize: 44, fontWeight: 700 }), txt('/ month', { fill: hi ? '#a5a5b5' : MUTED, fontSize: 15 })]),
    el('rect', { name: 'Divider', w: 10, h: 1, fill: hi ? '#33333f' : LINE, sizing: { h: 'fill', v: 'fixed' } }),
    col({ name: 'Features', sizing: { h: 'fill', v: 'hug' }, layout: { gap: 12 } }, feats.map(f => row({ name: 'Feature', layout: { gap: 10 } }, [el('ellipse', { name: 'Check', w: 8, h: 8, fill: hi ? '#b2f7a1' : P }), txt(f, { fill: hi ? '#e8e8f0' : INK, fontSize: 15 })]))),
    row({ name: 'Choose button', fill: hi ? '#ffffff' : P, radius: 10, sizing: { h: 'fill', v: 'hug' }, layout: { padding: [14, 14, 14, 14], align: 'center' } }, [txt('Choose ' + name, { fill: hi ? INK : '#ffffff', fontWeight: 600, fontSize: 15 })])]);
  const { doc } = assemble('Pricing section', [
    col({ name: 'Pricing', x: 0, y: 0, w: 1440, h: 900, fill: '#ffffff', clip: true, sizing: { h: 'fixed', v: 'hug' }, layout: { padding: [96, 160, 96, 160], gap: 48, align: 'top-center' } }, [
      col({ name: 'Intro', layout: { gap: 12, align: 'top-center' } }, [txt('Simple, honest pricing', { ...ink, fontSize: 44, fontWeight: 700 }), txt('Start free. Upgrade when your team grows.', { ...muted, fontSize: 18 })]),
      row({ name: 'Plans', sizing: { h: 'fill', v: 'hug' }, layout: { gap: 24, align: 'top-left' } }, [
        plan('Starter', '$0', ['3 projects', 'Unlimited viewers', 'Community support']),
        plan('Team', '$24', ['Unlimited projects', 'Shared components', 'Prototype links', 'Priority support'], true),
        plan('Business', '$49', ['Everything in Team', 'Design system analytics', 'Single sign-on'])]),
    ]),
  ], baseStyles);
  return normalize(doc);
}

/** A new web design document from a template id (see WEB_TEMPLATES) or a { w, h, name } size. */
export function createWebDoc(preset = 'desktop') {
  if (preset && typeof preset === 'object') {
    const { doc } = assemble(preset.name || 'Untitled design', [el('frame', { name: preset.frameName || 'Frame 1', x: 0, y: 0, w: preset.w || 1440, h: preset.h || 1024 })]);
    return normalize(doc);
  }
  const t = WEB_TEMPLATES.find(t => t.id === preset) || WEB_TEMPLATES[0];
  if (t.id === 'landing') return landing();
  if (t.id === 'login') return login();
  if (t.id === 'dashboard') return dashboard();
  if (t.id === 'pricing') return pricing();
  return normalize(blank(t));
}

/** Insert a template's top-level frames into an existing doc to the right of its content. Returns { doc, ids }. */
export function insertTemplate(doc, id, measure) {
  const t = createWebDoc(id);
  const tops = doc.root.map(r => doc.nodes[r]).filter(Boolean);
  const dx = tops.length ? Math.max(...tops.map(n => n.x + n.w)) + 160 : 0;
  // fresh ids for everything, including style ids
  const map = {}; for (const k in t.nodes) map[k] = newId();
  const smap = {}; for (const s of [...t.styles.colors, ...t.styles.texts]) smap[s.id] = newId(s.id.slice(0, 2));
  const nodes = { ...doc.nodes };
  const mapRef = r => r == null ? r : r.split('~').map(p => map[p] || p).join('~');
  for (const k in t.nodes) {
    const n = t.nodes[k], c = { ...n, id: map[k], parent: n.parent ? map[n.parent] : null };
    if (n.children) c.children = n.children.map(x => map[x]);
    if (n.componentId) c.componentId = map[n.componentId];
    if (n.ref) c.ref = mapRef(n.ref);
    if (n.overrides) c.overrides = Object.fromEntries(Object.entries(n.overrides).map(([key, v]) => [key.startsWith('__') ? key : mapRef(key), v]));
    if (n.fillStyle) c.fillStyle = smap[n.fillStyle];
    if (n.textStyle) c.textStyle = smap[n.textStyle];
    if (n.proto) c.proto = { ...n.proto, target: map[n.proto.target] };
    if (!n.parent) c.x += dx;
    nodes[c.id] = c;
  }
  const styles = { colors: [...(doc.styles?.colors || []), ...t.styles.colors.map(s => ({ ...s, id: smap[s.id] }))], texts: [...(doc.styles?.texts || []), ...t.styles.texts.map(s => ({ ...s, id: smap[s.id] }))] };
  const ids = t.root.map(r => map[r]);
  return { doc: normalize({ ...doc, nodes, root: [...doc.root, ...ids], styles }, measure), ids };
}
