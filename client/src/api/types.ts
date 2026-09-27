export type Level = 'low' | 'moderate' | 'high' | 'critical';
export type Trend = 'rising' | 'steady' | 'falling';
export type SubRole = 'district_officer' | 'police' | 'bro' | 'rescue' | 'sdma';
export type Role = 'citizen' | 'authority' | 'admin' | 'developer';

export interface Driver { key: string; contribution: number }

export type ImdColor = 'green' | 'yellow' | 'orange' | 'red';
/** India Meteorological Department district warning (today and the next two days) and any active nowcast. */
export interface ImdSummary {
  days: { codes: number[]; color: ImdColor | null }[];
  nowcast: { color: ImdColor | null; cats: number[]; message: string | null; valid_until: string | null } | null;
  issued: { date: string | null; utc: string | null } | null;
  fetched_at: string | null;
  source: 'IMD';
}
/** Recent earthquake shaking at a location (NCS, with USGS as backup) and its nearest NCS seismograph. */
export interface SeismicSummary {
  events_7d: number;
  strongest: { mag: number; time: string; depth_km: number; source: 'NCS' | 'USGS'; place: string | null; distance_km: number; mmi: number; severity: number } | null;
  nearest_station: { code: string; name: string; distance_km: number } | null;
  fetched_at: string | null;
  source: string;
}
export interface Quake { id: string; source: 'NCS' | 'USGS'; time: string; mag: number; depth_km: number; lat: number; lng: number; place: string | null; mmi_region: number; age_hours: number }
export interface SeismoStation { code: string; name: string; state: string | null; lat: number; lng: number }
export interface SeismicData { quakes: Quake[]; stations: SeismoStation[]; fetched_at: string | null; feed: { status: string; message: string | null } | null }
/** EXPERIMENTAL model (officers only; never drives alerts). */
export interface MlDay {
  date: string; score: number; elevated: boolean;
  inputs: { rain_d0: number; rain_3d: number; rain_7d: number; rain_30d: number; rain_3d_vs_normal: number | null; max_1h_48h: number; quake_max_mmi_30d: number };
}
export interface MlLatest {
  model: {
    version: string; created_at: string; status: string; meaning: string; elevated_threshold: number;
    evaluation: { auc: number; when: number; where: number; caught: number; false_alarms: number; warnings_right: number; test_landslides: number };
  };
  computed_at: string | null;
  predictions: Record<string, { today?: MlDay; tomorrow?: MlDay }>;
}
/** A confirmed landslide recorded by officers (ground truth for the experimental model). */
export interface LandslideRecord {
  id: string; date: string; lat: number; lng: number; accuracy_km: number; location_id: string | null;
  source: 'officer' | 'report' | 'incident'; source_id: string | null; notes: string | null;
  recorded_by: string; recorded_at: string; retracted_at: string | null; retracted_by: string | null; retract_reason: string | null;
}
export interface MlScorecard {
  coverage: { from: string; to: string; days: number; place_days: number } | null;
  events_recorded: number; events_scored: number; events_outside_area?: number;
  warned_ahead?: number; events_with_ahead_prediction?: number; warned_on_day_or_before?: number;
  quiet_place_days?: number; quiet_elevated?: number; false_alarm_rate?: number | null;
}
export interface ForecastPoint { h: number; score: number; level: Level }

export interface Risk {
  location_id: string;
  score: number;
  level: Level;
  confidence: number;
  drivers: Driver[];
  trend: Trend;
  forecast: ForecastPoint[];
  time_to_threshold: { level: Level; hours: number } | null;
  priority: number;
  exposure_score?: number;
  /** Feature values; `imd` holds the IMD district warning summary (null when IMD has nothing current). */
  conditions: Record<string, number | string | null | ImdSummary | SeismicSummary>;
  model_version: string;
  level_since: string;
  updated_at: string;
}

export interface LocationSnap {
  id: string;
  name_en: string;
  name_hi: string;
  district: string;
  corridor_id: string;
  lat: number;
  lng: number;
  road: string | null;
  field_verified_at: string | null;
  exposure_score: number | null;
  risk: Risk | null;
}

export interface Corridor { id: string; name_en: string; name_hi: string; color: string }

export interface User {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  sub_role: SubRole | null;
  status: 'active' | 'pending' | 'rejected';
  badge_id: string | null;
  department: string | null;
  district: string | null;
  home_location_id: string | null;
  home_village: string | null;
  language: 'en' | 'hi';
  theme: 'light' | 'dark' | 'system';
  text_size: 'normal' | 'large';
  prefs: Record<string, unknown>;
  rejection_reason: string | null;
  created_at: string;
}

