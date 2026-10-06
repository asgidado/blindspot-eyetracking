import { useMemo, useRef, useState } from 'react';
import type { View } from '@gaze/view';
import { Viewer, type Overlay } from './Viewer';
import { api, type Config, type NextCase } from './api';
import { ReplayPanel, type ReplayState } from './replay/ReplayPanel';

type Props = { cfg: Config; kase: NextCase; result: any; onNext: () => void; last: boolean };

const MISS_HUMAN: Record<string, string> = { search: 'search error (never looked there)', recognition: 'recognition error (looked past it)', decision: 'decision error (looked, judged it normal)' };

export function Reveal({ cfg, kase, result, onNext, last }: Props) {
  const [tab, setTab] = useState<'outcomes' | 'replay' | 'facts' | 'debrief'>('outcomes');
  const sc = result.scoring;
  const focal = cfg.mock.labels.focal as Record<string, string>;
  const zones = cfg.mock.zones as Record<string, string>;
  const gazeOn: boolean = !!result.gaze_used;
  const acc = result.attention?.gaze_accuracy_img_px_at_fit;
  const marks = [...sc.findings.filter((f: any) => f.mark).map((f: any) => f.mark), ...sc.overcalls.map((o: any) => o.mark)];
  const [replay, setReplay] = useState<ReplayState>({ t: 0, playing: false, show: gazeOn ? 'gaze' : 'none' });
  const heatImgs = useRef<{ gaze?: HTMLImageElement; cursor?: HTMLImageElement }>({});
  const rp = result.replay;
  const heatFor = (k: 'gaze' | 'cursor') => {
    const b64 = k === 'gaze' ? rp?.heatmap_gaze_png : rp?.heatmap_cursor_png;
    if (!b64) return undefined;
    if (!heatImgs.current[k]) { const im = new Image(); im.src = `data:image/png;base64,${b64}`; heatImgs.current[k] = im; }
    return heatImgs.current[k];
  };
  // Draw in image space: heatmap (when a heatmap tab is active) and numbered fixations up to the replay time.
  const draw = (ctx: CanvasRenderingContext2D, v: View) => {
    if (tab !== 'replay' || !rp) return;
    if (replay.show !== 'none') {
      const im = heatFor(replay.show);
      if (im?.complete && im.naturalWidth) { ctx.save(); ctx.globalAlpha = 0.85; ctx.drawImage(im, 0, 0, kase.width, kase.height); ctx.restore(); }
    }
    if (replay.show !== 'gaze') return;
    const fx = (rp.fixations as any[]).filter((f) => f.x !== null && f.t_start <= replay.t);
    fx.forEach((f, i) => {
      const r = Math.max(6, Math.min(60, Math.sqrt((f.t_end - f.t_start) / 1000) * 30)) / v.scale;
      const cur = i === fx.length - 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fillStyle = cur ? 'rgba(240,169,46,.35)' : 'rgba(240,169,46,.15)'; ctx.fill();
      ctx.strokeStyle = '#f0a92e'; ctx.lineWidth = (cur ? 2.5 : 1.2) / v.scale; ctx.stroke();
      if (i > 0) { const p = fx[i - 1]; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(f.x, f.y); ctx.strokeStyle = 'rgba(240,169,46,.5)'; ctx.lineWidth = 1 / v.scale; ctx.stroke(); }
      ctx.fillStyle = '#fff'; ctx.font = `${12 / v.scale}px Atkinson Hyperlegible, system-ui`; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), f.x, f.y + 4 / v.scale);
      // uncertainty ring (1 σ) on the current fixation
      if (cur && f.sigma) { ctx.beginPath(); ctx.arc(f.x, f.y, f.sigma, 0, Math.PI * 2); ctx.setLineDash([4 / v.scale, 4 / v.scale]); ctx.strokeStyle = 'rgba(240,169,46,.6)'; ctx.lineWidth = 1 / v.scale; ctx.stroke(); ctx.setLineDash([]); }
    });
  };
  const overlays = useMemo<Overlay[]>(() => result.reveal.findings.map((f: any) => ({ points: f.polygon, color: '#35c9dd', label: `${f.finding_id} ${focal[f.label] ?? f.label}` })), [result, focal]);

  return (
    <main className="reveal">
      <Viewer src={api.imageUrl(kase.id)} imgW={kase.width} imgH={kase.height} marks={marks} overlays={overlays} readonly draw={draw}
        loupe={{ radius: cfg.mock.viewer.loupe.radius_px, mag: cfg.mock.viewer.loupe.mag, defaultOn: false }} zoomMax={cfg.mock.viewer.zoom_max} />
      <aside className="rail">
        <h2>Reveal <span className="muted" style={{ fontWeight: 400 }}>· case {kase.index + 1} of {kase.total}</span></h2>
        <div className="muted"><span className="dot expert" /> expert truth &nbsp; <span className="dot learner" /> your marks {result.synthetic && <span className="badge" style={{ color: 'var(--ink)', marginLeft: 8 }}>Synthetic</span>}</div>
        <div className="tabs">
          {(['outcomes', 'replay', 'facts', 'debrief'] as const).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{{ outcomes: 'Outcomes', replay: 'Search replay', facts: 'What the AI sees', debrief: 'Debrief' }[t]}</button>)}
        </div>
        {tab === 'outcomes' && (
          <section>
            <div className="muted">{sc.summary.n_found} found · {sc.summary.n_mislabeled} mislabeled · {sc.summary.n_missed} missed · {sc.summary.n_overcalls} overcall{sc.summary.n_overcalls === 1 ? '' : 's'}{sc.called_normal ? ' · you called it normal' : ''}{sc.truly_normal ? ' · this case is normal' : ''}</div>
            <h3>Findings</h3>
            {sc.findings.length === 0 && <div className="muted">No focal findings in this case.</div>}
            <ul>
              {sc.findings.map((f: any) => (
                <li key={f.finding_id} style={{ display: 'block' }}>
                  <div><span className="dot expert" /> <strong>{f.finding_id} {focal[f.label] ?? f.label}</strong> <span className="muted">· {zones[f.zone] ?? f.zone}</span> <span className={`outcome ${f.outcome}`}>{f.outcome}</span></div>
                  {f.outcome === 'mislabeled' && <div className="muted">You labelled it "{focal[f.mark.label] ?? 'Not sure'}" — interpretation error.</div>}
                  {f.outcome === 'missed' && (
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      <div><strong>Cursor proxy:</strong> {MISS_HUMAN[f.cursor_miss_type]} · dwell {Math.round(f.cursor_dwell_ms)} ms</div>
                      {gazeOn && f.gaze && (
                        <div><strong>Webcam gaze (±{Math.round(f.gaze.sigma_px ?? acc)} px):</strong> {f.gaze.resolution === 'lesion' && f.gaze.miss_type ? `${MISS_HUMAN[f.gaze.miss_type]} · dwell ${Math.round(f.gaze.dwell_ms)} ms` : `zone-level only (σ ${Math.round(f.gaze.sigma_px ?? acc)} px vs ROI ${sc.roi_px} px) · dwell ${Math.round(f.gaze.dwell_ms)} ms`}</div>
                      )}
                      <div className="muted">Based on your cursor, loupe and zoom — a proxy for where you looked.{gazeOn ? ' Gaze: your eyes reached this area for about the time shown; it cannot say what you saw.' : ''}</div>
                    </div>
                  )}
                </li>
              ))}
              {sc.overcalls.map((o: any, i: number) => (
                <li key={`o${i}`} style={{ display: 'block' }}><span className="dot learner" /> <strong>{focal[o.mark.label] ?? 'Not sure'}</strong> at ({Math.round(o.mark.x)}, {Math.round(o.mark.y)}) <span className="outcome">overcall</span></li>
              ))}
            </ul>
            {(sc.globals.missed.length > 0 || sc.globals.overcall.length > 0 || sc.globals.found.length > 0) && (
              <><h3>Global findings</h3><div className="muted">found: {sc.globals.found.join(', ') || '—'} · missed: {sc.globals.missed.join(', ') || '—'} · overcalled: {sc.globals.overcall.join(', ') || '—'}</div></>
            )}
            <h3>Review areas</h3>
            <table className="facts"><thead><tr><th>Area</th><th>hardness</th><th>cursor</th>{gazeOn && <th>gaze</th>}</tr></thead><tbody>
              {result.review_areas.map((ra: any) => (
                <tr key={ra.zone}><td>{ra.human}</td><td>{ra.hardness}</td><td>{ra.visited_cursor ? `${Math.round(ra.cursor_dwell_ms)} ms` : 'not visited'}</td>
                  {gazeOn && <td>{ra.gaze_dwell_ms === undefined ? '—' : ra.visited_gaze ? `${Math.round(ra.gaze_dwell_ms)} ms` : 'not visited'}</td>}</tr>
              ))}
            </tbody></table>
          </section>
        )}
        {tab === 'replay' && <ReplayPanel cfg={cfg} kase={kase} result={result} state={replay} setState={setReplay} />}
        {tab === 'facts' && <FactsTab result={result} />}
        {tab === 'debrief' && <DebriefTab result={result} />}
        <div style={{ marginTop: 'auto', paddingTop: 12 }}>
          <button className="primary" style={{ width: '100%' }} onClick={onNext} data-testid="next">{last ? 'Session summary' : 'Next case'}</button>
        </div>
      </aside>
    </main>
  );
}

