import { useEffect, useState } from 'react';
import { api, type Session } from './api';

export function Summary({ session, onRestart }: { session: Session; onRestart: () => void }) {
  const [s, setS] = useState<any>(null);
  useEffect(() => { api.summary(session.id).then(setS); }, [session.id]);
  if (!s) return <div className="page">Loading…</div>;
  const mt = s.miss_types as Record<string, Record<string, number>>;
  return (
    <div className="page paper">
      <h1>Session summary {s.synthetic && <span className="badge" style={{ color: 'var(--ink)' }}>Synthetic · n = {s.n_cases}</span>}</h1>
      <p className="note">{s.name} · {s.n_cases} cases{s.gaze ? ' · gaze + cursor' : ' · cursor only'}. Counts below are computed across this session's cases; nothing is inferred.</p>
      <div className="card">
        <h3>Review areas most often left unvisited</h3>
        {Object.keys(s.review_area_unvisited).length === 0 ? <p>None — every review area was visited in every case.</p> : (
          <table className="facts"><thead><tr><th>Area</th><th>Cases unvisited (cursor)</th></tr></thead><tbody>
            {Object.entries(s.review_area_unvisited as Record<string, number>).map(([z, n]) => <tr key={z}><td>{s.review_area_human[z]}</td><td>{n} of {s.n_cases}</td></tr>)}
          </tbody></table>
        )}
      </div>
      <div className="card">
        <h3>Miss types by source</h3>
        <table className="facts"><thead><tr><th>Source</th><th>Search</th><th>Recognition</th><th>Decision</th></tr></thead><tbody>
          {Object.entries(mt).map(([src, m]) => <tr key={src}><td>{src === 'gaze' ? 'Webcam gaze' : 'Cursor proxy'}</td><td>{m.search ?? 0}</td><td>{m.recognition ?? 0}</td><td>{m.decision ?? 0}</td></tr>)}
        </tbody></table>
      </div>
      <p><a href={`/api/sessions/${session.id}/export`} download={`session-${session.id}.json`}>Export session JSON</a> (raw telemetry + gaze samples, no camera frames)</p>
      <button className="primary" onClick={onRestart}>Start another session</button>
    </div>
  );
}
