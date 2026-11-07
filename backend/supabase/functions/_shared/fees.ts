// Platform (application) fee for Stripe Connect charges (pure).
// The fee configured in the store settings (applicationFeePercent / applicationFeeFixed) is used unless the platform
// operator pins a percentage with the PLATFORM_FEE_PERCENT secret, which always wins (merchants cannot lower it).

import { toMinor } from './money.ts';

export interface FeeConfig { applicationFeePercent?: unknown; applicationFeeFixed?: unknown }

const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

/** Effective percentage (0–100, two decimals). `envPercent` is the raw PLATFORM_FEE_PERCENT value (may be undefined). */
export function feePercent(cfg: FeeConfig | null | undefined, envPercent?: string | null): number {
  const env = envPercent != null && String(envPercent).trim() !== '' ? Number(envPercent) : NaN;
  const p = Number.isFinite(env) ? env : Number(cfg?.applicationFeePercent ?? 0);
  return Number.isFinite(p) ? Math.round(clampPct(p) * 100) / 100 : 0;
}

/** Fee in minor units for a one-time charge of `totalMinor`: percent of the total + fixed amount, never above the total. */
export function applicationFeeAmount(totalMinor: number, currency: string, cfg: FeeConfig | null | undefined, envPercent?: string | null): number {
  const total = Math.max(0, Math.round(Number(totalMinor) || 0));
  if (!total) return 0;
  const fixed = Math.max(0, Number(cfg?.applicationFeeFixed ?? 0) || 0);
  const fee = Math.round(total * feePercent(cfg, envPercent) / 100) + toMinor(fixed, currency);
  return Math.min(total, Math.max(0, fee));
}
