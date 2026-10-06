import { useState } from 'react';
import type { Config } from './api';

export type LandingChoice = { name: string; gaze: boolean; demo: boolean; study: boolean; replayFile?: File };

export function Landing({ cfg, onStart }: { cfg: Config; onStart: (c: LandingChoice) => void }) {
  const study = new URLSearchParams(location.search).get('study') === '1';
  const [name, setName] = useState('');
  const [gaze, setGaze] = useState(false);
  const [demo, setDemo] = useState(false);
  const [file, setFile] = useState<File | undefined>();
  return (
    <div className="page">
      <h1>Blindspot <span className="badge">{cfg.badge}</span></h1>
      <p className="note">A mock of the Blindspot reading room with webcam eye tracking switched on. Read {cfg.mock.session.cases_per_session} chest films, mark what you find, then see how your gaze and your cursor compare.
        {cfg.synthetic && <strong> Films are synthetic phantoms (n = {cfg.n_cases}), not radiographs.</strong>}</p>
      <div className="card">
        <label className="row">Your name <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Learner" data-testid="name" /></label>
      </div>
      <div className="card">
        <label className="row"><input type="checkbox" checked={gaze} onChange={(e) => { setGaze(e.target.checked); if (e.target.checked) setDemo(false); }} data-testid="gaze-toggle" /> <strong>Turn on eye tracking (optional)</strong></label>
        <p className="note">Your webcam is used in your browser only. <strong>Camera frames never leave the browser and are never stored.</strong> We record gaze coordinates on the screen, a per-sample uncertainty, and quality numbers from calibration (accuracy, precision, data loss). Gaze is off by default; the camera stops when you turn gaze off or the session ends. Webcam gaze is coarse (about 100–300 image px at fit zoom) and accuracy varies by person, glasses, lighting and camera. Camera access needs <code>https</code> or <code>localhost</code>.</p>
      </div>
      <div className="card">
        <label className="row"><input type="checkbox" checked={demo} onChange={(e) => { setDemo(e.target.checked); if (e.target.checked) setGaze(false); }} data-testid="demo-toggle" /> <strong>Demo without camera</strong></label>
        <p className="note">Replays a scripted scanpath through the whole flow so you can see the gaze reveal with no webcam. Or load a recorded session export (<code>.json</code>) to replay it, labelled "Recorded session".</p>
        <input type="file" accept="application/json" onChange={(e) => { setFile(e.target.files?.[0]); if (e.target.files?.[0]) { setDemo(true); setGaze(false); } }} />
      </div>
      {study && <div className="card"><strong>Validation-study mode</strong><p className="note">Fixed case order, click training off, gaze and cursor recorded together, drift checks, one schema-validated JSON export per session.</p></div>}
      <button className="primary" data-testid="start" onClick={() => onStart({ name: name || 'Learner', gaze, demo, study, ...(file ? { replayFile: file } : {}) })}>
        {gaze ? 'Continue to calibration' : 'Start reading'}
      </button>
      <p className="note" style={{ marginTop: 24 }}><a href="#about" onClick={(e) => { e.preventDefault(); onStart({ name: 'about', gaze: false, demo: false, study: false }); }}>About &amp; attribution</a></p>
    </div>
  );
}
