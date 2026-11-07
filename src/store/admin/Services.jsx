// Services section of the commerce admin: overview (service KPIs, upcoming bookings, projects by stage, service
// products), bookings calendar (week / month / list) with booking detail (status, reschedule, intake answers, notes),
// service projects board (New → In progress → Delivered → Revision → Completed) with project detail (deliverables,
// due date, revisions, client messages), and the Home "Upcoming bookings" widget. Data: src/store/admin/services.js.
import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, CalendarDays, CalendarCheck, Clock, Gauge as GaugeIcon, DollarSign, KanbanSquare, Video, MapPin, Send, MessageSquare, ExternalLink, Check as CheckIcon } from 'lucide-react';
import { useAdmin, Page, Card, Badge, Btn, Text, Num, Select, Segmented, Modal, Empty, BigNum, Gauge, fmtDate, pct } from './ui.jsx';
import { customerName } from './model.js';
import { BOOKING_STATUSES, PROJECT_STAGES, ACTIVE_BOOKING, bookingSlots, serviceKpis, serviceProducts, upcomingBookings, newBooking, historyEntry, sid, zonedDay } from './services.js';
import { servicePriceLabel } from '../serviceProduct.js';
import { SampleDataButton } from './SampleData.jsx';
import { OrdersSync } from './Backend.jsx';

const DAY = 86400000;
const STATUS = Object.fromEntries(BOOKING_STATUSES.map(([k, l, t]) => [k, [l, t]]));
const STAGE = Object.fromEntries(PROJECT_STAGES);
const back = (go, to, label) => <button type="button" className="caIconBtn caBack" aria-label={label} onClick={() => go(to)}><ArrowLeft size={17} /></button>;
const time = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(iso).toLocaleDateString('en-US', opts);
const localKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const keyDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addLocal = (k, n) => { const d = keyDate(k); d.setDate(d.getDate() + n); return localKey(d); };
const mondayOf = k => { const d = keyDate(k), wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return localKey(d); };
const minutes = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);
export const StatusBadge = ({ status }) => <Badge tone={STATUS[status][1]}>{STATUS[status][0]}</Badge>;
const LocIcon = ({ mode }) => mode === 'in_person' ? <MapPin size={13} aria-hidden="true" /> : <Video size={13} aria-hidden="true" />;

function Kpi({ label, icon: Icon, value, foot, hot }) {
  return <div className={'caKpi' + (hot ? ' hot' : '')} role="group" aria-label={label}>
    <div className="caKpiTop"><span className="caKpiLabel">{label}</span><span className="caKpiIcon" aria-hidden="true"><Icon size={15} /></span></div>
    <strong className="caKpiValue"><BigNum value={value} /></strong>
    <div className="caKpiFoot"><span>{foot}</span></div>
  </div>;
}

/** Compact list of upcoming bookings (Home widget and Services overview). */
export function UpcomingBookings({ limit = 5 }) {
  const { commerce, go } = useAdmin();
  const list = upcomingBookings(commerce, Date.now(), limit);
  if (!list.length) return <Empty art="generic" title="No upcoming bookings" action={<Btn onClick={() => go('bookings')}>Open calendar</Btn>}>Bookings for your services show up here.</Empty>;
  return <ul className="svUpcoming">{list.map(b => <li key={b.id}>
    <button type="button" className="svURow" onClick={() => go({ page: 'booking', id: b.id })}>
      <span className="svDate" aria-hidden="true"><small>{dayLabel(b.start, { month: 'short' })}</small><strong>{new Date(b.start).getDate()}</strong></span>
      <span className="svUMain"><strong>{b.name || 'Guest'}</strong><small><Clock size={11} aria-hidden="true" />{dayLabel(b.start, { weekday: 'short' })} {time(b.start)} · {b.title}</small></span>
      <StatusBadge status={b.status} />
    </button></li>)}</ul>;
}

