// Opt-in → camera preview → calibration → validation → result. Also the between-case drift check.
// G1: only the "demo without camera" path (mock provider) is wired; live providers land in G2.
import { useEffect, useState } from 'react';
import { MockProvider } from '@gaze/providers/mock';
import type { GazeSessionMeta } from '@gaze/types';
import type { Config } from '../api';
import type { LandingChoice } from '../Landing';
import { GazeSession } from './session';
import { demoScript } from './demoScript';

type Props = { cfg: Config; choice: LandingChoice; onDone: (g: GazeSession) => void; onSkip: () => void; drift?: GazeSession };

export function GazeSetup({ cfg, choice, onDone, onSkip, drift }: Props) {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (drift) return; // live drift check lands in G2
    if (choice.demo) {
      const stageW = window.innerWidth - 380, stageH = window.innerHeight - 80;
      const provider = new MockProvider(demoScript(stageW, stageH, 60), { hz: cfg.gaze.providers.target_hz, jitterPx: 18, seed: 7, loop: true });
      const meta: GazeSessionMeta = {
        schema: 'gaze_session_meta.v1', provider: 'mock', provider_version: provider.version,
        screen: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        validation: { accuracy_px: 45, precision_px: 15, loss_pct: 2, n_points: 5 },
        calibration: { n_points: 9, face_box: { w: 180, h: 220 }, face_lum: 128 },
        quality_tier: 'coarse', train_on_clicks: false, study_mode: choice.study, timestamp: new Date().toISOString(),
      };
      const g = new GazeSession(provider, meta, { headMaxScaleChange: cfg.gaze.head.max_scale_change, minFaceLum: cfg.gaze.calibration.min_face_lum, qualityCoarsePx: cfg.gaze.quality.coarse.accuracy_px_max }, { debug: new URLSearchParams(location.search).has('gazedot') });
      g.begin();
      onDone(g);
      return;
    }
    setErr('Live webcam tracking arrives in milestone G2. Use "Demo without camera" for now.');
  }, []);
  if (drift) return <div className="page"><p>Drift check arrives in G2.</p><button className="primary" onClick={onSkip}>Continue</button></div>;
  return (
    <div className="page">
      <h1>Eye tracking setup</h1>
      {err ? <><p className="warn">{err}</p><button className="primary" onClick={onSkip}>Continue without gaze</button></> : <p>Starting…</p>}
    </div>
  );
}
