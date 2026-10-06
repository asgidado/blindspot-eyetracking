// Search replay panel (four views, in order of importance): zone timeline, scanpath replay, heatmaps, per-finding table.
import { useEffect, useState } from 'react';
import type { Config, NextCase } from '../api';

export type ReplayState = { t: number; playing: boolean; show: 'none' | 'gaze' | 'cursor' };
type Props = { cfg: Config; kase: NextCase; result: any; state: ReplayState; setState: (s: ReplayState) => void };

const MISS: Record<string, string> = { search: 'search', recognition: 'recognition', decision: 'decision' };

export function ReplayPanel({ result, state, setState }: Props) {
  const rp = result.replay;
  const gazeOn: boolean = !!result.gaze_used;
  const acc = result.attention?.gaze_accuracy_img_px_at_fit;
  const [heat, setHeat] = useState<'gaze' | 'cursor'>(gazeOn ? 'gaze' : 'cursor');
  useEffect(() => { setState({ ...state, show: gazeOn ? 'gaze' : 'none' }); }, []);

  // play loop
  useEffect(() => {
    if (!state.playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = now - last; last = now;
      const t = state.t + dt * 2; // 2× speed
      if (t >= rp.total_ms) { setState({ ...state, t: rp.total_ms, playing: false }); return; }
      setState({ ...state, t }); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.playing, state.t]);

  if (!rp) return <div className="muted">No replay data.</div>;
  const W = 460, rowH = 18, left = 175, total = Math.max(1, rp.total_ms), x = (ms: number) => left + ((W - left - 8) * ms) / total;
  const bins: number = rp.cursor_rows[rp.rows[0].zone]?.length ?? 0;
  const bw = (W - left - 8) / Math.max(1, (total / rp.bin_ms));

  return (
    <section>
      <h3>Zone timeline</h3>
      <div className="muted" style={{ fontSize: 12 }}>Rows = review areas, hardest first. {gazeOn ? <><span style={{ color: '#b97a12' }}>■</span> gaze dwell (probabilistic, ±{Math.round(acc)} px) · </> : null}<span style={{ color: '#5b6672' }}>▬</span> cursor presence · ▲ mark · | submit. Rows with no gaze dwell read "not visited".</div>
      <svg className="timeline" viewBox={`0 0 ${W} ${rp.rows.length * rowH + 24}`} style={{ width: '100%' }}>
        {rp.rows.map((row: any, i: number) => {
          const y = i * rowH + 4;
          const g: number[] | undefined = rp.gaze_rows?.[row.zone];
          const c: number[] = rp.cursor_rows[row.zone] ?? [];
          const gazeDwell = g ? g.reduce((a, b) => a + b, 0) * rp.bin_ms : 0;
          const visited = gazeOn ? gazeDwell >= 300 : c.reduce((a, b) => a + b, 0) * rp.bin_ms >= 300;
          const hard = row.hardness >= 0.8 && !visited && row.zone !== 'other_lung';
          return (
            <g key={row.zone}>
              <rect x={0} y={y - 2} width={W} height={rowH} fill={hard ? 'rgba(240,169,46,.08)' : 'transparent'} />
              <text x={4} y={y + 11} fontSize={10} fill={hard ? '#b97a12' : '#1d2329'}>{row.human.replace(' (behind the heart)', '')}{row.zone !== 'other_lung' ? ` (${row.hardness})` : ''}</text>
              {!visited && row.zone !== 'other_lung' && <text x={W - 10} y={y + 9} fontSize={9} fill="#8a949e" textAnchor="end">not visited</text>}
              {g?.map((v, k) => v > 0.02 && <rect key={k} x={x(k * rp.bin_ms)} y={y} width={Math.max(1, bw)} height={10} fill="#f0a92e" opacity={0.25 + 0.75 * v} />)}
              {c.map((v, k) => v > 0.02 && <rect key={`c${k}`} x={x(k * rp.bin_ms)} y={y + 11} width={Math.max(1, bw)} height={3} fill="#5b6672" opacity={0.4 + 0.6 * v} />)}
            </g>
          );
        })}
        {rp.marks_ms.map((m: number, i: number) => <text key={i} x={x(m)} y={rp.rows.length * rowH + 14} fontSize={10} fill="#f0a92e" textAnchor="middle">▲</text>)}
        <line x1={x(rp.submit_ms)} x2={x(rp.submit_ms)} y1={0} y2={rp.rows.length * rowH + 4} stroke="#1d2329" strokeWidth={1} />
        <line x1={x(state.t)} x2={x(state.t)} y1={0} y2={rp.rows.length * rowH + 4} stroke="#35c9dd" strokeWidth={1.5} />
        <text x={left} y={rp.rows.length * rowH + 20} fontSize={9} fill="#5b6672">0 s</text>
        <text x={W - 8} y={rp.rows.length * rowH + 20} fontSize={9} fill="#5b6672" textAnchor="end">{(total / 1000).toFixed(1)} s</text>
      </svg>
      {bins === 0 && <div className="muted">No cursor telemetry recorded.</div>}

      <h3>Scanpath replay</h3>
      {gazeOn ? (
        <>
          <div className="muted" style={{ fontSize: 12 }}>Numbered fixations (I-DT, dispersion {Math.round(rp.dispersion_px)} screen px, ≥100 ms), circle size = duration, drawn on the film. Webcam gaze estimate, ±{Math.round(acc)} px.</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}>
            <button onClick={() => setState({ ...state, playing: !state.playing, show: 'gaze', t: state.t >= rp.total_ms ? 0 : state.t })}>{state.playing ? 'Pause' : 'Play'}</button>
            <input type="range" min={0} max={rp.total_ms} value={state.t} onChange={(e) => setState({ ...state, t: +e.target.value, playing: false, show: 'gaze' })} style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: 12, width: 50 }}>{(state.t / 1000).toFixed(1)} s</span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{rp.fixations.length} fixations · {rp.gaze_stats?.n_valid}/{rp.gaze_stats?.n_total} valid samples · {rp.gaze_stats?.loss_pct}% loss · {rp.gaze_stats?.n_on_ui} on UI</div>
        </>
      ) : <div className="muted">Gaze was off for this case; no fixations to replay.</div>}

      <h3>Heatmaps</h3>
      <div className="tabs" style={{ margin: '4px 0' }}>
        {gazeOn && <button className={heat === 'gaze' ? 'active' : ''} onClick={() => { setHeat('gaze'); setState({ ...state, show: 'gaze', playing: false }); }}>Webcam gaze (±{Math.round(acc)} px)</button>}
        <button className={heat === 'cursor' ? 'active' : ''} onClick={() => { setHeat('cursor'); setState({ ...state, show: 'cursor', playing: false }); }}>Cursor proxy (σ 20 px)</button>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>The selected heatmap is overlaid on the film. {heat === 'gaze' ? `Gaussian splats with each sample's own σ.` : 'Fixed 20 px splats on cursor positions.'}</div>

      <h3>Per-finding table</h3>
      <table className="facts">
        <thead><tr><th>Finding</th><th>Outcome</th><th>Cursor dwell</th><th>Cursor type</th>{gazeOn && <><th>Gaze dwell</th><th>Res.</th><th>Gaze type</th></>}</tr></thead>
        <tbody>
          {result.scoring.findings.map((f: any) => (
            <tr key={f.finding_id}>
              <td>{f.finding_id} {f.label}</td><td>{f.outcome}</td>
              <td>{Math.round(f.cursor_dwell_ms)} ms</td><td>{f.cursor_miss_type ? MISS[f.cursor_miss_type] : '—'}</td>
              {gazeOn && <><td>{f.gaze ? `${Math.round(f.gaze.dwell_ms)} ms` : '—'}</td><td>{f.gaze?.resolution ?? '—'}{f.gaze?.sigma_px ? ` (σ ${f.gaze.sigma_px})` : ''}</td><td>{f.gaze?.miss_type ? `${MISS[f.gaze.miss_type]} (conf ${f.gaze.miss_type_confidence})` : f.gaze ? 'zone-level only' : '—'}</td></>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Bands: search &lt; {result.scoring.bands_ms.recognition_from} ms ≤ recognition &lt; {result.scoring.bands_ms.decision_from} ms ≤ decision. Finding ROI = outline dilated by {result.scoring.roi_px} px. Coverage (hardness-weighted): {result.coverage?.gaze_weighted_pct !== undefined ? `gaze ${result.coverage.gaze_weighted_pct}% · ` : ''}cursor {result.coverage?.cursor_weighted_pct}%.</div>
    </section>
  );
}
