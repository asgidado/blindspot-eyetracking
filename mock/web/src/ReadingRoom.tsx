import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewer, type ViewerHandle } from './Viewer';
import { api, type Config, type Mark, type NextCase, type Session } from './api';
import { TelemetryBuffer } from './telemetry';
import type { GazeSession } from './gaze/session';

type Props = { cfg: Config; session: Session; kase: NextCase; gaze: GazeSession | null; onResult: (r: any) => void };

export function ReadingRoom({ cfg, session, kase, gaze, onResult }: Props) {
  const viewer = useRef<ViewerHandle>(null);
  const tele = useMemo(() => new TelemetryBuffer(cfg.mock.viewer.telemetry_cap, cfg.mock.viewer.pointer_throttle_ms), [cfg]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [globals, setGlobals] = useState<string[]>([]);
  const [pending, setPending] = useState<{ x: number; y: number; sx: number; sy: number; label?: string; confidence: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(performance.now());
  const focal = cfg.mock.labels.focal as Record<string, string>;
  const globalLabels = cfg.mock.labels.global as Record<string, string>;

  // same clock for cursor and gaze: both reset when the case is shown
  useEffect(() => {
    tele.start(); started.current = performance.now();
    const isUiAt = (cx: number, cy: number) => {
      const el = document.elementFromPoint(cx, cy);
      const stage = viewer.current?.stageEl();
      return !!el && !!stage && (!stage.contains(el) || el.closest('.toolbar, .popover') !== null);
    };
    gaze?.attachCase(() => viewer.current!.getViewState(), isUiAt);
    return () => { gaze?.detachCase(); };
  }, [kase.id, tele, gaze]);

  const submit = async (normal: boolean) => {
    if (busy) return;
    setBusy(true);
    const read_ms = performance.now() - started.current;
    const g = gaze?.detachCase();
    try {
      const r = await api.submit(kase.id, {
        session: session.id, marks, normal, globals, telemetry: tele.drain(), read_ms,
        ...(g ? { gaze: g.samples, gaze_meta: g.meta } : {}),
      });
      onResult(r);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') setPending(null);
      if (e.key === 'Enter' && !pending) void submit(false);
      if ((e.key === 'n' || e.key === 'N') && !pending) void submit(true);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const confirmMark = () => {
    if (!pending?.label) return;
    setMarks((m) => [...m, { x: pending.x, y: pending.y, label: pending.label!, confidence: pending.confidence, t: tele.now() }]);
    setPending(null);
  };

  return (
    <main className="room">
      <div style={{ flex: 1, position: 'relative', display: 'flex', minWidth: 0 }}>
        <Viewer
          ref={viewer} src={api.imageUrl(kase.id)} imgW={kase.width} imgH={kase.height} marks={marks} telemetry={tele}
          loupe={{ radius: cfg.mock.viewer.loupe.radius_px, mag: cfg.mock.viewer.loupe.mag, defaultOn: cfg.mock.viewer.loupe.default_on }}
          zoomMax={cfg.mock.viewer.zoom_max}
          onPlaceMark={(q) => setPending({ ...q, confidence: 3 })}
          showGazeDot={gaze?.debugDot ?? null}
        />
        {pending && (
          <div className="popover" style={{ left: Math.min(pending.sx + 12, window.innerWidth - 640), top: Math.max(8, pending.sy - 40) }} onPointerDown={(e) => e.stopPropagation()}>
            <div className="muted" style={{ fontSize: 12, color: 'var(--muted)' }}>Mark at ({pending.x.toFixed(0)}, {pending.y.toFixed(0)})</div>
            <div className="labels">
              {Object.entries(focal).map(([id, name]) => (
                <button key={id} className={pending.label === id ? 'sel' : ''} onClick={() => setPending({ ...pending, label: id })}>{name}</button>
              ))}
              <button className={pending.label === 'not_sure' ? 'sel' : ''} onClick={() => setPending({ ...pending, label: 'not_sure' })}>Not sure</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 2px' }}>Confidence</div>
            <div className="conf">{[1, 2, 3, 4, 5].map((c) => <button key={c} className={pending.confidence === c ? 'sel' : ''} onClick={() => setPending({ ...pending, confidence: c })}>{c}</button>)}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setPending(null)}>Cancel</button>
              <button className="primary" disabled={!pending.label} onClick={confirmMark}>Add mark</button>
            </div>
          </div>
        )}
      </div>
      <aside className="rail">
        <h2>Your read</h2>
        <div className="muted">Case {kase.index + 1} of {kase.total} · {kase.source === 'synthetic' ? 'Synthetic phantom' : 'ChestX-Det film'}</div>
        <section>
          <h3>Marks</h3>
          {marks.length === 0 && <div className="muted">Click the film to place a mark.</div>}
          <ul>{marks.map((m, i) => (
            <li key={i}><span className="dot learner" /> <span style={{ flex: 1 }}>{i + 1}. {focal[m.label] ?? 'Not sure'} <span className="muted">conf {m.confidence}</span></span>
              <button onClick={() => setMarks(marks.filter((_, j) => j !== i))}>×</button></li>
          ))}</ul>
        </section>
        <section>
          <h3>Global findings</h3>
          {Object.entries(globalLabels).map(([id, name]) => (
            <label className="row" key={id}><input type="checkbox" checked={globals.includes(id)} onChange={(e) => setGlobals(e.target.checked ? [...globals, id] : globals.filter((g) => g !== id))} /> {name}</label>
          ))}
        </section>
        <section>
          <h3>Call it normal</h3>
          <button disabled={busy} onClick={() => submit(true)}>No findings — call it normal <span className="kbd">N</span></button>
        </section>
        <section>
          <h3>Submit</h3>
          <button className="primary" disabled={busy} onClick={() => submit(false)} style={{ width: '100%' }}>{busy ? 'Scoring…' : 'Submit read'} <span className="kbd" style={{ color: '#ccc', borderColor: '#555' }}>Enter</span></button>
          <div className="muted" style={{ marginTop: 8 }}>Wheel = zoom at cursor · drag = pan · double-click = reset · L = loupe</div>
        </section>
      </aside>
    </main>
  );
}
