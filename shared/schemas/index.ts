// TS mirrors of shared/schemas/*.schema.json. Keep in sync; shared/schemas/schemas.test.ts checks drift.

export type Vp = [number, number, number, number];

export type GazeSample = {
  t: number;
  sx: number;
  sy: number;
  x?: number;
  y?: number;
  sigma: number;
  valid: boolean;
  zoom: number;
  vp: Vp;
  on_loupe?: boolean;
  target?: 'image' | 'ui' | 'off';
  face_lum?: number;
  slice?: number;
};

export type QualityTier = 'good' | 'coarse' | 'poor';
export type ProviderId = 'webeyetrack' | 'webgazer' | 'mock';

export type GazeSessionMeta = {
  schema: 'gaze_session_meta.v1';
  provider: ProviderId;
  provider_version: string;
  screen: { width: number; height: number; dpr: number };
  validation: { accuracy_px: number; precision_px: number; loss_pct: number; n_points: number };
  calibration: { n_points: number; face_box: { w: number; h: number }; face_lum?: number };
  camera?: { width: number; height: number };
  quality_tier: QualityTier;
  px_per_cm?: number;
  pipeline_latency_ms?: number;
  inference_hz?: number;
  train_on_clicks: boolean;
  study_mode: boolean;
  drift_checks?: { case_index: number; error_px: number; recalibrated: boolean }[];
  timestamp: string;
};

export type Source = 'gaze' | 'cursor';
export type Resolution = 'lesion' | 'zone' | 'none';
export type MissType = 'search' | 'recognition' | 'decision' | null;
export type ZoneRef = { zone: string; human: string; source: Source };

export type GazeFacts = {
  schema: 'gaze_facts.v1';
  phase: 'pre_submit' | 'post_submit';
  synthetic?: boolean;
  attention: {
    sources: Source[];
    gaze_quality?: QualityTier;
    gaze_accuracy_img_px_at_fit?: number;
    supports: 'lesion_level' | 'zone_level' | 'cursor_only';
  };
  search: {
    total_read_ms: number;
    first_mark_ms?: number | null;
    first_zone?: ZoneRef;
    last_zone_before_first_mark?: ZoneRef;
    last_zone_before_submit?: ZoneRef;
    zone_sequence: { zone: string; human?: string; enter_ms: number; dwell_ms: number; source: Source }[];
    revisits?: Record<string, number>;
    longest_dwell_zones?: { zone: string; human: string; dwell_ms: number; source: Source }[];
    fixation_count?: number;
    order_note?: string;
  };
  review_areas: {
    zone: string; human: string; hardness: number;
    gaze_dwell_ms?: number; gaze_resolution?: Resolution;
    cursor_dwell_ms: number;
    visited_gaze?: boolean; visited_cursor: boolean;
    visit_threshold_ms: number;
    reference: 'review_area_checklist';
  }[];
  coverage?: {
    gaze_weighted_pct?: number; cursor_weighted_pct?: number;
    unvisited_hard_gaze?: string[]; unvisited_hard_cursor?: string[];
  };
  findings?: {
    finding_id: string; label: string; location: string;
    outcome: 'found' | 'mislabeled' | 'missed' | 'overcall';
    gaze?: { dwell_ms: number; resolution: Resolution; miss_type: MissType; miss_type_confidence?: number; time_to_first_ms?: number | null; sigma_px?: number };
    cursor: { dwell_ms: number; miss_type: MissType };
    bands_ms: { recognition_from: number; decision_from: number };
    agreement?: 'agree' | 'disagree' | 'n/a';
    reference: 'expert_annotation';
  }[];
  agreement?: {
    n_samples?: number;
    median_gaze_cursor_px?: Record<string, number | null>;
    gaze_leads_cursor_ms?: number | null;
    review_area_visited_agreement_pct?: number | null;
    review_area_kappa?: number | null;
  };
  history?: {
    n_cases: number;
    review_area_unvisited?: Record<string, number>;
    miss_types?: Record<string, Record<string, number>>;
  };
  references: Record<string, string>;
  claim_limits: { never_say: string[]; finding_level_gaze_claims_only_if: string; describe_order_as: string };
};
