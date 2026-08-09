import { AssetOut, PipelineTriggerResult, StorageSummary, TeleprompterResponse, TodayResponse } from "../types";

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

export function fetchTeleprompter() {
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

  formData.append("file", {
    uri: params.fileUri,
    name: params.fileName,
    type: params.mimeType || "application/octet-stream",
  } as unknown as Blob);

  return request<AssetOut>("/api/assets/upload", {
    method: "POST",
    body: formData,
  });
}

export function deleteAsset(assetId: string) {
  return request<{ status: string }>(`/api/assets/${assetId}`, { method: "DELETE" });
}

export function triggerPipeline() {
  return request<PipelineTriggerResult>("/api/daily/pipeline/trigger", { method: "POST" });
}