// ---------------------------------------------------------------- overview
export function ServicesOverview() {
  const { store, commerce, fmt, go } = useAdmin();
  const tz = -new Date().getTimezoneOffset();
  const k = useMemo(() => serviceKpis(store, commerce, Date.now(), tz), [store, commerce]); // eslint-disable-line react-hooks/exhaustive-deps
  const services = serviceProducts(store);
  const projects = commerce.serviceProjects;
  const stageCounts = PROJECT_STAGES.map(([key, label]) => [key, label, projects.filter(p => p.stage === key).length]);
  const maxStage = Math.max(1, ...stageCounts.map(s => s[2]));
  const newBk = useState(false);
  if (!services.length && !commerce.bookings.length) return <Page title="Services" subtitle="Sell consultations, projects and retainers next to your products">
    <Card><Empty art="generic" title="Sell your first service" action={<div className="caInline svCenter"><Btn kind="primary" icon={Plus} onClick={() => go({ page: 'product', id: 'new' })}>Add a service</Btn><SampleDataButton onlyLoad /></div>}>
      Create a product and set its type to <strong>Service</strong>: pick a pricing model, your weekly availability and the questions buyers answer. Bookings and projects land here.</Empty></Card>
  </Page>;
  return <Page title="Services" subtitle="Bookings, client projects and revenue from your services"
    actions={<><SampleDataButton /><Btn icon={KanbanSquare} onClick={() => go('projects')}>Projects</Btn><Btn kind="primary" icon={Plus} onClick={() => newBk[1](true)}>New booking</Btn></>}>
    <div className="caKpis">
      <Kpi hot label="Upcoming bookings" icon={CalendarCheck} value={String(k.upcoming)} foot={`next 7 days · ${k.requested} awaiting confirmation`} />
      <Kpi label="Utilisation" icon={GaugeIcon} value={pct(k.utilisation.rate)} foot={`next 7 days · ${pct(k.utilisationPast.rate)} last 30 days`} />
      <Kpi label="Service revenue" icon={DollarSign} value={fmt(k.revenue)} foot={`last 30 days · ${fmt(k.revenuePrev)} the 30 before`} />
      <Kpi label="Open projects" icon={KanbanSquare} value={String(k.openProjects)} foot={k.overdueProjects ? `${k.overdueProjects} overdue` : 'none overdue'} />
    </div>
    <div className="caCols">
      <div className="caColMain">
        <Card title="Upcoming bookings" actions={<Btn kind="plain" onClick={() => go('bookings')}>Calendar<ChevronRight size={14} /></Btn>}><UpcomingBookings limit={6} /></Card>
        <Card title="Projects by stage" actions={<Btn kind="plain" onClick={() => go('projects')}>Board<ChevronRight size={14} /></Btn>}>
          <ul className="svStages" aria-label="Projects by stage">{stageCounts.map(([key, label, n]) => <li key={key}>
            <span>{label}</span><span className="svStageTrack"><i className={'s-' + key} style={{ width: n ? `${Math.max(4, n / maxStage * 100)}%` : 0 }} /></span><strong>{n}</strong></li>)}</ul>
        </Card>
      </div>
      <div className="caColSide">
        <Card title="Calendar utilisation">
          <Gauge value={k.utilisation.rate} label={pct(k.utilisation.rate)} sub="booked" />
          <p className="caMuted svGaugeNote">{Math.round(k.utilisation.bookedMinutes / 60 * 10) / 10} of {Math.round(k.utilisation.availableMinutes / 60)} available hours are booked.</p>
        </Card>
        <Card title="Service products" actions={<Btn kind="plain" icon={Plus} onClick={() => go({ page: 'product', id: 'new' })}>Add</Btn>}>
          {services.length ? <ul className="svProducts">{services.map(p => <li key={p.id}><button type="button" className="caLink" onClick={() => go({ page: 'product', id: p.id })}>{p.title}</button>
            <small>{servicePriceLabel(p, fmt)} · {p.service.durationMinutes} min{p.service.booking.enabled ? '' : ' · no booking'}</small></li>)}</ul> : <p className="caMuted">No service products yet.</p>}
        </Card>
      </div>
    </div>
    {newBk[0] && <NewBookingDialog onClose={() => newBk[1](false)} />}
  </Page>;
}

