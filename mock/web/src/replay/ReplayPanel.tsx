import type { Config, NextCase } from '../api';

// Filled in at G3: zone timeline, scanpath replay, heatmaps, per-finding table.
export function ReplayPanel({ result }: { cfg: Config; kase: NextCase; result: any }) {
  if (!result.replay) return <div className="muted">Search replay appears once gaze analysis lands (G3).</div>;
  return null;
}
