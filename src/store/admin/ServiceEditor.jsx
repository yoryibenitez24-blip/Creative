// Product editor cards for service and digital products (src/store/admin/Products.jsx shows them by product kind):
// pricing model, duration, delivery, booking (weekly availability with a live preview of the next open slots), intake
// questions, deliverables and revisions, add-ons and FAQ; for digital downloads the file and the download limit.
// Fields: src/store/serviceProduct.js.
import React, { useMemo, useRef } from 'react';
import { Plus, Trash2, Upload, CalendarClock } from 'lucide-react';
import { useAdmin, Card, Btn, Text, Num, Select, Check, Segmented } from './ui.jsx';
import { PRODUCT_KINDS, PRICING_MODELS, DELIVERY_MODES, INTAKE_TYPES, DAY_NAMES, normalizeService, normalizeDigital } from '../serviceProduct.js';
import { bookingSlots, zonedDay } from './services.js';

const ZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Stockholm', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland'];
export const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
let k = 0; const rid = p => p + '_' + Date.now().toString(36) + (k++).toString(36);
const PRICE_HINT = { fixed: 'The product price is the price of one session.', hourly: 'The product price is the hourly rate.', package: 'The product price buys the whole package.', retainer: 'The product price is billed every month.' };

/** Physical | Service | Digital download. onChange(kind). */
export function KindPicker({ value, onChange }) {
  return <div className="caField"><span className="caLabel" aria-hidden="true">Kind of product</span>
    <Segmented label="Kind of product" value={value} onChange={onChange} options={PRODUCT_KINDS.map(([key, label]) => [key, label])} /></div>;
}

/** Switch the product draft `p` to `kind` (mutates the draft; service and digital fields get their defaults). */
export function applyKind(p, kind) {
  if (kind === 'physical') { delete p.kind; return; }
  p.kind = kind;
  if (kind === 'service') { p.service = normalizeService(p.service || { booking: { timezone: localZone() } }); for (const v of p.variants) v.stock = null; }
  if (kind === 'digital') { p.digital = normalizeDigital(p.digital); for (const v of p.variants) v.stock = null; }
}

const Row = ({ children, label }) => <div className="svRow" role="group" aria-label={label}>{children}</div>;
const Remove = ({ label, onClick }) => <button type="button" className="caIconBtn sm" aria-label={label} title="Remove" onClick={onClick}><Trash2 size={13} /></button>;