function FactsTab({ result }: { result: any }) {
  if (!result.facts) return <div className="muted">No facts for this case.</div>;
  const json = JSON.stringify(result.facts, null, 1);
  const bytes: number = result.facts_bytes ?? new TextEncoder().encode(JSON.stringify(result.facts)).length;
  return (
    <section>
      <div className="muted">Exactly what a language model would receive for this case: <strong>{bytes} bytes · ≈{Math.round(bytes / 4)} tokens</strong>. Raw samples and telemetry never go to a model.</div>
      <h3>GazeFacts JSON</h3>
      <pre className="facts" data-testid="facts-json">{json}</pre>
      <h3>to_prompt_text</h3>
      <pre className="facts">{result.facts_text}</pre>
    </section>
  );
}

function DebriefTab({ result }: { result: any }) {
  return (
    <section>
      <h3>Facts card</h3>
      {result.facts_card ? <table className="facts"><tbody>{result.facts_card.map((r: [string, string]) => <tr key={r[0]}><th>{r[0]}</th><td>{r[1]}</td></tr>)}</tbody></table> : <div className="muted">—</div>}
      <h3>Template debrief (mock)</h3>
      <p style={{ fontSize: 14 }}>{result.debrief ?? '—'}</p>
      <p className="note">In the real build Claude writes this from the same facts block, under the same claim limits.</p>
    </section>
  );
}
