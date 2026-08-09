export type FeatureKey = "today" | "tasks" | "assets";

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

export interface SectionTiming {
  start_s: number;
  end_s: number;
}

export interface ScriptSectionV2 {
  index: number;
  name: string;
  label: string;
  timing: SectionTiming;
  shot_type: string;
  word_count: number;
  text: string;
  plain_text: string;
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
  clip_count: number;
  status: string;
  output_path: string | null;
  message: string;
}