export function ServiceCards({ p, set }) {
  const { commerce } = useAdmin();
  const s = useMemo(() => normalizeService(p.service), [p.service]);
  const S = fn => set(d => { d.p.service = normalizeService(d.p.service); fn(d.p.service); });
  const preview = useMemo(() => {
    if (!s.booking.enabled) return [];
    const now = Date.now();
    return bookingSlots({ ...p, service: s }, { from: zonedDay(now, s.booking.timezone), days: 14, bookings: commerce.bookings || [], now }).slice(0, 10);
  }, [p, s, commerce.bookings]);
  const zones = ZONES.includes(s.booking.timezone) ? ZONES : [s.booking.timezone, ...ZONES];
  const fmtSlot = iso => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: s.booking.timezone });

  return <>
    <Card title="Service">
      <div className="caForm three">
        <Select label="Pricing model" value={s.pricing.model} onChange={v => S(x => { x.pricing.model = v; })} options={PRICING_MODELS} hint={PRICE_HINT[s.pricing.model]} />
        {s.pricing.model === 'package' && <Num label="Sessions in the package" value={s.pricing.sessions} min={2} max={100} step={1} onChange={v => S(x => { x.pricing.sessions = Math.round(v || 2); })} />}
        {s.pricing.model === 'retainer' && <Text label="Stripe price ID" value={s.pricing.stripePriceId} placeholder="price_…" onChange={v => S(x => { x.pricing.stripePriceId = v; })} hint="A recurring monthly price from your Stripe dashboard." />}
        <Num label="Session length" value={s.durationMinutes} min={15} max={480} step={5} suffix="min" onChange={v => S(x => { x.durationMinutes = Math.round(v || 60); })} />
      </div>
      <div className="caForm three">
        <Select label="Delivery" value={s.delivery.mode} onChange={v => S(x => { x.delivery.mode = v; })} options={DELIVERY_MODES} />
        {s.delivery.mode === 'online' && <Text label="Meeting link" value={s.delivery.meetingUrl} placeholder="https://meet.example.com/…" onChange={v => S(x => { x.delivery.meetingUrl = v; })} hint="Sent to the customer with the confirmation." />}
        {s.delivery.mode === 'in_person' && <Text label="Address" value={s.delivery.address} onChange={v => S(x => { x.delivery.address = v; })} />}
        {s.delivery.mode === 'async' && <Num label="Turnaround" value={s.delivery.turnaroundDays} min={0} max={365} step={1} suffix="days" onChange={v => S(x => { x.delivery.turnaroundDays = Math.round(v || 0); })} hint="Sets the due date of new projects." />}
      </div>
    </Card>

    <Card title="Booking" actions={<Check label="Customers book a time" checked={s.booking.enabled} onChange={v => S(x => { x.booking.enabled = v; })} />}>
      {s.booking.enabled ? <>
        <div className="caForm three">
          <Select label="Time zone" value={s.booking.timezone} onChange={v => S(x => { x.booking.timezone = v; })} options={zones} />
          <Num label="Buffer between sessions" value={s.booking.bufferMinutes} min={0} max={240} step={5} suffix="min" onChange={v => S(x => { x.booking.bufferMinutes = Math.round(v || 0); })} />
          <Num label="Max bookings per day" value={s.booking.maxPerDay || null} allowEmpty min={1} max={48} step={1} onChange={v => S(x => { x.booking.maxPerDay = v == null ? 0 : Math.round(v); })} hint="Blank = no limit." />
        </div>
        <h3 className="caSub">Weekly availability</h3>
        <div className="svSlots">
          {s.booking.availability.map((a, i) => <Row key={i} label={`Availability ${i + 1}`}>
            <select className="caInput" aria-label={`Availability ${i + 1} day`} value={a.day} onChange={e => S(x => { x.booking.availability[i].day = +e.target.value; })}>{DAY_NAMES.map((d, j) => <option key={d} value={j}>{d}</option>)}</select>
            <input className="caInput" type="time" aria-label={`Availability ${i + 1} from`} value={a.start} onChange={e => S(x => { x.booking.availability[i].start = e.target.value; })} />
            <span className="caMuted">to</span>
            <input className="caInput" type="time" aria-label={`Availability ${i + 1} to`} value={a.end} onChange={e => S(x => { x.booking.availability[i].end = e.target.value; })} />
            <Remove label={`Remove availability ${i + 1}`} onClick={() => S(x => { x.booking.availability.splice(i, 1); })} />
          </Row>)}
          <Btn icon={Plus} onClick={() => S(x => { const last = x.booking.availability[x.booking.availability.length - 1]; x.booking.availability.push({ day: last ? (last.day + 1) % 7 : 1, start: last ? last.start : '09:00', end: last ? last.end : '17:00' }); })}>Add hours</Btn>
        </div>
        <div className="svPreview" aria-label="Next open slots">
          <span className="svPreviewHead"><CalendarClock size={14} aria-hidden="true" />Next open slots</span>
          {preview.length ? <ul>{preview.map(x => <li key={x.start}>{fmtSlot(x.start)}</li>)}</ul> : <span className="caMuted">No open slots in the next two weeks.</span>}
        </div>
      </> : <p className="caMuted">Customers buy this service without picking a time. Projects for it appear on the Services › Projects board.</p>}
    </Card>

    <Card title="Intake questions" actions={<Btn icon={Plus} onClick={() => S(x => { x.intake.push({ id: rid('q'), label: 'New question', type: 'text', required: false, options: [] }); })}>Add question</Btn>}>
      <p className="caHint svLead">The buyer answers these at checkout; the answers are shown on the booking.</p>
      {s.intake.length ? <ol className="svList">{s.intake.map((q, i) => <li key={q.id}><Row label={`Question ${i + 1}`}>
        <input className="caInput svGrow" aria-label={`Question ${i + 1}`} value={q.label} onChange={e => S(x => { x.intake[i].label = e.target.value; })} />
        <select className="caInput" aria-label={`Question ${i + 1} answer type`} value={q.type} onChange={e => S(x => { x.intake[i].type = e.target.value; })}>{INTAKE_TYPES.map(([kk, l]) => <option key={kk} value={kk}>{l}</option>)}</select>
        <label className="svInlineCheck"><input type="checkbox" checked={q.required} onChange={e => S(x => { x.intake[i].required = e.target.checked; })} />Required</label>
        <Remove label={`Remove question ${i + 1}`} onClick={() => S(x => { x.intake.splice(i, 1); })} />
      </Row>{q.type === 'select' && <input className="caInput svSubInput" aria-label={`Question ${i + 1} choices`} placeholder="Choices, separated by commas" defaultValue={q.options.join(', ')}
        onBlur={e => S(x => { x.intake[i].options = e.target.value.split(',').map(o => o.trim()).filter(Boolean); })} />}</li>)}</ol>
        : <p className="caMuted">No questions yet.</p>}
    </Card>

    <Card title="Deliverables and revisions">
      <ListEditor label="Deliverable" items={s.deliverables} onChange={v => S(x => { x.deliverables = v; })} placeholder="e.g. Final files" />
      <div className="caForm three"><Num label="Revisions included" value={s.revisions} min={0} max={99} step={1} onChange={v => S(x => { x.revisions = Math.round(v || 0); })} /></div>
    </Card>

    <Card title="Add-ons" actions={<Btn icon={Plus} onClick={() => S(x => { x.addOns.push({ id: rid('ao'), name: 'Add-on', price: 0 }); })}>Add add-on</Btn>}>
      {s.addOns.length ? <div className="svSlots">{s.addOns.map((a, i) => <Row key={a.id} label={`Add-on ${i + 1}`}>
        <input className="caInput svGrow" aria-label={`Add-on ${i + 1} name`} value={a.name} onChange={e => S(x => { x.addOns[i].name = e.target.value; })} />
        <input className="caInput svPrice" type="number" min="0" step="any" aria-label={`Add-on ${i + 1} price`} value={a.price} onChange={e => S(x => { x.addOns[i].price = +e.target.value || 0; })} />
        <Remove label={`Remove add-on ${i + 1}`} onClick={() => S(x => { x.addOns.splice(i, 1); })} />
      </Row>)}</div> : <p className="caMuted">Optional extras the buyer can add, like a rush delivery.</p>}
    </Card>

    <Card title="FAQ" actions={<Btn icon={Plus} onClick={() => S(x => { x.faq.push({ id: rid('fq'), q: 'Question', a: '' }); })}>Add question</Btn>}>
      {s.faq.length ? <div className="svFaq">{s.faq.map((f, i) => <div key={f.id} className="svFaqItem" role="group" aria-label={`FAQ ${i + 1}`}>
        <div className="svRow"><input className="caInput svGrow" aria-label={`FAQ ${i + 1} question`} value={f.q} onChange={e => S(x => { x.faq[i].q = e.target.value; })} /><Remove label={`Remove FAQ ${i + 1}`} onClick={() => S(x => { x.faq.splice(i, 1); })} /></div>
        <textarea className="caInput" rows={2} aria-label={`FAQ ${i + 1} answer`} value={f.a} onChange={e => S(x => { x.faq[i].a = e.target.value; })} />
      </div>)}</div> : <p className="caMuted">Answers to what buyers usually ask before booking.</p>}
    </Card>
  </>;
}