// ---------------------------------------------------------------- bookings calendar
const VIEW_KEY = 'zertake.bookingsView';
export function BookingsPage() {
  const { store, commerce, go } = useAdmin();
  const [view, setView] = useState(() => { try { return localStorage.getItem(VIEW_KEY) || 'week'; } catch { return 'week'; } });
  const [anchor, setAnchor] = useState(() => localKey(new Date()));
  const [filter, setFilter] = useState('upcoming');
  const [adding, setAdding] = useState(false);
  const pickView = v => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ } };
  const bookings = commerce.bookings;
  const today = localKey(new Date());
  const step = n => setAnchor(a => view === 'month' ? (() => { const d = keyDate(a); d.setDate(1); d.setMonth(d.getMonth() + n); return localKey(d); })() : addLocal(a, 7 * n));
  const weekStart = mondayOf(anchor);
  const title = view === 'month' ? keyDate(anchor).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : view === 'week' ? `${keyDate(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${keyDate(addLocal(weekStart, 6)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'All bookings';
  const empty = !bookings.length;
  return <Page title="Bookings" subtitle={serviceProducts(store).length ? `${upcomingBookings(commerce).length} upcoming` : 'Add a service product to take bookings'}
    actions={<><OrdersSync /><Btn kind="primary" icon={Plus} onClick={() => setAdding(true)} disabled={!serviceProducts(store).some(p => p.service.booking.enabled)}>New booking</Btn></>}>
    <Card pad={false} className="svCalCard">
      <div className="caToolbar svCalBar">
        <Segmented label="Calendar view" value={view} onChange={pickView} options={[['week', 'Week'], ['month', 'Month'], ['list', 'List']]} />
        {view !== 'list' && <div className="svNav">
          <button type="button" className="caIconBtn" aria-label={view === 'month' ? 'Previous month' : 'Previous week'} onClick={() => step(-1)}><ChevronLeft size={16} /></button>
          <Btn onClick={() => setAnchor(today)}>Today</Btn>
          <button type="button" className="caIconBtn" aria-label={view === 'month' ? 'Next month' : 'Next week'} onClick={() => step(1)}><ChevronRight size={16} /></button>
        </div>}
        <h2 className="svCalTitle" aria-live="polite">{title}</h2>
      </div>
      {empty ? <Empty art="generic" title="No bookings yet" action={<div className="caInline svCenter"><SampleDataButton onlyLoad /></div>}>When customers book a service, or you add a booking, it appears on this calendar.</Empty>
        : view === 'week' ? <WeekView start={weekStart} bookings={bookings} today={today} />
        : view === 'month' ? <MonthView anchor={anchor} bookings={bookings} today={today} onDay={k => { setAnchor(k); pickView('week'); }} />
        : <BookingList bookings={bookings} filter={filter} setFilter={setFilter} />}
    </Card>
    {adding && <NewBookingDialog onClose={() => setAdding(false)} />}
  </Page>;
}

function WeekView({ start, bookings: all, today: t }) {
  const { go } = useAdmin();
  const days = Array.from({ length: 7 }, (_, i) => addLocal(start, i));
  const inWeek = all.filter(b => { const k = localKey(new Date(b.start)); return k >= days[0] && k <= days[6]; });
  const hrs = inWeek.flatMap(b => [new Date(b.start).getHours(), new Date(b.end).getHours() + (new Date(b.end).getMinutes() ? 1 : 0)]);
  const h0 = Math.min(8, ...hrs), h1 = Math.max(18, ...hrs), span = (h1 - h0) * 60;
  const pos = iso => { const d = new Date(iso); return ((d.getHours() - h0) * 60 + d.getMinutes()) / span * 100; };
  const nowPos = pos(new Date().toISOString());
  return <div className="svWeek" role="group" aria-label={'Week of ' + keyDate(start).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}>
    <div className="svWeekHead"><span className="svGutter" />{days.map(k => <span key={k} className={'svDayHead' + (k === t ? ' today' : '')}>
      <small>{keyDate(k).toLocaleDateString('en-US', { weekday: 'short' })}</small><strong>{keyDate(k).getDate()}</strong></span>)}</div>
    <div className="svWeekBody" style={{ '--hours': h1 - h0 }}>
      <div className="svGutter" aria-hidden="true">{Array.from({ length: h1 - h0 }, (_, i) => <span key={i}>{new Date(2000, 0, 1, h0 + i).toLocaleTimeString('en-US', { hour: 'numeric' })}</span>)}</div>
      {days.map(k => <div key={k} role="group" className={'svCol' + (k === t ? ' today' : '')} aria-label={keyDate(k).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}>
        {k === t && nowPos > 0 && nowPos < 100 && <i className="svNow" style={{ top: nowPos + '%' }} aria-hidden="true" />}
        {inWeek.filter(b => localKey(new Date(b.start)) === k).map(b => <button key={b.id} type="button" className={'svEvent st-' + b.status} style={{ top: pos(b.start) + '%', height: `max(26px, ${minutes(b.start, b.end) / span * 100}%)` }}
          onClick={() => go({ page: 'booking', id: b.id })} aria-label={`${time(b.start)}–${time(b.end)}: ${b.name || 'Guest'}, ${b.title}, ${STATUS[b.status][0]}`}>
          <strong>{b.name || 'Guest'}</strong><small>{time(b.start)} · {b.title}</small></button>)}
      </div>)}
    </div>
  </div>;
}

function MonthView({ anchor: a, bookings: all, today: t, onDay }) {
  const { go } = useAdmin();
  const first = keyDate(a); first.setDate(1);
  const start = mondayOf(localKey(first)), month = first.getMonth();
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addLocal(start, w * 7 + d)));
  const byDay = new Map(); for (const b of all) { const k = localKey(new Date(b.start)); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(b); }
  return <div className="svMonth" role="group" aria-label={first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}>
    <div className="svMonthHead">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <span key={d}>{d}</span>)}</div>
    {weeks.map((w, i) => <div key={i} className="svMonthRow">{w.map(k => { const list = byDay.get(k) || [], d = keyDate(k); return <div key={k} className={'svCell' + (d.getMonth() !== month ? ' out' : '') + (k === t ? ' today' : '')}>
      <button type="button" className="svCellNum" aria-label={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}: ${list.length} booking${list.length === 1 ? '' : 's'}. Open week`} onClick={() => onDay(k)}>{d.getDate()}</button>
      {list.slice(0, 3).map(b => <button key={b.id} type="button" className={'svChip st-' + b.status} onClick={() => go({ page: 'booking', id: b.id })}><i aria-hidden="true" />{time(b.start)} {b.name || 'Guest'}</button>)}
      {list.length > 3 && <button type="button" className="svMore" onClick={() => onDay(k)}>+{list.length - 3} more</button>}
    </div>; })}</div>)}
  </div>;
}

