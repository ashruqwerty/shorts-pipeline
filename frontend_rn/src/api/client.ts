import { AssetOut, BRollTestStatusOut, EpisodePlan, EpisodePlanResponse, EpisodeScriptOut, PipelineStatusOut, PipelineTriggerResult, ScriptBundleOut, ScriptChatResponse, SeriesChatResponse, SeriesDraft, StorageSummary, TeleprompterResponse, TodayResponse } from "../types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    const fallback = `HTTP ${response.status}`;
    let detail = fallback;
    try {
      const body = await response.json();
      detail = body.detail || fallback;
    } catch {
      // Keep fallback when response body is not JSON.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export async function fetchAssetKinds(): Promise<string[]> {
  const payload = await request<{ kinds: string[] }>("/api/asset-kinds");
  return payload.kinds;
}

export function fetchToday(): Promise<TodayResponse> {
  return request<TodayResponse>("/api/daily/today");
}

export function regenerateScript() {
  return request("/api/daily/script/regenerate", { method: "POST" });
}

export function fetchTeleprompter(): Promise<TeleprompterResponse> {
  return request<TeleprompterResponse>("/api/daily/teleprompter");
}

export function updateSessionStatus(status: string) {
  return request<{ date_ist: string; status: string; updated_at: string }>("/api/daily/session/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export function fetchStorageSummary() {
  return request<StorageSummary>("/api/storage/summary");
}

export function fetchAssets() {
  return request<AssetOut[]>("/api/assets");
}

export async function uploadAsset(params: {
  fileUri: string;
  fileName: string;
  mimeType: string;
  kind: string;
  topic?: string;
  recordingDate?: string;
  sectionIndex?: number;
}) {
  const formData = new FormData();
  formData.append("kind", params.kind);
  if (params.topic) formData.append("topic", params.topic);
  if (params.recordingDate) formData.append("recording_date", params.recordingDate);
  if (params.sectionIndex !== undefined) formData.append("section_index", String(params.sectionIndex));

  // Web (browser): fetch the blob from the blob: URI and append as a real File.
  // Native (React Native): append the {uri, name, type} object directly.
  const isWeb = typeof document !== "undefined";
  if (isWeb && params.fileUri.startsWith("blob:")) {
    const blob = await fetch(params.fileUri).then((r) => r.blob());
    const file = new File([blob], params.fileName, { type: params.mimeType || "application/octet-stream" });
    formData.append("file", file);
  } else {
    formData.append("file", {
      uri: params.fileUri,
      name: params.fileName,
      type: params.mimeType || "application/octet-stream",
    } as unknown as Blob);
  }

  return request<AssetOut>("/api/assets/upload", {
    method: "POST",
    body: formData,
  });
}

export function deleteAsset(assetId: string) {
  return request<{ status: string }>(`/api/assets/${assetId}`, { method: "DELETE" });
}

export function triggerPipeline(): Promise<PipelineTriggerResult> {
  return request<PipelineTriggerResult>("/api/pipeline/trigger", { method: "POST" });
}

export function getPipelineStatus(): Promise<PipelineStatusOut> {
  return request<PipelineStatusOut>("/api/pipeline/status");
}

export function getPipelineDownloadUrl(): string {
  return `${API_BASE_URL}/api/pipeline/output/download`;
}

export function chatScript(params: {
  message: string;
  history: { role: string; content: string }[];
  scope: string;
}): Promise<ScriptChatResponse> {
  return request<ScriptChatResponse>("/api/daily/script/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export function applyScriptProposal(applyToken: string): Promise<ScriptBundleOut> {
  return request<ScriptBundleOut>("/api/daily/script/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apply_token: applyToken }),
  });
}

export function revertScript(dateIst: string, toVersion: number): Promise<ScriptBundleOut> {
  return request<ScriptBundleOut>("/api/daily/script/revert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date_ist: dateIst, to_version: toVersion }),
  });
}

export function generateSeries(theme: string, dayCount: number): Promise<SeriesDraft> {
  return request<SeriesDraft>("/api/series/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme, day_count: dayCount }),
  });
}

export function chatSeries(params: {
  seriesId: string;
  message: string;
  history: { role: string; content: string }[];
}): Promise<SeriesChatResponse> {
  return request<SeriesChatResponse>("/api/series/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ series_id: params.seriesId, message: params.message, history: params.history }),
  });
}

export function activateSeries(seriesId: string): Promise<SeriesDraft> {
  return request<SeriesDraft>("/api/series/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ series_id: seriesId }),
  });
}

export function getActiveSeries(): Promise<SeriesDraft | null> {
  return request<SeriesDraft | null>("/api/series/active");
}

export function planSeriesEpisode(params: {
  seriesId: string;
  dayOffset: number;
  message: string;
  history: { role: string; content: string }[];
}): Promise<EpisodePlanResponse> {
  return request<EpisodePlanResponse>("/api/series/episode/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      series_id: params.seriesId,
      day_offset: params.dayOffset,
      message: params.message,
      history: params.history,
    }),
  });
}

export function generateEpisodeScript(params: {
  seriesId: string;
  dayOffset: number;
}): Promise<EpisodeScriptOut> {
  return request<EpisodeScriptOut>("/api/series/episode/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ series_id: params.seriesId, day_offset: params.dayOffset }),
  });
}

export function saveEpisodePlan(params: {
  seriesId: string;
  dayOffset: number;
  plan: EpisodePlan;
}): Promise<SeriesDraft> {
  return request<SeriesDraft>("/api/series/episode/save-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      series_id: params.seriesId,
      day_offset: params.dayOffset,
      plan: params.plan,
    }),
  });
}

export function startBrollTest(): Promise<BRollTestStatusOut> {
  return request<BRollTestStatusOut>("/api/broll/test/start", { method: "POST" });
}

export function getBrollTestStatus(): Promise<BRollTestStatusOut> {
  return request<BRollTestStatusOut>("/api/broll/test/status");
}

export function fetchAllVeoPrompts(): Promise<{
  date_ist: string;
  visual_bible: Record<string, { name: string; definition: string }>;
  sections: {
    section_index: number;
    section_name: string;
    section_label: string;
    narration: string;
    b_roll_concept: string;
    total_duration_s: number;
    shots: { moment: string; duration_s: number; prompt: string }[];
  }[];
}> {
  return request("/api/broll/preview-all-prompts");
}

export function previewVeoPrompt(sectionIndex: number): Promise<{
  section_name: string;
  section_label: string;
  narration: string;
  b_roll_concept: string;
  total_duration_s: number;
  visual_bible: Record<string, { name: string; definition: string }>;
  shots: { moment: string; duration_s: number; prompt: string }[];
}> {
  return request("/api/broll/preview-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section_index: sectionIndex }),
  });
}

export function fetchTopics(): Promise<
  { id: string; day_index: number; category: string; topic_angle: string; hook_idea: string }[]
> {
  return request("/api/daily/topics");
}

export function reassignTodayTopic(topicId: string): Promise<{
  date_ist: string;
  topic_id: string;
  category: string;
  topic_angle: string;
  hook_idea: string;
}> {
  return request("/api/daily/reassign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic_id: topicId }),
  });
}
