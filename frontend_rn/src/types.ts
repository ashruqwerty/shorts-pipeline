export type FeatureKey = "today" | "tasks" | "assets" | "series";

export interface TodayResponse {
  date_ist: string;
  status: string;
  topic: {
    category: string;
    angle: string;
    hook_idea: string;
  };
  overview: {
    title: string;
    duration_sec: number;
    highlights: string[];
  };
  script_version: number;
  series_context?: {
    series_id: string;
    name: string;
    day: number;
    total: number;
  } | null;
}

export interface EpisodePlan {
  angle: string;
  hook: string;
  sections: {
    hook: string;
    context: string;
    evidence: string;
    story_turn: string;
    takeaway: string;
    cta: string;
  };
  research_checklist: string[];
  saved_at: string;
}

export interface SeriesItem {
  day_offset: number;
  sub_topic: string;
  category: string;
  topic_angle: string;
  hook_idea: string;
  plan_notes?: string | null;
  script_draft?: string | null;
}

export interface EpisodeScriptOut {
  series_id: string;
  day_offset: number;
  script: Record<string, unknown>;
}

export interface SeriesDraft {
  id: string;
  name: string;
  day_count: number;
  status: string;
  items: SeriesItem[];
  created_at: string;
}

export interface SeriesChatMessage {
  role: "user" | "assistant";
  content: string;
  action?: string;
  episodes?: SeriesItem[];
  episodesChanged?: number[];
  clarifyingQuestion?: string | null;
}

export interface SeriesChatResponse {
  action: string;
  reply: string;
  episodes: SeriesItem[] | null;
  episodes_changed: number[] | null;
  clarifying_question: string | null;
}

export interface EpisodePlanResponse {
  action: string;
  reply: string;
  key_points: string[] | null;
  updated_angle: string | null;
  updated_hook: string | null;
  plan: EpisodePlan | null;
}

export interface EpisodePlanMessage {
  role: "user" | "assistant";
  content: string;
  action?: string;
  keyPoints?: string[];
  updatedAngle?: string | null;
  updatedHook?: string | null;
  plan?: EpisodePlan | null;
}

export interface AssetOut {
  id: string;
  original_name: string;
  stored_name: string;
  kind: string;
  topic: string | null;
  recording_date: string | null;
  section_index: number | null;
  size_bytes: number;
  created_at: string;
  download_url: string;
  preview_url: string;
}

export interface StorageSummary {
  total_files: number;
  total_size_bytes: number;
  by_kind: Record<string, { count: number; size_bytes: number }>;
}

export interface ScriptSectionV2 {
  index: number;
  name: string;
  label: string;
  timing: { start_s: number; end_s: number };
  shot_type: string;
  text: string;
  plain_text: string;
  word_count: number;
  cue_summary: string[];
  on_screen_text: string;
  transition_after: string;
  b_roll_slot: boolean;
  b_roll_prompt: string;
  proof_overlay: string;
}

export interface TeleprompterResponse {
  date_ist: string;
  version: number;
  sections: ScriptSectionV2[];
}

export interface PipelineTriggerResult {
  date_ist: string;
  status: string;
  progress: string;
  output_path: string | null;
}

export interface PipelineStatusOut {
  date_ist: string;
  status: string | null;
  progress: string;
  output_path: string | null;
  step?: string | null;
  logs?: string[];
  ffmpeg_pct?: number | null;
}

export interface BRollTestSectionOut {
  section_index: number;
  section_name: string;
  prompt: string;
  duration_s: number;
  success: boolean;
  file_name: string | null;
  error: string | null;
}

export interface BRollTestStatusOut {
  status: string | null;
  date_ist: string | null;
  results: BRollTestSectionOut[];
  logs: string[];
}

export interface ScriptBundleOut {
  date_ist: string;
  version: number;
  created_at: string;
  script: Record<string, unknown>;
}

export interface ScriptChatResponse {
  action: string;
  reply: string;
  proposed_sections: ScriptSectionV2[] | null;
  apply_token: string | null;
  sections_changed: number[] | null;
  clarifying_question: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  action?: string;
  proposedSections?: ScriptSectionV2[];
  sectionsChanged?: number[];
  applyToken?: string;
  clarifyingQuestion?: string | null;
}