function BookingList({ bookings, filter, setFilter }) {
  const { go, fmt } = useAdmin();
  const now = Date.now();
  const sets = {
    upcoming: bookings.filter(b => ACTIVE_BOOKING.includes(b.status) && Date.parse(b.end) >= now),
    requested: bookings.filter(b => b.status === 'requested'),
    past: bookings.filter(b => Date.parse(b.end) < now && b.status !== 'cancelled').reverse(),
    cancelled: bookings.filter(b => b.status === 'cancelled').reverse(),
    all: bookings.slice().reverse(),
  };
  const list = sets[filter] || sets.upcoming;
  return <>
    <div className="caToolbar"><Segmented label="Booking filter" value={filter} onChange={setFilter} options={[['upcoming', 'Upcoming', sets.upcoming.length], ['requested', 'Requested', sets.requested.length], ['past', 'Past', sets.past.length], ['cancelled', 'Cancelled', sets.cancelled.length], ['all', 'All', sets.all.length]]} /></div>
    {list.length ? <div className="caTableWrap"><table className="caTable" aria-label="Bookings">
      <thead><tr><th>When</th><th>Customer</th><th>Service</th><th>Status</th><th>Where</th><th className="n">Price</th></tr></thead>
      <tbody>{list.map(b => <tr key={b.id} className="click" onClick={() => go({ page: 'booking', id: b.id })}>
        <td><button type="button" className="caLink" onClick={e => { e.stopPropagation(); go({ page: 'booking', id: b.id }); }}>{dayLabel(b.start)} · {time(b.start)}</button></td>
        <td>{b.name || 'Guest'}<small className="svSubText">{b.email}</small></td><td>{b.title}</td><td><StatusBadge status={b.status} /></td>
        <td><span className="svWhere"><LocIcon mode={b.location.mode} />{b.location.mode === 'online' ? 'Online' : b.location.mode === 'in_person' ? 'In person' : 'Async'}</span></td>
        <td className="n">{b.price ? fmt(b.price) : '—'}</td></tr>)}</tbody></table></div>
      : <Empty art="generic" title="Nothing here">No bookings match this filter.</Empty>}
  </>;
}

// ---------------------------------------------------------------- slot picker & new booking
function SlotPicker({ product, date, setDate, value, onPick, exclude }) {
  const { commerce } = useAdmin();
  const slots = useMemo(() => product ? bookingSlots(product, { from: date, days: 1, bookings: commerce.bookings.filter(b => b.id !== exclude), now: Date.now() }) : [], [product, date, commerce.bookings, exclude]);
  return <div className="svPick">
    <Text label="Date" type="date" value={date} onChange={v => v && setDate(v)} hint={product ? `Times in ${product.service.booking.timezone === localTz() ? 'your time zone' : product.service.booking.timezone + ' (shown in your time zone)'}` : undefined} />
    <div className="svSlotGrid" role="radiogroup" aria-label="Available times">
      {slots.length ? slots.map(s => <button key={s.start} type="button" role="radio" aria-checked={value === s.start} className={'svSlot' + (value === s.start ? ' on' : '')} onClick={() => onPick(s)}>{time(s.start)}</button>)
        : <span className="caMuted">No open times on this day.</span>}
    </div>
  </div>;
}
const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };

function NewBookingDialog({ onClose }) {
  const { store, commerce, editCommerce, notify, go } = useAdmin();
  const svcs = serviceProducts(store).filter(p => p.service.booking.enabled);
  const [pid, setPid] = useState(svcs[0] ? svcs[0].id : '');
  const product = svcs.find(p => p.id === pid);
  const [date, setDate] = useState(() => product ? zonedDay(Date.now(), product.service.booking.timezone) : localKey(new Date()));
  const [slot, setSlot] = useState(null);
  const [cid, setCid] = useState('');
  const [name, setName] = useState(''), [email, setEmail] = useState('');
  const [status, setStatus] = useState('confirmed');
  const customers = commerce.customers.slice().sort((a, b) => customerName(a).localeCompare(customerName(b)));
  const ok = product && slot && (cid || name.trim());
  const save = () => {
    const cu = commerce.customers.find(c => c.id === cid) || null;
    const b = newBooking(product, { start: slot.start, customer: cu, name: name.trim(), email: email.trim(), status });
    editCommerce(d => { d.bookings.push(b); }, 'Booking added'); notify('Booking added for ' + dayLabel(b.start) + ' at ' + time(b.start)); onClose(); go({ page: 'booking', id: b.id });
  };
  return <Modal title="New booking" onClose={onClose} wide footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!ok} onClick={save}>Add booking</Btn></>}>
    {!svcs.length ? <p className="caText">Add a service product with booking turned on first.</p> : <div className="caForm">
      <div className="caForm two">
        <Select label="Service" value={pid} onChange={v => { setPid(v); setSlot(null); }} options={svcs.map(p => [p.id, p.title])} />
        <Select label="Status" value={status} onChange={setStatus} options={[['confirmed', 'Confirmed'], ['requested', 'Requested']]} />
      </div>
      <div className="caForm two">
        <Select label="Customer" value={cid} onChange={setCid} options={[['', 'New customer…'], ...customers.map(c => [c.id, customerName(c) + (c.email ? ' · ' + c.email : '')])]} />
        {!cid && <div className="caForm two"><Text label="Name" value={name} onChange={setName} /><Text label="Email" type="email" value={email} onChange={setEmail} /></div>}
      </div>
      <SlotPicker product={product} date={date} setDate={d => { setDate(d); setSlot(null); }} value={slot && slot.start} onPick={setSlot} />
    </div>}
  </Modal>;
}

