// "Load sample data" / "Clear sample data" for the commerce admin (empty states, Services) — data: ./sampleData.js.
import React from 'react';
import { Sparkles, Eraser } from 'lucide-react';
import { useAdmin, Btn } from './ui.jsx';
import { generateSampleData, clearSampleData, hasSampleData } from './sampleData.js';
import { localZone } from './ServiceEditor.jsx';

export const CLEAR_MESSAGE = 'This removes every sample order, customer, booking, project, review, session and note. Anything you created yourself stays.';

/** { has, load(), clear() } for the open store; load/clear commit both documents and show a toast. */
export function useSampleData() {
  const { store, commerce, run, confirm } = useAdmin();
  const has = hasSampleData(store, commerce);
  const load = () => run((s, c) => generateSampleData(s, c, { timezone: localZone() }), 'Sample data loaded');
  const clear = async () => {
    if (!await confirm({ title: 'Clear sample data?', message: CLEAR_MESSAGE, confirmLabel: 'Clear sample data', danger: true })) return;
    run((s, c) => clearSampleData(s, c), 'Sample data cleared');
  };
  return { has, load, clear };
}

/** Button: "Load sample data", or "Clear sample data" once it is loaded (unless onlyLoad). */
export function SampleDataButton({ onlyLoad, kind = '' }) {
  const { has, load, clear } = useSampleData();
  if (has) return onlyLoad ? null : <Btn icon={Eraser} onClick={clear}>Clear sample data</Btn>;
  return <Btn kind={kind} icon={Sparkles} onClick={load}>Load sample data</Btn>;
}
