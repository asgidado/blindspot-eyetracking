import type { ScriptedPoint } from '@gaze/providers/mock';

/** A plausible scripted scanpath over a fit-to-height film, in client px, for the "demo without camera" mode.
 *  Starts upper-left (patient right apex), sweeps lungs, lingers at the heart, skips the left costophrenic angle. */
export function demoScript(stageW: number, stageH: number, headerH: number): ScriptedPoint[] {
  const s = Math.min(stageW, stageH) / 1024, ox = (stageW - 1024 * s) / 2, oy = headerH + (stageH - 1024 * s) / 2;
  const P = (x: number, y: number) => ({ sx: ox + x * s, sy: oy + y * s });
  const path: [number, number, number][] = [ // [image x, image y, hold ms]
    [330, 300, 1200], [330, 520, 900], [330, 700, 1100], [690, 300, 800], [690, 520, 1000], [700, 720, 600], [560, 640, 2200],
    [512, 300, 700], [330, 230, 500], [690, 230, 1500], [330, 800, 400], [512, 880, 600], [330, 520, 1200], [560, 640, 900],
  ];
  const out: ScriptedPoint[] = [];
  let t = 0;
  for (const [x, y, hold] of path) {
    const p = P(x, y);
    out.push({ tMs: t, ...p }); t += 250; // saccade-ish travel
    out.push({ tMs: t, ...p }); t += hold;
    out.push({ tMs: t, ...p });
  }
  return out;
}
