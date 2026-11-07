// Types of the generated pricing engine (engine.js = commerceEngineSource() of src/store/commerce.js).
import type { EngineTotals } from './checkout.ts';

export interface EngineConfig {
  discounts: unknown[]; zones: { id: string; name: string; countries: string[]; rates: unknown[] }[];
  taxes: { inclusive: boolean; shippingTaxed: boolean; rates: unknown[] };
  weights: Record<string, Record<string, number>>; collections: Record<string, string[]>; countries?: [string, string][];
}
export interface EngineLine { productId: string; variantId: string; price: number; quantity: number; title?: string }
export interface EngineInput { codes?: string[]; country?: string; region?: string; rateId?: string | null }
export interface EngineMessage { level: string; text: string; code?: string }

export declare const CK: {
  totals(cfg: EngineConfig, lines: EngineLine[], input: EngineInput, now: number | string): EngineTotals & { messages: EngineMessage[]; grams: number; originalShipping: number };
  ratesFor(cfg: EngineConfig, country: string, subtotal: number, grams: number): { id: string; zoneId: string; zoneName: string; name: string; type: string; price: number }[];
  taxRateFor(cfg: EngineConfig, country: string, region: string): { rate: number; name: string };
  computeTax(amount: number, ratePercent: number, inclusive: boolean): number;
};
