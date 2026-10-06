// "Recorded session": a session export replayed through the full reveal (outcomes, search replay, facts, debrief).
import { useState } from 'react';
import { Reveal } from './Reveal';
import type { Config } from './api';

export function RecordedReplay({ cfg, data, onExit }: { cfg: Config; data: any; onExit: () => void }) {
  const [i, setI] = useState(0);
  const results = data.results.filter((r: any) => !r.error);
  if (results.length === 0) return <div className="page"><p className="warn">None of the recorded cases are available in this install.</p><button onClick={onExit}>Back</button></div>;
  const r = results[i];
  const kase = { id: r.case_id, width: r.width, height: r.height, index: i, total: results.length, source: data.synthetic ? 'synthetic' : 'chestx-det', done: false };
  return (
    <>
      <div style={{ padding: '4px 16px', fontSize: 12, color: '#c9d1d9', borderBottom: '1px solid #2a2f34' }}>
        <span className="badge">Recorded session</span> {data.name} · replayed from an export; nothing live. {data.synthetic ? 'Synthetic films.' : ''}
      </div>
      <Reveal cfg={cfg} kase={kase} result={r} last={i + 1 >= results.length} onNext={() => (i + 1 >= results.length ? onExit() : setI(i + 1))} />
    </>
  );
}
