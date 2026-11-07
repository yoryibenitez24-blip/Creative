-- Zertake Studio storefront backend: stores, catalog snapshot, customers, orders, payments, refunds, disputes,
-- subscriptions, bookings, analytics, Stripe webhook log, connected accounts.
--
-- Security model
--   * Row Level Security is ON for every table.
--   * Shoppers never write tables directly. Every public write (checkout, analytics, webhooks) goes through an Edge
--     Function that uses the service-role key (which bypasses RLS) after validating the request.
--   * A signed-in merchant (Supabase Auth user) can read — and for a few operational tables update — the rows of the
--     stores they own (stores.owner_id = auth.uid()).
--   * webhooks_log and rate_limits have no policies at all: service role only.
-- All money columns are in the currency's major unit (19.99) unless the column name ends in _minor (Stripe's integer
-- smallest unit, e.g. cents).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- stores: one row per Zertake store (id = the store document id from the app)
-- ---------------------------------------------------------------------------------------------------------------
create table public.stores (
  id               text primary key check (char_length(id) between 1 and 80),
  owner_id         uuid not null references auth.users (id) on delete cascade,
  name             text not null default '',
  currency         text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  site_url         text not null default '',             -- published storefront URL (fallback for return URLs)
  allowed_origins  text[] not null default '{}',         -- origins allowed to call checkout + used for return URLs
  checkout_config  jsonb not null default '{}'::jsonb,   -- checkoutConfig(): discounts, zones, taxes, weights, collections
  payments         jsonb not null default '{}'::jsonb,   -- public Stripe settings (mode, connectType, fees, methods, …)
  email            jsonb not null default '{}'::jsonb,   -- { fromEmail, replyTo, senderName, orderConfirmation: bool }
  stripe_account_id text,
  connect_type     text not null default 'express' check (connect_type in ('express', 'standard', 'custom', 'none')),
  catalog_synced_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index stores_owner_idx on public.stores (owner_id);
create unique index stores_stripe_account_idx on public.stores (stripe_account_id) where stripe_account_id is not null;
create trigger stores_touch before update on public.stores for each row execute function public.touch_updated_at();

-- True when the signed-in user owns the store. SECURITY DEFINER so policies on other tables do not recurse into the
-- stores policies; STABLE so Postgres can cache it per statement.
create or replace function public.is_store_owner(p_store_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.stores s where s.id = p_store_id and s.owner_id = (select auth.uid()));
$$;
revoke all on function public.is_store_owner(text) from public;
grant execute on function public.is_store_owner(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Stripe connected accounts (one per merchant; kept in sync by account.updated webhooks + stripe-connect-status)
-- ---------------------------------------------------------------------------------------------------------------
create table public.connected_accounts (
  stripe_account_id text primary key,
  store_id          text references public.stores (id) on delete set null,
  owner_id          uuid references auth.users (id) on delete cascade,
  type              text not null default 'express',
  country           text,
  default_currency  text,
  email             text,
  charges_enabled   boolean not null default false,
  payouts_enabled   boolean not null default false,
  details_submitted boolean not null default false,
  onboarding_status text not null default 'not_started'
                    check (onboarding_status in ('not_started', 'pending', 'restricted', 'complete', 'rejected')),
  requirements      jsonb not null default '{}'::jsonb,
  livemode          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index connected_accounts_store_idx on public.connected_accounts (store_id);
create index connected_accounts_owner_idx on public.connected_accounts (owner_id);
create trigger connected_accounts_touch before update on public.connected_accounts for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- products: price snapshot the checkout validates carts against (written by sync-catalog; never by shoppers)
-- variants: [{ id, title, options: [..], price (null = product price), sku, stock (null = untracked) }]
-- ---------------------------------------------------------------------------------------------------------------
create table public.products (
  store_id    text not null references public.stores (id) on delete cascade,
  id          text not null,
  title       text not null default '',
  active      boolean not null default true,
  price       numeric(12, 2) not null check (price >= 0),
  compare_at  numeric(12, 2),
  image       text not null default '',
  kind        text not null default 'physical' check (kind in ('physical', 'digital', 'service')),
  recurring   jsonb,                                     -- { interval: 'day'|'week'|'month'|'year', intervalCount }
  service     jsonb,                                     -- normalizeService() of src/store/serviceProduct.js (booking, intake, add-ons, pricing)
  digital     jsonb,                                     -- { file: 'storage:<path>' | https URL, fileName, downloadLimit }
  variants    jsonb not null default '[]'::jsonb check (jsonb_typeof(variants) = 'array'),
  updated_at  timestamptz not null default now(),
  primary key (store_id, id)
);
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------------------------------------------
create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  store_id           text not null references public.stores (id) on delete cascade,
  email              text not null check (email = lower(email)),
  name               text not null default '',
  phone              text not null default '',
  address            jsonb,
  stripe_customer_id text,
  accepts_marketing  boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (store_id, email)
);
create unique index customers_stripe_idx on public.customers (store_id, stripe_customer_id) where stripe_customer_id is not null;
create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- orders + order_lines (created 'pending' by create-checkout-session, completed by stripe-webhook)
-- ---------------------------------------------------------------------------------------------------------------
create table public.orders (
  id                         uuid primary key default gen_random_uuid(),
  number                     bigint generated always as identity,
  store_id                   text not null references public.stores (id) on delete cascade,
  status                     text not null default 'pending' check (status in ('pending', 'open', 'cancelled', 'archived')),
  financial_status           text not null default 'pending'
                             check (financial_status in ('pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'voided', 'failed')),
  fulfillment_status         text not null default 'unfulfilled' check (fulfillment_status in ('unfulfilled', 'partial', 'fulfilled')),
  currency                   text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal                   numeric(12, 2) not null default 0,
  discount_total             numeric(12, 2) not null default 0,
  shipping                   numeric(12, 2) not null default 0,
  shipping_discount          numeric(12, 2) not null default 0,
  tax                        numeric(12, 2) not null default 0,
  tax_inclusive              boolean not null default false,
  total                      numeric(12, 2) not null default 0,
  amount_total_minor         bigint,                      -- what Stripe charged (after Stripe Tax / promotion codes)
  application_fee_minor      bigint not null default 0,
  codes                      text[] not null default '{}',
  applied                    jsonb not null default '[]'::jsonb,
  shipping_rate_id           text,
  shipping_name              text not null default '',
  country                    text not null default '',
  region                     text not null default '',
  customer_id                uuid references public.customers (id) on delete set null,
  email                      text not null default '',
  name                       text not null default '',
  phone                      text not null default '',
  shipping_address           jsonb,
  billing_address            jsonb,
  note                       text not null default '',
  checkout_mode              text not null default 'payment' check (checkout_mode in ('payment', 'subscription')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  stripe_subscription_id     text,
  stripe_customer_id         text,
  stripe_account_id          text,
  livemode                   boolean not null default false,
  source                     text not null default 'storefront',
  session_ref                text not null default '',     -- analytics session id of the shopper
  idempotency_key            text,                         -- one pending order per checkout attempt (see create-checkout-session)
  metadata                   jsonb not null default '{}'::jsonb,
  email_sent_at              timestamptz,
  paid_at                    timestamptz,
  cancelled_at               timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create unique index orders_idempotency_idx on public.orders (store_id, idempotency_key) where idempotency_key is not null;
create index orders_store_created_idx on public.orders (store_id, created_at desc);
create index orders_store_financial_idx on public.orders (store_id, financial_status);
create index orders_payment_intent_idx on public.orders (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index orders_subscription_idx on public.orders (stripe_subscription_id) where stripe_subscription_id is not null;
create index orders_customer_idx on public.orders (customer_id);
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();

create table public.order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  store_id      text not null references public.stores (id) on delete cascade,
  position      int not null default 0,
  product_id    text not null,
  variant_id    text not null,
  title         text not null default '',
  variant_title text not null default '',
  sku           text not null default '',
  unit_price    numeric(12, 2) not null check (unit_price >= 0),
  quantity      int not null check (quantity between 1 and 999),
  total         numeric(12, 2) not null,
  recurring     jsonb,
  kind          text not null default 'physical' check (kind in ('physical', 'digital', 'service')),
  details       jsonb not null default '{}'::jsonb,       -- services: { start, intake: [{ question, answer }], addOns: [{ id, name, price }] }
  created_at    timestamptz not null default now()
);
create index order_lines_order_idx on public.order_lines (order_id);
create index order_lines_store_product_idx on public.order_lines (store_id, product_id);

-- ---------------------------------------------------------------------------------------------------------------
-- payments, refunds, disputes (from Stripe webhooks; upserted by Stripe id → idempotent)
-- ---------------------------------------------------------------------------------------------------------------
create table public.payments (
  id                       uuid primary key default gen_random_uuid(),
  store_id                 text not null references public.stores (id) on delete cascade,
  order_id                 uuid references public.orders (id) on delete set null,
  stripe_payment_intent_id text not null unique,
  stripe_charge_id         text,
  stripe_account_id        text,
  amount_minor             bigint not null default 0,
  amount_received_minor    bigint not null default 0,
  currency                 text not null,
  status                   text not null,                    -- Stripe PaymentIntent status
  capture_method           text not null default 'automatic',
  payment_method_type      text not null default '',
  application_fee_minor    bigint not null default 0,
  livemode                 boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index payments_store_idx on public.payments (store_id, created_at desc);
create index payments_order_idx on public.payments (order_id);
create trigger payments_touch before update on public.payments for each row execute function public.touch_updated_at();

create table public.refunds (
  id                       uuid primary key default gen_random_uuid(),
  store_id                 text not null references public.stores (id) on delete cascade,
  order_id                 uuid references public.orders (id) on delete set null,
  stripe_refund_id         text not null unique,
  stripe_charge_id         text,
  stripe_payment_intent_id text,
  amount_minor             bigint not null,
  currency                 text not null,
  status                   text not null,
  reason                   text not null default '',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index refunds_store_idx on public.refunds (store_id, created_at desc);
create index refunds_order_idx on public.refunds (order_id);
create trigger refunds_touch before update on public.refunds for each row execute function public.touch_updated_at();

create table public.disputes (
  id                       uuid primary key default gen_random_uuid(),
  store_id                 text not null references public.stores (id) on delete cascade,
  order_id                 uuid references public.orders (id) on delete set null,
  stripe_dispute_id        text not null unique,
  stripe_charge_id         text,
  stripe_payment_intent_id text,
  amount_minor             bigint not null,
  currency                 text not null,
  reason                   text not null default '',
  status                   text not null,
  evidence_due_by          timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index disputes_store_idx on public.disputes (store_id, created_at desc);
create trigger disputes_touch before update on public.disputes for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------------------------------------------
create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  store_id               text not null references public.stores (id) on delete cascade,
  customer_id            uuid references public.customers (id) on delete set null,
  order_id               uuid references public.orders (id) on delete set null,
  stripe_subscription_id text not null unique,
  stripe_customer_id     text,
  status                 text not null,
  items                  jsonb not null default '[]'::jsonb,
  cancel_at_period_end   boolean not null default false,
  current_period_end     timestamptz,
  trial_end              timestamptz,
  canceled_at            timestamptz,
  livemode               boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index subscriptions_store_idx on public.subscriptions (store_id, status);
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- bookings (appointments / services sold through the store)
-- ---------------------------------------------------------------------------------------------------------------
create table public.bookings (
  id          uuid primary key default gen_random_uuid(),
  store_id    text not null references public.stores (id) on delete cascade,
  order_id    uuid references public.orders (id) on delete set null,
  customer_id uuid references public.customers (id) on delete set null,
  product_id  text not null default '',
  variant_id  text not null default '',
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  timezone    text not null default 'UTC',
  status      text not null default 'requested' check (status in ('requested', 'confirmed', 'completed', 'cancelled', 'no_show')),
  attendee    jsonb not null default '{}'::jsonb,         -- { name, email, phone }
  intake      jsonb not null default '[]'::jsonb,         -- [{ question, answer }] answers to the service's intake questions
  add_ons     jsonb not null default '[]'::jsonb,         -- [{ id, name, price }]
  price       numeric(12, 2) not null default 0,
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index bookings_store_time_idx on public.bookings (store_id, starts_at);
create trigger bookings_touch before update on public.bookings for each row execute function public.touch_updated_at();

-- service projects (services without booking: delivered asynchronously; mirrors commerce.serviceProjects in the admin)
create table public.service_projects (
  id           uuid primary key default gen_random_uuid(),
  store_id     text not null references public.stores (id) on delete cascade,
  order_id     uuid references public.orders (id) on delete set null,
  customer_id  uuid references public.customers (id) on delete set null,
  product_id   text not null default '',
  title        text not null default '',
  stage        text not null default 'new' check (stage in ('new', 'in_progress', 'delivered', 'revision', 'completed')),
  due_date     date,
  deliverables jsonb not null default '[]'::jsonb,
  intake       jsonb not null default '[]'::jsonb,
  add_ons      jsonb not null default '[]'::jsonb,
  client       jsonb not null default '{}'::jsonb,         -- { name, email, phone }
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index service_projects_store_idx on public.service_projects (store_id, stage);
create trigger service_projects_touch before update on public.service_projects for each row execute function public.touch_updated_at();

-- digital downloads: one grant per paid order line; the `download` function redeems the token for a short-lived
-- signed Storage URL (private bucket `digital-products`, files at <store id>/<file>)
create table public.digital_downloads (
  id             uuid primary key default gen_random_uuid(),
  token          text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  store_id       text not null references public.stores (id) on delete cascade,
  order_id       uuid not null references public.orders (id) on delete cascade,
  product_id     text not null,
  title          text not null default '',
  file           text not null,                           -- 'storage:<path in digital-products>' or an https URL
  file_name      text not null default '',
  download_limit int,                                     -- null = unlimited
  download_count int not null default 0,
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (order_id, product_id)
);
create index digital_downloads_store_idx on public.digital_downloads (store_id, created_at desc);

-- Count one download if the grant is still valid; returns the file to sign, or nothing.
create or replace function public.redeem_download(p_token text) returns table (file text, file_name text, store_id text)
language sql security definer set search_path = '' as $$
  update public.digital_downloads d set download_count = d.download_count + 1
   where d.token = p_token and (d.download_limit is null or d.download_count < d.download_limit) and (d.expires_at is null or d.expires_at > now())
     and exists (select 1 from public.orders o where o.id = d.order_id and o.financial_status in ('paid', 'partially_refunded'))
  returning d.file, d.file_name, d.store_id;
$$;
revoke all on function public.redeem_download(text) from public, anon, authenticated;
grant execute on function public.redeem_download(text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- analytics events (ingested by the `track` function; geo from edge headers or the visitor's time zone)
-- ---------------------------------------------------------------------------------------------------------------
create table public.analytics_events (
  id          bigint generated always as identity primary key,
  store_id    text not null references public.stores (id) on delete cascade,
  type        text not null check (type in ('visit', 'page_view', 'view_product', 'add_to_cart', 'checkout_started', 'order_placed')),
  session_id  text not null default '',
  path        text not null default '',
  product_id  text not null default '',
  variant_id  text not null default '',
  quantity    int not null default 0,
  value       numeric(12, 2) not null default 0,
  order_id    uuid,
  referrer    text not null default '',
  utm         jsonb not null default '{}'::jsonb,
  country     text not null default '',
  region      text not null default '',
  city        text not null default '',
  lat         double precision,
  lon         double precision,
  geo_source  text not null default '' check (geo_source in ('', 'header', 'timezone')),
  timezone    text not null default '',                   -- visitor's IANA time zone (the admin maps it to an approximate location)
  lang        text not null default '',
  ip_hash     text not null default '',                   -- salted SHA-256, never the raw IP
  user_agent  text not null default '',
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);
create index analytics_events_store_time_idx on public.analytics_events (store_id, occurred_at desc);
create index analytics_events_store_type_idx on public.analytics_events (store_id, type, occurred_at desc);
create index analytics_events_session_idx on public.analytics_events (store_id, session_id);

-- ---------------------------------------------------------------------------------------------------------------
-- Stripe webhook log (idempotency: one row per Stripe event id)
-- ---------------------------------------------------------------------------------------------------------------
create table public.webhooks_log (
  id           text primary key,                          -- Stripe event id (evt_…)
  type         text not null,
  account      text,                                      -- connected account for Connect events
  livemode     boolean not null default false,
  api_version  text,
  status       text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  attempts     int not null default 1,
  error        text,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);
create index webhooks_log_type_idx on public.webhooks_log (type, received_at desc);
create index webhooks_log_status_idx on public.webhooks_log (status) where status <> 'processed';

-- ---------------------------------------------------------------------------------------------------------------
-- rate limiting (fixed window counters, used by public functions)
-- ---------------------------------------------------------------------------------------------------------------
create table public.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        int not null
);

-- Atomically count one hit for `p_key`; returns true while the window holds at most p_max hits.
create or replace function public.hit_rate_limit(p_key text, p_window_seconds int, p_max int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning count into v_count;
  return v_count <= p_max;
end $$;
revoke all on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;

-- Decrement tracked stock of one variant in the catalog snapshot (never below 0; untracked stock = null stays null).
create or replace function public.decrement_stock(p_store_id text, p_product_id text, p_variant_id text, p_qty int) returns void
language sql security definer set search_path = '' as $$
  update public.products p
     set variants = (
       select coalesce(jsonb_agg(case when v ->> 'id' = p_variant_id and jsonb_typeof(v -> 'stock') = 'number'
                                      then jsonb_set(v, '{stock}', to_jsonb(greatest(0, (v ->> 'stock')::numeric::int - p_qty)))
                                      else v end order by ord), '[]'::jsonb)
         from jsonb_array_elements(p.variants) with ordinality as t(v, ord))
   where p.store_id = p_store_id and p.id = p_product_id;
$$;
revoke all on function public.decrement_stock(text, text, text, int) from public, anon, authenticated;
grant execute on function public.decrement_stock(text, text, text, int) to service_role;

-- Housekeeping: call from a cron job (Supabase → Integrations → Cron) e.g. daily.
create or replace function public.prune_backend_logs(p_keep_days int default 90) returns void
language sql security definer set search_path = '' as $$
  delete from public.rate_limits where window_start < now() - interval '1 day';
  delete from public.webhooks_log where status = 'processed' and received_at < now() - make_interval(days => p_keep_days);
$$;
revoke all on function public.prune_backend_logs(int) from public, anon, authenticated;
grant execute on function public.prune_backend_logs(int) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------------------------
alter table public.stores             enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.products           enable row level security;
alter table public.customers          enable row level security;
alter table public.orders             enable row level security;
alter table public.order_lines        enable row level security;
alter table public.payments           enable row level security;
alter table public.refunds            enable row level security;
alter table public.disputes           enable row level security;
alter table public.subscriptions      enable row level security;
alter table public.bookings           enable row level security;
alter table public.service_projects   enable row level security;
alter table public.digital_downloads  enable row level security;
alter table public.analytics_events   enable row level security;
alter table public.webhooks_log       enable row level security;
alter table public.rate_limits        enable row level security;

-- stores: the owner reads/updates its rows; creating a store row is done by sync-catalog / stripe-connect-onboard
-- (service role), so no insert policy. Stripe fields are not writable by the owner (see column grants below).
create policy "owner reads store" on public.stores for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner updates store" on public.stores for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "owner reads connected account" on public.connected_accounts for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads products" on public.products for select to authenticated using (public.is_store_owner(store_id));
create policy "owner reads customers" on public.customers for select to authenticated using (public.is_store_owner(store_id));
create policy "owner updates customers" on public.customers for update to authenticated
  using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));
create policy "owner reads orders" on public.orders for select to authenticated using (public.is_store_owner(store_id));
create policy "owner updates orders" on public.orders for update to authenticated
  using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));
create policy "owner reads order lines" on public.order_lines for select to authenticated using (public.is_store_owner(store_id));
create policy "owner reads payments" on public.payments for select to authenticated using (public.is_store_owner(store_id));
create policy "owner reads refunds" on public.refunds for select to authenticated using (public.is_store_owner(store_id));
create policy "owner reads disputes" on public.disputes for select to authenticated using (public.is_store_owner(store_id));
create policy "owner reads subscriptions" on public.subscriptions for select to authenticated using (public.is_store_owner(store_id));
create policy "owner manages bookings" on public.bookings for all to authenticated
  using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));
create policy "owner manages service projects" on public.service_projects for all to authenticated
  using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));
create policy "owner reads downloads" on public.digital_downloads for select to authenticated using (public.is_store_owner(store_id));
create policy "owner reads analytics" on public.analytics_events for select to authenticated using (public.is_store_owner(store_id));

-- Column-level limits on owner updates (RLS decides the rows, these grants decide the columns).
revoke update on public.stores from authenticated;
grant update (name, site_url, allowed_origins, email) on public.stores to authenticated;
revoke update on public.orders from authenticated;
grant update (status, fulfillment_status, note, metadata) on public.orders to authenticated;
revoke update on public.customers from authenticated;
grant update (name, phone, address, accepts_marketing) on public.customers to authenticated;

-- Anonymous visitors get nothing directly.
revoke all on all tables in schema public from anon;

-- Private bucket for digital products (Supabase Storage). Upload files to digital-products/<store id>/… in the dashboard
-- or with `supabase storage cp`; only the `download` function (service role) creates signed URLs for buyers.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('digital-products', 'digital-products', false) on conflict (id) do nothing;
  end if;
end $$;