// ---------------------------------------------------------------- booking detail
export function BookingDetail({ id }) {
  const { store, commerce, editCommerce, go, notify, fmt } = useAdmin();
  const b = commerce.bookings.find(x => x.id === id);
  const product = b && store.products.find(p => p.id === b.productId);
  const [notes, setNotes] = useState(b ? b.notes : '');
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(() => b ? zonedDay(Date.parse(b.start), b.timezone) : '');
  const [slot, setSlot] = useState(null);
  if (!b) return <Page title="Booking not found" back={back(go, 'bookings', 'Back to bookings')}><Empty art="generic" title="This booking does not exist anymore" /></Page>;
  const customer = b.customerId && commerce.customers.find(c => c.id === b.customerId);
  const order = b.orderId && commerce.orders.find(o => o.id === b.orderId);
  const edit = (fn, label) => editCommerce(d => { const x = d.bookings.find(y => y.id === id); fn(x); }, label);
  const setStatus = st => { if (st === b.status) return; edit(x => { x.status = st; x.history.push(historyEntry('Status changed to ' + STATUS[st][0].toLowerCase())); }, 'Booking ' + STATUS[st][0].toLowerCase()); notify('Booking marked as ' + STATUS[st][0].toLowerCase()); };
  const reschedule = () => {
    if (!slot) return;
    const from = dayLabel(b.start) + ' ' + time(b.start);
    edit(x => { x.start = slot.start; x.end = slot.end; if (x.status === 'cancelled' || x.status === 'no_show') x.status = 'confirmed'; x.history.push(historyEntry(`Rescheduled from ${from} to ${dayLabel(slot.start)} ${time(slot.start)}`)); }, 'Booking rescheduled');
    notify('Booking moved to ' + dayLabel(slot.start) + ' at ' + time(slot.start)); setMoving(false); setSlot(null);
  };
  const quick = { requested: [['confirmed', 'Confirm'], ['cancelled', 'Decline']], confirmed: [['completed', 'Mark completed'], ['no_show', 'No-show'], ['cancelled', 'Cancel booking']], completed: [], cancelled: [['confirmed', 'Restore']], no_show: [['completed', 'Mark completed']] }[b.status];
  return <Page title={b.title} subtitle={`${dayLabel(b.start, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · ${time(b.start)}–${time(b.end)}`} back={back(go, 'bookings', 'Back to bookings')}
    actions={<><StatusBadge status={b.status} />{quick.map(([st, l]) => <Btn key={st} kind={st === 'confirmed' || st === 'completed' ? 'primary' : st === 'cancelled' ? 'danger' : ''} onClick={() => setStatus(st)}>{l}</Btn>)}</>}>
    {b.sample && <p className="svSampleNote">Sample booking — <em>Clear sample data</em> on Services removes it.</p>}
    <div className="caCols">
      <div className="caColMain">
        <Card title="Appointment" actions={<Btn icon={CalendarDays} onClick={() => setMoving(v => !v)} aria-expanded={moving}>Reschedule</Btn>}>
          <dl className="svFacts">
            <div><dt>When</dt><dd>{dayLabel(b.start, { weekday: 'long', month: 'long', day: 'numeric' })}, {time(b.start)} – {time(b.end)} <span className="caMuted">({minutes(b.start, b.end)} min)</span></dd></div>
            <div><dt>Where</dt><dd><span className="svWhere"><LocIcon mode={b.location.mode} />{b.location.mode === 'online' ? (b.location.meetingUrl ? <a href={b.location.meetingUrl} target="_blank" rel="noopener noreferrer">{b.location.meetingUrl.replace(/^https?:\/\//, '')}</a> : 'Online meeting') : b.location.mode === 'in_person' ? b.location.address || 'In person' : 'Async delivery'}</span></dd></div>
            <div><dt>Service time zone</dt><dd>{b.timezone}</dd></div>
            <div><dt>Price</dt><dd>{b.price ? fmt(b.price) : '—'}</dd></div>
          </dl>
          {moving && <div className="svMove">
            <h3 className="caSub">Pick a new time</h3>
            {product && product.service ? <SlotPicker product={product} date={date} setDate={d => { setDate(d); setSlot(null); }} value={slot && slot.start} onPick={setSlot} exclude={b.id} /> : <p className="caMuted">The service product was deleted, so open times cannot be shown.</p>}
            <div className="caInline"><Btn onClick={() => { setMoving(false); setSlot(null); }}>Cancel</Btn><Btn kind="primary" disabled={!slot} onClick={reschedule}>Move booking</Btn></div>
          </div>}
        </Card>
        <Card title="Intake answers">
          {b.intake.length ? <dl className="svIntake">{b.intake.map((q, i) => <div key={i}><dt>{q.question}</dt><dd>{q.answer || <span className="caMuted">No answer</span>}</dd></div>)}</dl> : <p className="caMuted">The buyer did not answer any intake questions.</p>}
        </Card>
        <Card title="Notes" actions={notes !== b.notes && <Btn kind="primary" onClick={() => { edit(x => { x.notes = notes; }, 'Booking notes saved'); notify('Notes saved'); }}>Save notes</Btn>}>
          <textarea className="caInput" rows={4} aria-label="Booking notes" placeholder="Private notes about this booking" value={notes} onChange={e => setNotes(e.target.value)} />
        </Card>
        <Card title="History">
          <ol className="svHistory">{b.history.slice().reverse().map(h => <li key={h.id}><span>{h.message}</span><small>{fmtDate(h.at, true)}</small></li>)}</ol>
        </Card>
      </div>
      <div className="caColSide">
        <Card title="Status"><Select label="Booking status" value={b.status} onChange={setStatus} options={BOOKING_STATUSES.map(([k, l]) => [k, l])} /></Card>
        <Card title="Customer">
          <p className="svCust"><strong>{b.name || (customer ? customerName(customer) : 'Guest')}</strong>{b.email && <a href={'mailto:' + b.email}>{b.email}</a>}</p>
          {customer && <Btn kind="plain" onClick={() => go({ page: 'customer', id: customer.id })}>View customer<ChevronRight size={14} /></Btn>}
        </Card>
        {order && <Card title="Order"><p className="svCust"><button type="button" className="caLink" onClick={() => go({ page: 'order', id: order.id })}>{order.name}</button><small className="caMuted">{fmt(order.totals.total)} · {fmtDate(order.createdAt)}</small></p></Card>}
      </div>
    </div>
  </Page>;
}

// ---------------------------------------------------------------- projects board
export function ProjectsBoard() {
  const { commerce, editCommerce, go, fmt, notify } = useAdmin();
  const [drag, setDrag] = useState(null), [over, setOver] = useState(null);
  const today = localKey(new Date());
  const move = (id, stage) => {
    const p = commerce.serviceProjects.find(x => x.id === id); if (!p || p.stage === stage) return;
    editCommerce(d => { const x = d.serviceProjects.find(y => y.id === id); x.stage = stage; x.updatedAt = new Date().toISOString(); if (stage === 'revision') x.revisionsUsed = Math.min(99, x.revisionsUsed + 1); }, 'Project moved');
    notify(`${p.title} moved to ${STAGE[stage]}`);
  };
  const projects = commerce.serviceProjects;
  return <Page title="Projects" subtitle="Client work for your services, from kickoff to sign-off" actions={<Btn icon={CalendarDays} onClick={() => go('bookings')}>Bookings</Btn>}>
    {!projects.length ? <Card><Empty art="generic" title="No projects yet" action={<SampleDataButton onlyLoad />}>Each order of a service without a booking time — packages, retainers, async work — becomes a project you move across the board.</Empty></Card>
      : <div className="svBoard" aria-label="Projects board">
        {PROJECT_STAGES.map(([stage, label], si) => { const list = projects.filter(p => p.stage === stage).sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'));
          return <section key={stage} className={'svLane' + (over === stage ? ' over' : '')} aria-label={`${label}: ${list.length} project${list.length === 1 ? '' : 's'}`}
            onDragOver={e => { if (drag) { e.preventDefault(); setOver(stage); } }} onDragLeave={() => setOver(o => o === stage ? null : o)} onDrop={e => { e.preventDefault(); if (drag) move(drag, stage); setDrag(null); setOver(null); }}>
            <header className="svLaneHead"><i className={'s-' + stage} aria-hidden="true" /><h2>{label}</h2><span className="svCount">{list.length}</span><small>{fmt(list.reduce((s, p) => s + p.value, 0), true)}</small></header>
            <ul>{list.map(p => { const done = p.deliverables.filter(d => d.done).length, total = p.deliverables.length, late = p.dueDate && p.dueDate < today && !['delivered', 'completed'].includes(stage);
              return <li key={p.id} className={'svTask' + (drag === p.id ? ' dragging' : '')} draggable onDragStart={e => { setDrag(p.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', p.id); } catch { /* ignore */ } }} onDragEnd={() => { setDrag(null); setOver(null); }}>
                <button type="button" className="svTaskMain" onClick={() => go({ page: 'project', id: p.id })}>
                  <strong>{p.title}</strong>
                  <span className="svTaskMeta">{p.dueDate && <span className={'svDue' + (late ? ' late' : '')}><Clock size={11} aria-hidden="true" />{late ? 'Overdue · ' : 'Due '}{keyDate(p.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                    <span><MessageSquare size={11} aria-hidden="true" />{p.messages.length}</span><span>{fmt(p.value)}</span></span>
                  {total > 0 && <span className="svProg" role="progressbar" aria-label="Deliverables done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><i style={{ width: `${done / total * 100}%` }} /><small>{done}/{total}</small></span>}
                </button>
                <div className="svTaskMove">
                  {si > 0 && <button type="button" className="caIconBtn sm" aria-label={`Move ${p.title} to ${PROJECT_STAGES[si - 1][1]}`} title={'Move to ' + PROJECT_STAGES[si - 1][1]} onClick={() => move(p.id, PROJECT_STAGES[si - 1][0])}><ChevronLeft size={13} /></button>}
                  {si < PROJECT_STAGES.length - 1 && <button type="button" className="caIconBtn sm" aria-label={`Move ${p.title} to ${PROJECT_STAGES[si + 1][1]}`} title={'Move to ' + PROJECT_STAGES[si + 1][1]} onClick={() => move(p.id, PROJECT_STAGES[si + 1][0])}><ChevronRight size={13} /></button>}
                </div>
              </li>; })}
              {!list.length && <li className="svLaneEmpty">Drop a project here</li>}</ul>
          </section>; })}
      </div>}
  </Page>;
}

// ---------------------------------------------------------------- project detail
export function ProjectDetail({ id }) {
  const { commerce, editCommerce, go, fmt, notify } = useAdmin();
  const p = commerce.serviceProjects.find(x => x.id === id);
  const [msg, setMsg] = useState(''), [from, setFrom] = useState('merchant'), [item, setItem] = useState('');
  if (!p) return <Page title="Project not found" back={back(go, 'projects', 'Back to projects')}><Empty art="generic" title="This project does not exist anymore" /></Page>;
  const edit = (fn, label) => editCommerce(d => { const x = d.serviceProjects.find(y => y.id === id); fn(x); x.updatedAt = new Date().toISOString(); }, label);
  const customer = p.customerId && commerce.customers.find(c => c.id === p.customerId);
  const order = p.orderId && commerce.orders.find(o => o.id === p.orderId);
  const done = p.deliverables.filter(d => d.done).length;
  const send = e => { e.preventDefault(); if (!msg.trim()) return; edit(x => { x.messages.push({ id: sid('msg'), at: new Date().toISOString(), from, text: msg.trim() }); }, 'Message added'); setMsg(''); notify(from === 'merchant' ? 'Message sent' : 'Client message logged'); };
  return <Page title={p.title} subtitle={`${STAGE[p.stage]}${p.dueDate ? ' · due ' + keyDate(p.dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : ''}`} back={back(go, 'projects', 'Back to projects')}>
    {p.sample && <p className="svSampleNote">Sample project — <em>Clear sample data</em> on Services removes it.</p>}
    <Card pad={false} className="svStageCard"><div className="caToolbar"><Segmented label="Project stage" value={p.stage} onChange={st => { edit(x => { if (st === 'revision' && x.stage !== 'revision') x.revisionsUsed = Math.min(99, x.revisionsUsed + 1); x.stage = st; }, 'Project stage changed'); notify('Moved to ' + STAGE[st]); }} options={PROJECT_STAGES} /></div></Card>
    <div className="caCols">
      <div className="caColMain">
        <Card title={`Deliverables · ${done} of ${p.deliverables.length}`}>
          {p.deliverables.length > 0 && <ul className="svChecklist">{p.deliverables.map(d => <li key={d.id}>
            <label className={d.done ? 'done' : ''}><input type="checkbox" checked={d.done} onChange={e => edit(x => { x.deliverables.find(y => y.id === d.id).done = e.target.checked; }, 'Deliverable updated')} /><span>{d.label}</span></label>
            <button type="button" className="caIconBtn sm" aria-label={`Remove ${d.label}`} onClick={() => edit(x => { x.deliverables = x.deliverables.filter(y => y.id !== d.id); }, 'Deliverable removed')}>×</button></li>)}</ul>}
          <form className="caInline" onSubmit={e => { e.preventDefault(); if (!item.trim()) return; edit(x => { x.deliverables.push({ id: sid('dv'), label: item.trim(), done: false }); }, 'Deliverable added'); setItem(''); }}>
            <input className="caInput" aria-label="New deliverable" placeholder="Add a deliverable…" value={item} onChange={e => setItem(e.target.value)} /><Btn type="submit" icon={Plus}>Add</Btn></form>
        </Card>
        <Card title="Messages" className="svThreadCard">
          {p.messages.length ? <ol className="svThread" aria-label="Messages with the client">{p.messages.map(m => <li key={m.id} className={m.from}>
            <span className="svBubble">{m.text}</span><small>{m.from === 'client' ? (p.name || 'Client') : 'You'} · {fmtDate(m.at, true)}</small></li>)}</ol> : <p className="caMuted">No messages yet.</p>}
          <form className="svCompose" onSubmit={send}>
            <Segmented label="Message from" value={from} onChange={setFrom} options={[['merchant', 'You'], ['client', 'Client']]} />
            <textarea className="caInput" rows={2} aria-label="Message" placeholder={from === 'merchant' ? 'Write to ' + (p.name || 'the client') + '…' : 'Paste the client’s message…'} value={msg} onChange={e => setMsg(e.target.value)} />
            <Btn type="submit" kind="primary" icon={Send} disabled={!msg.trim()}>{from === 'merchant' ? 'Send' : 'Log'}</Btn>
          </form>
          <p className="caHint">Messages are kept with the project. Emails are not sent from this browser-only store.</p>
        </Card>
      </div>
      <div className="caColSide">
        <Card title="Details">
          <div className="caForm">
            <Text label="Due date" type="date" value={p.dueDate} onChange={v => edit(x => { x.dueDate = v; }, 'Due date changed')} />
            <div className="caForm two">
              <Num label="Revisions used" value={p.revisionsUsed} min={0} max={99} step={1} onChange={v => edit(x => { x.revisionsUsed = Math.round(v || 0); }, 'Revisions updated')} />
              <Num label="Included" value={p.revisionsIncluded} min={0} max={99} step={1} onChange={v => edit(x => { x.revisionsIncluded = Math.round(v || 0); }, 'Revisions updated')} />
            </div>
            {p.revisionsUsed > p.revisionsIncluded && <p className="caWarn">{p.revisionsUsed - p.revisionsIncluded} revision{p.revisionsUsed - p.revisionsIncluded === 1 ? '' : 's'} beyond what is included.</p>}
            <dl className="svFacts"><div><dt>Value</dt><dd>{fmt(p.value)}</dd></div><div><dt>Started</dt><dd>{fmtDate(p.createdAt)}</dd></div></dl>
          </div>
        </Card>
        <Card title="Client">
          <p className="svCust"><strong>{p.name || (customer ? customerName(customer) : 'Client')}</strong>{p.email && <a href={'mailto:' + p.email}>{p.email}</a>}</p>
          {customer && <Btn kind="plain" onClick={() => go({ page: 'customer', id: customer.id })}>View customer<ChevronRight size={14} /></Btn>}
          {order && <Btn kind="plain" icon={ExternalLink} onClick={() => go({ page: 'order', id: order.id })}>Order {order.name}</Btn>}
        </Card>
        {p.stage !== 'completed' && <Btn kind="primary" icon={CheckIcon} onClick={() => { edit(x => { x.stage = 'completed'; for (const d of x.deliverables) d.done = true; }, 'Project completed'); notify('Project completed'); }}>Mark project completed</Btn>}
      </div>
    </div>
  </Page>;
}
