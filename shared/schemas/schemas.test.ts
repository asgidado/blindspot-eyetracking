import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import sampleSchema from './gaze_sample.schema.json';
import metaSchema from './gaze_session_meta.schema.json';
import factsSchema from './gaze_facts.schema.json';
import type { GazeFacts, GazeSample, GazeSessionMeta } from './index';

const ajv = new Ajv({ strict: false });
addFormats(ajv);

const sample: GazeSample = { t: 1, sx: 2, sy: 3, sigma: 10, valid: true, zoom: 1, vp: [0, 0, 1024, 1024], x: 5, y: 6 };
const meta: GazeSessionMeta = {
  schema: 'gaze_session_meta.v1', provider: 'mock', provider_version: '0.1.0',
  screen: { width: 1440, height: 900, dpr: 2 }, validation: { accuracy_px: 60, precision_px: 12, loss_pct: 3, n_points: 5 },
  calibration: { n_points: 9, face_box: { w: 180, h: 220 } }, quality_tier: 'coarse', train_on_clicks: true, study_mode: false,
  timestamp: '2026-10-06T12:00:00Z',
};
const facts: GazeFacts = {
  schema: 'gaze_facts.v1', phase: 'pre_submit', attention: { sources: ['cursor'], supports: 'cursor_only' },
  search: { total_read_ms: 1000, zone_sequence: [] }, review_areas: [], references: {},
  claim_limits: { never_say: [], finding_level_gaze_claims_only_if: 'x', describe_order_as: 'descriptive only' },
};

test('TS fixtures validate against the JSON schemas', () => {
  for (const [schema, obj] of [[sampleSchema, sample], [metaSchema, meta], [factsSchema, facts]] as const) {
    const ok = ajv.validate(schema, obj);
    expect(ajv.errorsText()).toBe('No errors');
    expect(ok).toBe(true);
  }
});

test('camera frames or unknown keys are rejected', () => {
  expect(ajv.validate(sampleSchema, { ...sample, frame: 'data:image/png;base64,...' })).toBe(false);
});
