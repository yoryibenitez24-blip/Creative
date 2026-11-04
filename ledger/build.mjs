import { writeFileSync, mkdirSync } from 'node:fs';
import { buildRows, toCsv, summary } from './source.mjs';
const rows = buildRows();
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/CAPABILITY_LEDGER.csv', import.meta.url), toCsv(rows));
writeFileSync(new URL('../docs/LEDGER_SUMMARY.md', import.meta.url), summary(rows));
console.log(`Ledger: ${rows.length} rows written`);