function ListEditor({ label, items, onChange, placeholder }) {
  return <div className="svSlots">
    {items.map((it, i) => <Row key={i} label={`${label} ${i + 1}`}>
      <input className="caInput svGrow" aria-label={`${label} ${i + 1}`} value={it} onChange={e => onChange(items.map((x, j) => j === i ? e.target.value : x))} />
      <Remove label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))} />
    </Row>)}
    <Btn icon={Plus} onClick={() => onChange([...items, placeholder ? placeholder.replace(/^e\.g\. /, '') : ''])}>Add {label.toLowerCase()}</Btn>
  </div>;
}

export function DigitalCard({ p, set }) {
  const { upload, notify } = useAdmin();
  const d = normalizeDigital(p.digital), ref = useRef(null);
  const D = fn => set(x => { x.p.digital = normalizeDigital(x.p.digital); fn(x.p.digital); });
  const pick = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const r = await upload(f); D(x => { x.file = r; x.fileName = f.name; }); notify('File attached'); } catch (err) { notify('Upload failed: ' + err.message); }
  };
  return <Card title="Digital download" actions={<Btn icon={Upload} onClick={() => ref.current?.click()}>{d.file ? 'Replace file' : 'Upload file'}</Btn>}>
    <input ref={ref} type="file" hidden aria-label="Upload the downloadable file" onChange={pick} />
    <div className="caForm two">
      <Text label="File name" value={d.fileName} placeholder="guide.pdf" onChange={v => D(x => { x.fileName = v; })} hint={d.file ? (d.file.startsWith('asset:') ? 'Stored with this store’s files.' : 'Linked file.') : 'Upload a file or paste a link below.'} />
      <Num label="Download limit" value={d.downloadLimit} allowEmpty min={1} max={1000} step={1} onChange={v => D(x => { x.downloadLimit = v == null ? null : Math.round(v); })} hint="Downloads per purchase. Blank = unlimited." />
    </div>
    <Text label="File link" value={d.file.startsWith('asset:') || d.file.startsWith('data:') ? '' : d.file} placeholder={d.file.startsWith('asset:') || d.file.startsWith('data:') ? 'Uploaded file attached' : 'https://…'} onChange={v => D(x => { x.file = v; })} />
  </Card>;
}

