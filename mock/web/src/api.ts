import type { GazeSample, GazeSessionMeta } from '@gaze/types';
import type { TelemetryEvent } from './telemetry';

export type Config = { gaze: any; mock: any; badge: string; synthetic: boolean; n_cases: number };
export type Session = { id: string; name: string; study: boolean; gaze: boolean; source: string; synthetic: boolean; case_order: string[]; n_attempts?: number };
export type NextCase = { done: boolean; id: string; width: number; height: number; index: number; total: number; source: string };
export type Mark = { x: number; y: number; label: string; confidence: number; t: number };
export type SubmitResult = any; // shaped by mock/api/analysis.py; rendered by Reveal.tsx

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  config: () => j<Config>('/api/config'),
  newSession: (name: string, study: boolean, gaze: boolean) => j<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ name, study, gaze }) }),
  next: (session: string) => j<NextCase>(`/api/cases/next?session=${encodeURIComponent(session)}`),
  imageUrl: (id: string) => `/api/cases/${id}/image`,
  putGazeMeta: (session: string, meta: GazeSessionMeta) => j(`/api/sessions/${session}/gaze_meta`, { method: 'PUT', body: JSON.stringify(meta) }),
  submit: (caseId: string, body: { session: string; marks: Mark[]; normal: boolean; globals: string[]; telemetry: TelemetryEvent[]; gaze?: GazeSample[]; gaze_meta?: GazeSessionMeta; read_ms: number }) =>
    j<SubmitResult>(`/api/attempts/${caseId}/submit`, { method: 'POST', body: JSON.stringify(body) }),
  summary: (session: string) => j<any>(`/api/sessions/${session}/summary`),
  attempt: (session: string, i: number) => j<any>(`/api/sessions/${session}/attempts/${i}`),
  exportSession: (session: string) => j<any>(`/api/sessions/${session}/export`),
};