export interface Actor {
  role: Role;
  sub_role: SubRole | null;
  district: string | null;
  home_location_id: string | null;
  language: 'en' | 'hi';
  viewing_as: Record<string, unknown> | null;
}

export interface Me { user: User; actor: Actor; capabilities: string[]; dev_mode: boolean }

export interface InboxMessage {
  id: string;
  location_id: string;
  level: Level;
  type: 'escalation' | 'deescalation' | 're_escalation';
  title_key: string;
  params: {
    location_en: string; location_hi: string; district: string; corridor_id: string;
    from: Level; to: Level; score: number; confidence: number; trend: Trend;
    drivers: Driver[]; forecast: ForecastPoint[];
    exposure: { population: number; roads: string[]; facilities: string[]; critical_infra: string[] };
    sops: { key: string; en: string; hi: string }[];
  };
  priority: number;
  escalated: boolean;
  parent_id: string | null;
  created_at: string;
  read: boolean;
  acknowledged_by: string | null;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  incident_id: string | null;
  target_roles: SubRole[];
  target_district: string;
  tags: string[];
}

export interface Controls {
  scenario: { active: boolean; corridors: string[]; intensity: number; startedAt: string | null; by: string | null };
  paused: boolean;
  speed: number;
  forced: Record<string, Level>;
}

export interface RiskEvent {
  location_id: string; name_en: string; name_hi: string; district: string; corridor_id: string;
  from: Level; to: Level; score: number; confidence: number; drivers: Driver[]; trend: Trend; priority: number; at: string;
}

export interface Road {
  id: string; name_en: string; name_hi: string; corridor_id: string; path: string[];
  status: 'open' | 'caution' | 'restricted' | 'blocked' | 'cleared';
  eta_clear_hours: number | null; diversion_en: string | null; diversion_hi: string | null;
  tourist_advisory: boolean; heavy_vehicle_advisory: boolean; updated_by: string | null; updated_at: string;
}

export interface AlertItem {
  id: string; severity: Level; kind: 'warning' | 'all_clear' | 'cancel';
  target_type: 'location' | 'corridor' | 'district'; target_id: string;
  target_name_en: string; target_name_hi: string; target_district: string | null; target_corridor: string | null;
  title_en: string; title_hi: string; body_en: string; body_hi: string; channels: string[];
  incident_id: string | null; created_at: string; cancelled_at: string | null; created_by?: string;
  deliveries?: { channel: string; status: string; detail: string; at: string }[]; ack_count?: number;
}

export type Stage = 'detected' | 'under_verification' | 'verified' | 'alert_issued' | 'response_underway' | 'resolved' | 'closed';

export interface Resource {
  id: string; type: 'excavator' | 'rescue_team' | 'ambulance' | 'shelter'; name: string; location_id: string; district: string;
  status: 'available' | 'deployed' | 'unavailable'; capacity: number | null; occupancy: number; location_en?: string; location_hi?: string;
  lat?: number; lng?: number; incident_id?: string | null;
}

export interface Incident {
  id: string; location_id: string; title: string; stage: Stage; level: Level; owner_id: string | null; owner_name: string | null;
  source: string; notes: string | null; detected_at: string; alert_issued_at: string | null; resolved_at: string | null; closed_at: string | null;
  updated_at: string; name_en: string; name_hi: string; district: string; resource_count?: number; sop_done?: number;
  events?: { id: number; from_stage: Stage | null; to_stage: Stage | null; note: string | null; actor: string; at: string }[];
  sop_ticks?: { sop_key: string; done: number; actor: string; at: string }[];
  resources?: Resource[];
  alerts?: { id: string; severity: Level; kind: string; title_en: string; title_hi: string; created_at: string; cancelled_at: string | null }[];
}

export interface Sop { level: Level; key: string; text_en: string; text_hi: string; roles: SubRole[]; ord: number }

export interface Report {
  id: string; user_id: string | null; type: string; description: string | null; lat: number; lng: number; location_id: string | null;
  status: 'submitted' | 'verified' | 'rejected' | 'resolved'; reviewed_by: string | null; reviewed_at: string | null; created_at: string;
  has_photo: boolean; name_en?: string; name_hi?: string; district?: string;
}

export interface Stakeholder { id: number; role: string; district: string; name: string | null; phone: string | null }
