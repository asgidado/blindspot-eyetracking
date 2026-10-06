// Opt-in → camera preview with face guide → (optional card sizing) → 9-point calibration → 5-point validation → result.
// Also the between-case drift check (`drift` prop). No gaze dot is ever shown during reading.
import { useEffect, useRef, useState } from 'react';
import { MockProvider } from '@gaze/providers/mock';
import { selectProvider } from '@gaze/providers/select';
import { gridPoints, needsRecalibration, qualityTier, tierSupports, validationMetrics, type Pt, type ValidationSamples } from '@gaze/calibration';
import { fitView } from '@gaze/view';
import type { GazeSessionMeta, RawGaze } from '@gaze/types';
import type { Config } from '../api';
import type { LandingChoice } from '../Landing';
import { GazeSession, createGazeVideo, parkGazeVideo } from './session';
import { demoScript } from './demoScript';

type Props = { cfg: Config; choice: LandingChoice; onDone: (g: GazeSession) => void; onSkip: () => void; drift?: GazeSession };
type Step = 'starting' | 'camera' | 'sizing' | 'calibrate' | 'validate' | 'result' | 'error' | 'drift' | 'driftResult';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function GazeSetup({ cfg, choice, onDone, onSkip, drift }: Props) {
  const gcfg = cfg.gaze;
  const videoRef = useRef<HTMLVideoElement | null>(drift?.videoEl ?? null); // session-long element, not React-managed
  const wrapRef = useRef<HTMLDivElement>(null);
  // `?gazedev=1`: short dots and no face gate, so the live pipeline can be exercised with a fake camera (e2e / dev only)
  const dev = new URLSearchParams(location.search).has('gazedev');
  const dwellMs = dev ? 400 : gcfg.calibration.dwell_ms, settleMs = dev ? 150 : gcfg.calibration.settle_ms;
  const [step, setStep] = useState<Step>(drift ? 'drift' : 'starting');
  const [err, setErr] = useState<string | null>(null);
  const [session, setSession] = useState<GazeSession | null>(drift ?? null);
  const [face, setFaceState] = useState<{ ok: boolean; msg: string }>({ ok: false, msg: 'Looking for your face…' });
  const setFace = (f: { ok: boolean; msg: string }) => setFaceState((prev) => (prev.ok === f.ok && prev.msg === f.msg ? prev : f)); // no re-render per sample
  const [dot, setDot] = useState<Pt | null>(null);
  const [progress, setProgress] = useState('');
  const [metrics, setMetrics] = useState<ReturnType<typeof validationMetrics> | null>(null);
  const [driftErr, setDriftErr] = useState<number | null>(null);
  const [cardPx, setCardPx] = useState(320);
  const [log, setLog] = useState<string[]>([]);
  const addLog = (m: string) => setLog((l) => [...l.slice(-6), m]);
  const startedRef = useRef(false); // React StrictMode runs effects twice in dev; the camera must be opened exactly once
  const unmountedRef = useRef(false);

  // ---- start: demo (mock provider) or live provider selection
  useEffect(() => {
    if (drift) return;
    unmountedRef.current = false;
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const screen = { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio };
      const base: GazeSessionMeta = {
        schema: 'gaze_session_meta.v1', provider: 'mock', provider_version: '0', screen,
        validation: { accuracy_px: 0, precision_px: 0, loss_pct: 0, n_points: 0 }, calibration: { n_points: 0, face_box: { w: 0, h: 0 } },
        quality_tier: 'poor', train_on_clicks: !choice.study && !!gcfg.providers.train_on_clicks, study_mode: choice.study, timestamp: new Date().toISOString(),
      };
      const sessOpts = { headMaxScaleChange: gcfg.head.max_scale_change, minFaceLum: gcfg.calibration.min_face_lum, qualityCoarsePx: gcfg.quality.coarse.accuracy_px_max };
      const debug = new URLSearchParams(location.search).has('gazedot');
      if (choice.demo) {
        const stageW = window.innerWidth - 380, stageH = window.innerHeight - 80;
        const provider = new MockProvider(demoScript(stageW, stageH, 60), { hz: gcfg.providers.target_hz, jitterPx: 18, seed: 7, loop: true });
        const g = new GazeSession(provider, { ...base, provider_version: provider.version, validation: { accuracy_px: 45, precision_px: 15, loss_pct: 2, n_points: 5 }, calibration: { n_points: 9, face_box: { w: 180, h: 220 }, face_lum: 128 }, quality_tier: 'coarse', train_on_clicks: false }, sessOpts, { debug });
        g.expose().begin();
        onDone(g);
        return;
      }
      const video = videoRef.current ?? createGazeVideo();
      videoRef.current = video;
      const order = (gcfg.providers.order as string[]).filter((p) => p !== 'mock') as ('webeyetrack' | 'webgazer')[];
      const res = await selectProvider(order, video, { trainOnClicks: base.train_on_clicks, targetHz: gcfg.providers.target_hz, minHz: gcfg.providers.degraded_hz, assetBaseUrl: '' }, addLog);
      if (unmountedRef.current) { if ('provider' in res) void res.provider.stop(); return; } // left the screen: release the camera
      if ('error' in res) { setErr(res.error.message + (res.tried.length > 1 ? ` (tried ${res.tried.join(', ')})` : '')); setStep('error'); return; }
      const g = new GazeSession(res.provider, { ...base, provider: res.provider.id, provider_version: res.provider.version }, sessOpts, { debug }).expose();
      g.videoEl = video;
      g.begin();
      setSession(g);
      setStep('camera');
    })();
    return () => { unmountedRef.current = true; };
  }, []);

  // ---- the camera element is shown inside the preview box only on the camera step; otherwise parked on <body>
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (step === 'camera' && wrapRef.current) { v.classList.remove('parked'); wrapRef.current.appendChild(v); }
    else parkGazeVideo(v);
    return () => { parkGazeVideo(v); };
  }, [step, session]);

  // ---- camera step: face position guide. Blocks only on "no face" / "far off-centre"; distance and lighting are hints.
  // Laptop use is the norm: a face at 60–80 cm is ~90–130 px wide in a 640 px frame, so do not ask people to come closer
  // unless the face is genuinely tiny.
  useEffect(() => {
    if (step !== 'camera' || !session) return;
    const v = videoRef.current;
    return session.tapRaw((r: RawGaze) => {
      const vw = v?.videoWidth || 640, vh = v?.videoHeight || 480;
      if (!r.face) return setFace({ ok: false, msg: 'No face detected yet — face the camera from a normal laptop distance (60–80 cm) with light in front of you.' });
      const cx = (r.face.x + r.face.w / 2) / vw - 0.5, cy = (r.face.y + r.face.h / 2) / vh - 0.5, tol = gcfg.calibration.face_centre_tolerance;
      if (Math.abs(cx) > tol || Math.abs(cy) > tol + 0.08) return setFace({ ok: false, msg: 'Face found — move so it sits roughly in the oval (you can stay at your normal distance).' });
      const hints: string[] = [];
      if (r.face.lum !== undefined && r.face.lum < gcfg.calibration.min_face_lum) hints.push('your face is dark — turn toward a light; the dark reading room makes the camera struggle');
      if (r.face.w < vw * 0.10) hints.push('your face is very small in the frame — a little closer helps accuracy');
      setFace({ ok: true, msg: hints.length ? `Face found and centred. Hint: ${hints.join('; ')}. You can still begin.` : 'Face found and centred. Click "Begin calibration": an amber dot will then appear and move around the screen — follow it with your eyes.' });
    });
  }, [step, session]);

  // ---- shared dot routine: show a dot, settle, collect samples for `collectMs`
  const collectAt = async (p: Pt, settleMs: number, collectMs: number): Promise<{ samples: Pt[]; invalid: number; faceW: number[]; lum: number[] }> => {
    setDot(p);
    await sleep(settleMs);
    const samples: Pt[] = [], faceW: number[] = [], lum: number[] = [];
    let invalid = 0;
    const off = session!.tapRaw((r) => { if (r.valid) samples.push({ sx: r.sx, sy: r.sy }); else invalid++; if (r.face) { faceW.push(r.face.w); if (r.face.lum !== undefined) lum.push(r.face.lum); } });
    await sleep(collectMs);
    off();
    return { samples, invalid, faceW, lum };
  };

  const runCalibration = async (g: GazeSession) => {
    setStep('calibrate');
    const pts = gridPoints(gcfg.calibration.points, window.innerWidth, window.innerHeight);
    const faceW: number[] = [], lum: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      setProgress(`Calibration ${i + 1} / ${pts.length}`);
      const c = await collectAt(pts[i]!, settleMs, dwellMs - settleMs);
      faceW.push(...c.faceW); lum.push(...c.lum);
      await g.provider.calibrate(pts[i]!);
    }
    setStep('validate');
    const vpts = gridPoints(gcfg.calibration.validation_points, window.innerWidth, window.innerHeight);
    const vs: ValidationSamples = [];
    for (let i = 0; i < vpts.length; i++) {
      setProgress(`Validation ${i + 1} / ${vpts.length}`);
      const c = await collectAt(vpts[i]!, settleMs, dwellMs - settleMs);
      vs.push({ target: vpts[i]!, samples: c.samples, invalid: c.invalid });
    }
    setDot(null);
    const m = validationMetrics(vs);
    const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1]! : 0);
    const tier = qualityTier(m.accuracy_px, m.loss_pct, gcfg.quality);
    g.meta = {
      ...g.meta,
      validation: { accuracy_px: round(m.accuracy_px), precision_px: round(m.precision_px), loss_pct: round(m.loss_pct), n_points: m.n_points },
      calibration: { n_points: pts.length, face_box: { w: round(median(faceW)), h: round(median(faceW) * 1.25) }, ...(lum.length ? { face_lum: round(median(lum)) } : {}) },
      quality_tier: tier, timestamp: new Date().toISOString(),
    };
    setMetrics(m);
    setStep('result');
  };

  const runDrift = async (g: GazeSession) => {
    setStep('drift');
    const c = await collectAt({ sx: window.innerWidth / 2, sy: window.innerHeight / 2 }, 300, gcfg.drift.dot_ms);
    setDot(null);
    const e = c.samples.length ? c.samples.reduce((a, s) => a + Math.hypot(s.sx - window.innerWidth / 2, s.sy - window.innerHeight / 2), 0) / c.samples.length : Infinity;
    const bad = needsRecalibration(e, g.meta.validation.accuracy_px, gcfg.drift.recalibrate_factor);
    g.meta = { ...g.meta, drift_checks: [...(g.meta.drift_checks ?? []), { case_index: (g.meta.drift_checks?.length ?? 0) + 1, error_px: round(e), recalibrated: false }] };
    setDriftErr(e);
    if (!bad) { onDone(g); return; }
    setStep('driftResult');
  };
  useEffect(() => { if (drift) void runDrift(drift); }, []);

  const fitScale = fitView(window.innerWidth - 380, window.innerHeight - 80, 1024, 1024).scale;

  // ---- render
  // The <video> is created imperatively and lives on <body> for the whole session (see createGazeVideo); React never
  // remounts it, and it survives this screen unmounting so the pipeline keeps running while reading.
  const inCal = step === 'calibrate' || step === 'validate' || step === 'drift';
  const videoBox = step === 'camera' ? <div className="video-wrap" ref={wrapRef}><div className="guide" /></div> : null;

  if (inCal) {
    return (
      <div className="cal-stage">
        {videoBox}
        <div style={{ position: 'absolute', top: 16, left: 0, right: 0, textAlign: 'center', color: '#c9d1d9' }}>{step === 'drift' ? 'Quick drift check — look at the dot' : `${progress} — look at the dot`}</div>
        {dot && <div className="cal-dot" style={{ left: dot.sx, top: dot.sy }} />}
      </div>
    );
  }

  return (
    <div className="page">
      {videoBox}
      <h1>Eye tracking setup</h1>
      {step === 'starting' && <><p>Starting the webcam and loading models locally…</p><p className="note">{log.join(' · ')}</p></>}
      {step === 'error' && <><p className="warn">{err}</p><p className="note">Reading works without gaze; analysis falls back to the cursor proxy.</p>
        <button className="primary" onClick={onSkip}>Continue without gaze</button> <button className="ghost" onClick={() => location.reload()}>Try again</button></>}
      {step === 'camera' && session && (
        <>
          <p>Sit as you normally would at your laptop (about 60–80 cm) with light in front of you, not behind. Your face only needs to be roughly inside the oval — no need to lean in. Glasses are fine but can reduce accuracy.</p>
          <p className="note">What happens next: after you click "Begin calibration", the screen goes dark and an amber dot appears at 9 positions, then 5 more for validation (about 1.5 s each). Keep your head still and follow the dot with your eyes.</p>
          <p className={face.ok ? '' : 'warn'} data-testid="face-msg">{face.msg}</p>
          <p className="note">Provider: {session.provider.id} {session.provider.version} · camera frames stay in this tab and are never stored.</p>
          <button className="primary" disabled={!face.ok && !dev} onClick={() => setStep('sizing')}>Begin calibration</button> <button className="ghost" onClick={async () => { await session.end(); onSkip(); }}>Continue without gaze</button>
        </>
      )}
      {step === 'sizing' && session && (
        <>
          <p><strong>Optional:</strong> hold a credit card against the screen and drag the slider until the box matches its width. This gives a px-per-cm estimate for the report. Skip if you like.</p>
          <div style={{ width: cardPx, height: cardPx / 1.586, border: '2px solid var(--learner)', borderRadius: 8, margin: '12px 0' }} />
          <input type="range" min={150} max={700} value={cardPx} onChange={(e) => setCardPx(+e.target.value)} style={{ width: 400 }} />
          <div style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => { session.meta = { ...session.meta, px_per_cm: round(cardPx / 8.56) }; void runCalibration(session); }}>Use this size &amp; calibrate</button>{' '}
            <button className="ghost" onClick={() => runCalibration(session)}>Skip sizing &amp; calibrate</button>
          </div>
        </>
      )}
      {step === 'result' && session && metrics && (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Webcam gaze estimate, ±{Math.round(metrics.accuracy_px / fitScale)} image px at fit zoom</h3>
            <table className="facts" style={{ color: 'var(--paper)' }}><tbody>
              <tr><th style={{ color: '#aab3bd' }}>Accuracy (mean error)</th><td>{round(metrics.accuracy_px)} screen px ≈ {Math.round(metrics.accuracy_px / fitScale)} image px at fit</td></tr>
              <tr><th style={{ color: '#aab3bd' }}>Precision (RMS sample-to-sample)</th><td>{round(metrics.precision_px)} screen px</td></tr>
              <tr><th style={{ color: '#aab3bd' }}>Data loss</th><td>{round(metrics.loss_pct)} %</td></tr>
              <tr><th style={{ color: '#aab3bd' }}>Quality tier</th><td><strong>{session.meta.quality_tier}</strong> — {tierSupports(session.meta.quality_tier)}</td></tr>
              {session.meta.pipeline_latency_ms !== undefined && <tr><th style={{ color: '#aab3bd' }}>Pipeline latency</th><td>{session.meta.pipeline_latency_ms} ms</td></tr>}
            </tbody></table>
            <p className="note">Finding ROIs are ≈36 image px wide, so at fit zoom gaze supports zone-level claims; finding-level claims need σ ≤ {gcfg.resolution.lesion_sigma_max} image px, which usually means zooming in ({(metrics.accuracy_px / gcfg.resolution.lesion_sigma_max).toFixed(1)}× or more here).</p>
          </div>
          <button className="primary" data-testid="cal-continue" onClick={() => onDone(session)}>Start reading</button>{' '}
          <button className="ghost" onClick={() => runCalibration(session)}>Recalibrate</button>{' '}
          <button className="ghost" onClick={async () => { await session.end(); onSkip(); }}>Continue without gaze</button>
        </>
      )}
      {step === 'driftResult' && session && (
        <>
          <p className="warn">Gaze has drifted: error at the check dot was {round(driftErr ?? 0)} screen px vs {round(session.meta.validation.accuracy_px)} px at calibration (threshold ×{gcfg.drift.recalibrate_factor}). A quick recalibration is recommended.</p>
          <button className="primary" onClick={async () => { await runCalibration(session); }}>Recalibrate now</button>{' '}
          <button className="ghost" onClick={() => onDone(session)}>Continue anyway</button>
        </>
      )}
    </div>
  );
}

function round(x: number) { return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0; }
