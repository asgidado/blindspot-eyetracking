import { useEffect, useState } from 'react';
import { api, type Config, type NextCase, type Session } from './api';
import { Landing, type LandingChoice } from './Landing';
import { About } from './About';
import { ReadingRoom } from './ReadingRoom';
import { Reveal } from './Reveal';
import { Summary } from './Summary';
import { RecordedReplay } from './Replay';
import { GazeSetup } from './gaze/GazeSetup';
import type { GazeSession } from './gaze/session';

type Screen = { k: 'landing' } | { k: 'about' } | { k: 'calibrate'; choice: LandingChoice } | { k: 'read'; kase: NextCase } | { k: 'reveal'; kase: NextCase; result: any } | { k: 'summary' } | { k: 'drift'; kase: NextCase } | { k: 'replay'; data: any };

export function App() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [gaze, setGaze] = useState<GazeSession | null>(null);
  const [screen, setScreen] = useState<Screen>({ k: 'landing' });
  const [, tick] = useState(0);
  useEffect(() => { api.config().then(setCfg).catch((e) => console.error(e)); }, []);
  useEffect(() => gaze?.onChange(() => tick((n) => n + 1)), [gaze]);

  if (!cfg) return <div className="page">Connecting to the mock API… (run <code>make dev</code>)</div>;

  const startSession = async (choice: LandingChoice, g: GazeSession | null) => {
    const s = await api.newSession(choice.name, choice.study, !!g);
    setSession(s); setGaze(g);
    if (g) await api.putGazeMeta(s.id, g.meta);
    const kase = await api.next(s.id);
    setScreen({ k: 'read', kase });
  };

  const onStart = (choice: LandingChoice) => {
    if (choice.name === 'about') return setScreen({ k: 'about' });
    if (choice.replayFile) {
      choice.replayFile.text().then(async (txt) => {
        const r = await fetch('/api/replay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: txt });
        setScreen({ k: 'replay', data: await r.json() });
      }).catch((e) => alert(`Could not replay: ${e}`));
      return;
    }
    if (choice.gaze || choice.demo) return setScreen({ k: 'calibrate', choice });
    void startSession(choice, null);
  };

  const next = async () => {
    if (!session) return;
    const kase = await api.next(session.id);
    if (kase.done) { await gaze?.end(); return setScreen({ k: 'summary' }); }
    if (gaze && gaze.provider.id !== 'mock' && kase.index > 0) return setScreen({ k: 'drift', kase });
    setScreen({ k: 'read', kase });
  };

  const statusChip = gaze ? ({ off: ['Gaze off', ''], tracking: ['Tracking', 'on'], low: ['Low quality', 'warn'], lost: ['Lost face', 'warn'], dark: ['Light your face', 'warn'] } as const)[gaze.status] : ['Gaze off', ''];

  return (
    <div className="app">
      <header className="top">
        <span className="brand">Blindspot</span>
        <span className="badge" data-testid="badge">{cfg.badge}</span>
        {session && <span className="badge">{session.study ? 'Validation study' : session.name}</span>}
        <span className="spacer" />
        {gaze && <span className="chip" title={`Webcam gaze estimate, ±${Math.round(gaze.meta.validation.accuracy_px)} screen px · ${gaze.meta.quality_tier}`}>{gaze.provider.id === 'mock' ? 'Demo gaze (scripted)' : `Webcam gaze · ${gaze.meta.quality_tier}`}</span>}
        <span className={`chip ${statusChip[1]}`} data-testid="gaze-chip">{statusChip[0]}</span>
      </header>
      {screen.k === 'landing' && <Landing cfg={cfg} onStart={onStart} />}
      {screen.k === 'about' && <About onBack={() => setScreen({ k: 'landing' })} />}
      {screen.k === 'calibrate' && <GazeSetup cfg={cfg} choice={screen.choice} onDone={(g) => startSession(screen.choice, g)} onSkip={() => startSession({ ...screen.choice, gaze: false }, null)} />}
      {screen.k === 'drift' && gaze && <GazeSetup cfg={cfg} choice={{ name: session!.name, gaze: true, demo: false, study: session!.study }} drift={gaze} onDone={(g) => { void api.putGazeMeta(session!.id, g.meta); setScreen({ k: 'read', kase: screen.kase }); }} onSkip={() => setScreen({ k: 'read', kase: screen.kase })} />}
      {screen.k === 'read' && session && <ReadingRoom cfg={cfg} session={session} kase={screen.kase} gaze={gaze} onResult={(result) => setScreen({ k: 'reveal', kase: screen.kase, result })} />}
      {screen.k === 'reveal' && <Reveal cfg={cfg} kase={screen.kase} result={screen.result} onNext={next} last={screen.kase.index + 1 >= screen.kase.total} />}
      {screen.k === 'replay' && <RecordedReplay cfg={cfg} data={screen.data} onExit={() => setScreen({ k: 'landing' })} />}
      {screen.k === 'summary' && session && <Summary session={session} onRestart={() => { setSession(null); setGaze(null); setScreen({ k: 'landing' }); }} />}
      <footer className="bottom">For education. Not for clinical use.</footer>
    </div>
  );
}
