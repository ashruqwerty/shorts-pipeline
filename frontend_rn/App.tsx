import * as DocumentPicker from "expo-document-picker";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera/next";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  deleteAsset,
  fetchAssetKinds,
  fetchAssets,
  fetchStorageSummary,
  fetchTeleprompter,
  fetchToday,
  getApiBaseUrl,
  regenerateScript,
  triggerPipeline,
  updateSessionStatus,
  uploadAsset,
} from "./src/api/client";
import { AssetOut, FeatureKey, ScriptSectionV2, StorageSummary, TodayResponse } from "./src/types";

const COLORS = {
  bg: "#f7f7fb",
  card: "#ffffff",
  text: "#22212a",
  muted: "#6b6a77",
  border: "#ecebf1",
  accent: "#fc8019",
  accentDark: "#e86f0f",
  warn: "#b54708",
  danger: "#e45a5a",
};

const CUE_COLORS: Record<string, string> = {
  SLOW:      "#60A5FA",
  FAST:      "#F97316",
  NORMAL:    "#9CA3AF",
  EMPHASIZE: "#FBBF24",
  WHISPER:   "#C4B5FD",
  LOUD:      "#F87171",
  HIGH:      "#34D399",
  LOW:       "#6366F1",
  PAUSE:     "#9CA3AF",
  BEAT:      "#4B5563",
  BREATHE:   "#86EFAC",
  EXCITED:   "#FB923C",
  SERIOUS:   "#374151",
};

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const decimals = size < 10 && idx > 0 ? 1 : 0;
  return `${size.toFixed(decimals)} ${units[idx]}`;
}

function buildStyles(width: number) {
  const isTablet = width >= 720;
  const isDesktop = width >= 1080;
  return StyleSheet.create({
    app: {
      flex: 1,
      backgroundColor: COLORS.bg,
    },
    topBar: {
      borderBottomWidth: 1,
      borderBottomColor: COLORS.border,
      backgroundColor: "#fff7ef",
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 10,
    },
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    kicker: {
      color: COLORS.accent,
      fontSize: 11,
      textTransform: "uppercase",
      fontWeight: "700",
      letterSpacing: 0.6,
    },
    title: {
      color: COLORS.text,
      fontWeight: "800",
      fontSize: isDesktop ? 22 : 18,
    },
    localDotWrap: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: "#ffd7b8",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#fff4ea",
    },
    localDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: COLORS.accent,
    },
    switcher: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },
    switchBtn: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.card,
    },
    switchBtnActive: {
      backgroundColor: COLORS.accent,
      borderColor: COLORS.accent,
    },
    switchText: {
      fontWeight: "700",
      color: COLORS.muted,
      fontSize: 13,
    },
    switchTextActive: {
      color: "#fff",
    },
    container: {
      flex: 1,
      paddingHorizontal: isDesktop ? 28 : 14,
      paddingVertical: 14,
    },
    card: {
      backgroundColor: COLORS.card,
      borderColor: COLORS.border,
      borderWidth: 1,
      borderRadius: 18,
      padding: 14,
      marginBottom: 12,
    },
    cardTitle: {
      fontWeight: "800",
      fontSize: 20,
      color: COLORS.text,
    },
    subtitle: {
      marginTop: 5,
      color: COLORS.muted,
      fontSize: 14,
    },
    status: {
      marginTop: 10,
      color: COLORS.muted,
      fontSize: 13,
    },
    // Topic header
    topicCard: {
      backgroundColor: "#fff7ef",
      borderColor: "#ffe4cc",
      borderWidth: 1,
      borderRadius: 14,
      padding: 12,
      marginBottom: 10,
      gap: 4,
    },
    topicCategory: {
      color: COLORS.accent,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    topicAngle: {
      color: COLORS.text,
      fontSize: 16,
      fontWeight: "800",
      lineHeight: 22,
    },
    topicHook: {
      color: COLORS.muted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2,
    },
    topicMeta: {
      color: COLORS.muted,
      fontSize: 12,
      marginTop: 4,
    },
    // Script preview section cards
    sectionCard: {
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
      backgroundColor: "#fafaf9",
      gap: 7,
    },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flexWrap: "wrap",
    },
    sectionLabel: {
      color: COLORS.text,
      fontWeight: "800",
      fontSize: 14,
    },
    sectionMeta: {
      color: COLORS.muted,
      fontSize: 11,
      fontWeight: "600",
    },
    shotBadge: {
      borderRadius: 999,
      paddingHorizontal: 7,
      paddingVertical: 2,
      backgroundColor: "#e8f0fe",
    },
    shotBadgeText: {
      color: "#3b5fce",
      fontSize: 10,
      fontWeight: "700",
    },
    cueRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 5,
    },
    cuePill: {
      borderRadius: 999,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    cuePillText: {
      fontSize: 10,
      fontWeight: "800",
      color: "#fff",
    },
    sectionText: {
      color: COLORS.text,
      fontSize: 14,
      lineHeight: 20,
    },
    sectionOnScreen: {
      color: COLORS.muted,
      fontSize: 12,
      fontStyle: "italic",
    },
    previewLabel: {
      color: COLORS.muted,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    // Existing styles
    todayGrid: {
      marginTop: 12,
      gap: 10,
      flexDirection: isTablet ? "row" : "column",
      flexWrap: "wrap",
    },
    todayBlock: {
      width: isTablet ? "48.5%" : "100%",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#ffe4cc",
      backgroundColor: "#fffaf5",
      padding: 10,
      gap: 6,
    },
    blockTitle: {
      color: COLORS.warn,
      fontSize: 13,
      fontWeight: "700",
    },
    blockText: {
      color: COLORS.text,
      fontSize: 14,
      lineHeight: 19,
    },
    bulletText: {
      color: COLORS.text,
      fontSize: 14,
      lineHeight: 19,
      paddingLeft: 6,
    },
    primaryBtn: {
      marginTop: 12,
      backgroundColor: COLORS.accent,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 14,
    },
    primaryBtnText: {
      color: "#fff",
      fontWeight: "700",
      fontSize: 15,
    },
    secondaryBtn: {
      backgroundColor: "#fff2e5",
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 11,
      paddingHorizontal: 14,
      alignSelf: "flex-start",
    },
    secondaryBtnText: {
      color: "#8a4e1e",
      fontWeight: "700",
      fontSize: 14,
    },
    summaryRow: {
      flexDirection: isTablet ? "row" : "column",
      gap: 8,
    },
    summaryBox: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: COLORS.border,
      padding: 10,
      backgroundColor: "#fff",
    },
    summaryLabel: {
      color: COLORS.muted,
      fontSize: 12,
    },
    summaryValue: {
      marginTop: 4,
      color: COLORS.text,
      fontWeight: "800",
      fontSize: 18,
    },
    rowWrap: {
      flexDirection: isTablet ? "row" : "column",
      gap: 8,
      marginBottom: 8,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: COLORS.text,
      fontSize: 14,
      backgroundColor: "#fff",
    },
    kindRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 8,
    },
    kindChip: {
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: "#fff",
    },
    kindChipActive: {
      borderColor: COLORS.accent,
      backgroundColor: "#fff2e5",
    },
    kindChipText: {
      color: COLORS.muted,
      fontWeight: "700",
      fontSize: 12,
    },
    kindChipTextActive: {
      color: "#8a4e1e",
    },
    assetRow: {
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 12,
      padding: 10,
      marginBottom: 8,
      gap: 6,
      backgroundColor: "#fff",
    },
    assetName: {
      color: COLORS.text,
      fontWeight: "700",
      fontSize: 14,
    },
    assetMeta: {
      color: COLORS.muted,
      fontSize: 12,
    },
    assetActions: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },
    miniBtn: {
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: "#fff",
    },
    miniBtnDanger: {
      borderColor: "#ffd5d5",
      backgroundColor: "#ffecec",
    },
    miniBtnText: {
      color: COLORS.text,
      fontWeight: "700",
      fontSize: 12,
    },
    miniBtnTextDanger: {
      color: COLORS.danger,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(23, 18, 14, 0.55)",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
    },
    modalCard: {
      width: "100%",
      maxWidth: 980,
      backgroundColor: "#fff",
      borderRadius: 16,
      borderWidth: 1,
      borderColor: COLORS.border,
      padding: 14,
      gap: 10,
    },
    modalTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    teleMeta: {
      color: COLORS.muted,
      fontSize: 13,
    },
    teleText: {
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 12,
      padding: 14,
      backgroundColor: "#fffdfb",
      minHeight: isDesktop ? 240 : 170,
      color: COLORS.text,
      lineHeight: 40,
      fontWeight: "700",
    },
    teleControls: {
      flexDirection: isTablet ? "row" : "column",
      gap: 8,
    },
    teleControlBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 10,
      paddingVertical: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#fff",
    },
    teleControlText: {
      color: COLORS.text,
      fontSize: 13,
      fontWeight: "700",
    },
    teleNav: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 8,
    },
    emptyText: {
      color: COLORS.muted,
      fontSize: 13,
      marginTop: 6,
    },
  });
}

// ── Cue text parsing & rendering (F004) ─────────────────────────────────────

type TextSegment = { type: "text"; content: string } | { type: "cue"; name: string };

function parseTextWithCues(text: string): TextSegment[] {
  return text.split(/(\[[A-Z]+\])/).map((part) => {
    const m = part.match(/^\[([A-Z]+)\]$/);
    return m ? { type: "cue", name: m[1] } : { type: "text", content: part };
  });
}

const LIGHT_CUES = new Set(["EMPHASIZE", "BREATHE", "HIGH", "NORMAL", "PAUSE"]);

function InlineCuedText({ text, fontSize }: { text: string; fontSize: number }) {
  const segments = parseTextWithCues(text);
  return (
    <Text style={{ fontSize, lineHeight: fontSize * 1.4, fontWeight: "700", color: "#22212a" }}>
      {segments.map((seg, i) =>
        seg.type === "cue" ? (
          <Text
            key={i}
            style={{
              backgroundColor: CUE_COLORS[seg.name] ?? "#9CA3AF",
              color: LIGHT_CUES.has(seg.name) ? "#1a1a1a" : "#fff",
              fontSize: fontSize * 0.48,
              fontWeight: "800",
              borderRadius: 3,
            }}
          >
            {` ${seg.name} `}
          </Text>
        ) : (
          <Text key={i}>{seg.content}</Text>
        )
      )}
    </Text>
  );
}

// ── Section preview card ─────────────────────────────────────────────────────

function SectionPreviewCard({ section, styles }: { section: ScriptSectionV2; styles: ReturnType<typeof buildStyles> }) {
  const { timing, label, shot_type, cue_summary, plain_text, on_screen_text, word_count } = section;
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <Text style={styles.sectionMeta}>{timing.start_s}–{timing.end_s}s</Text>
        <View style={styles.shotBadge}>
          <Text style={styles.shotBadgeText}>{shot_type}</Text>
        </View>
        <Text style={styles.sectionMeta}>{word_count}w</Text>
      </View>
      {cue_summary.length > 0 && (
        <View style={styles.cueRow}>
          {cue_summary.map((cue) => {
            const bg = CUE_COLORS[cue] ?? "#9CA3AF";
            const isLight = ["EMPHASIZE", "BREATHE", "HIGH", "NORMAL", "PAUSE"].includes(cue);
            return (
              <View key={cue} style={[styles.cuePill, { backgroundColor: bg }]}>
                <Text style={[styles.cuePillText, { color: isLight ? "#1a1a1a" : "#fff" }]}>{cue}</Text>
              </View>
            );
          })}
        </View>
      )}
      <Text style={styles.sectionText}>{plain_text}</Text>
      {on_screen_text ? (
        <Text style={styles.sectionOnScreen}>On screen: {on_screen_text}</Text>
      ) : null}
    </View>
  );
}

export default function App() {
  const { width } = useWindowDimensions();
  const styles = useMemo(() => buildStyles(width), [width]);

  const [feature, setFeature] = useState<FeatureKey>("today");
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [scriptSections, setScriptSections] = useState<ScriptSectionV2[]>([]);
  const [assetKinds, setAssetKinds] = useState<string[]>([]);
  const [selectedKind, setSelectedKind] = useState<string>("a_roll");
  const [topicInput, setTopicInput] = useState("");
  const [recordingDateInput, setRecordingDateInput] = useState("");
  const [assets, setAssets] = useState<AssetOut[]>([]);
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [assetFilter, setAssetFilter] = useState("");
  const [todayStatus, setTodayStatus] = useState("");
  const [taskStatus, setTaskStatus] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [teleOpen, setTeleOpen] = useState(false);
  const [teleIndex, setTeleIndex] = useState(0);
  const [teleTextSize, setTeleTextSize] = useState(38);
  const [sectionElapsed, setSectionElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Camera / recording (F005)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [clipUploading, setClipUploading] = useState(false);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const hasPermissions = (cameraPermission?.granted ?? false) && (micPermission?.granted ?? false);

  async function refreshData() {
    try {
      const [kinds, todayPayload, summaryPayload, assetsPayload, telePayload] = await Promise.all([
        fetchAssetKinds(),
        fetchToday(),
        fetchStorageSummary(),
        fetchAssets(),
        fetchTeleprompter(),
      ]);
      setAssetKinds(kinds);
      if (kinds.length && !kinds.includes(selectedKind)) {
        setSelectedKind(kinds[0]);
      }
      setToday(todayPayload);
      setSummary(summaryPayload);
      setAssets(assetsPayload);
      setScriptSections(telePayload.sections || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setTodayStatus(`Failed to load: ${message}`);
      setTaskStatus(`Failed to load: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function onRegenerateScript() {
    setTaskStatus("Regenerating script...");
    setTodayStatus("Regenerating script...");
    try {
      await regenerateScript();
      await refreshData();
      setTaskStatus("Script regenerated.");
      setTodayStatus("Script regenerated.");
      setFeature("today");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setTaskStatus(`Regenerate failed: ${message}`);
      setTodayStatus(`Regenerate failed: ${message}`);
    }
  }

  function startSectionTimer(durationSec: number) {
    if (timerRef.current) clearInterval(timerRef.current);
    setSectionElapsed(0);
    timerRef.current = setInterval(() => {
      setSectionElapsed((prev) => {
        if (prev >= durationSec) {
          if (timerRef.current) clearInterval(timerRef.current);
          return durationSec;
        }
        return prev + 0.5;
      });
    }, 500);
  }

  function stopSectionTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function onOpenTeleprompter() {
    if (scriptSections.length === 0) {
      setTodayStatus("Script not loaded yet.");
      return;
    }
    try {
      setTeleIndex(0);
      setTeleOpen(true);
      const first = scriptSections[0];
      startSectionTimer(first.timing.end_s - first.timing.start_s);
      await updateSessionStatus("recording");
      setTodayStatus("Teleprompter ready.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setTodayStatus(`Teleprompter failed: ${message}`);
    }
  }

  async function onNextTeleSection() {
    if (teleIndex < scriptSections.length - 1) {
      const nextIndex = teleIndex + 1;
      setTeleIndex(nextIndex);
      const next = scriptSections[nextIndex];
      startSectionTimer(next.timing.end_s - next.timing.start_s);
      return;
    }

    stopSectionTimer();
    try {
      await updateSessionStatus("uploaded");
      setTeleOpen(false);
      setTodayStatus("All sections done. Triggering pipeline assembly...");
      setTaskStatus("Session set to uploaded.");
      try {
        const pipelineResult = await triggerPipeline();
        if (pipelineResult.status === "ok") {
          setTodayStatus(`Pipeline done! ${pipelineResult.message}`);
        } else {
          setTodayStatus(`Pipeline: ${pipelineResult.message}`);
        }
      } catch {
        setTodayStatus("Session uploaded. Pipeline trigger failed — check backend.");
      }
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setTaskStatus(`Status update failed: ${message}`);
    }
  }

  async function onPressRecord() {
    if (!cameraPermission?.granted) {
      const r = await requestCameraPermission();
      if (!r.granted) return;
    }
    if (!micPermission?.granted) {
      const r = await requestMicPermission();
      if (!r.granted) return;
    }
    if (!cameraRef.current) return;
    setIsRecording(true);
    recordingPromiseRef.current = cameraRef.current.recordAsync();
  }

  async function onPressStop() {
    if (!cameraRef.current || !isRecording) return;
    cameraRef.current.stopRecording();
    setIsRecording(false);
    stopSectionTimer();

    const result = await recordingPromiseRef.current;
    recordingPromiseRef.current = null;

    if (result?.uri) {
      setClipUploading(true);
      try {
        await uploadAsset({
          fileUri: result.uri,
          fileName: `section_${teleIndex}.mp4`,
          mimeType: "video/mp4",
          kind: "a_roll",
          topic: today?.topic.angle ?? undefined,
          sectionIndex: teleIndex,
        });
      } finally {
        setClipUploading(false);
      }
    }

    await onNextTeleSection();
  }

  async function onPickAndUpload() {
    if (!selectedKind) {
      setUploadStatus("Select an upload kind first.");
      return;
    }

    setUploadStatus("Selecting file...");
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      type: "*/*",
      copyToCacheDirectory: true,
    });

    if (result.canceled) {
      setUploadStatus("Upload cancelled.");
      return;
    }

    const file = result.assets[0];
    if (!file) {
      setUploadStatus("No file selected.");
      return;
    }

    setUploadStatus("Uploading...");
    try {
      await uploadAsset({
        fileUri: file.uri,
        fileName: file.name || "upload.bin",
        mimeType: file.mimeType || "application/octet-stream",
        kind: selectedKind,
        topic: topicInput.trim() || undefined,
        recordingDate: recordingDateInput.trim() || undefined,
      });
      setUploadStatus("Upload complete.");
      setTopicInput("");
      setRecordingDateInput("");
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setUploadStatus(`Upload failed: ${message}`);
    }
  }

  async function onDeleteAsset(assetId: string) {
    let proceed = true;
    if (Platform.OS === "web") {
      const confirmFn = globalThis.confirm;
      proceed = typeof confirmFn === "function" ? confirmFn("Delete this asset?") : true;
    }
    if (!proceed) return;

    try {
      await deleteAsset(assetId);
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setUploadStatus(`Delete failed: ${message}`);
    }
  }

  function filteredAssets(): AssetOut[] {
    if (!assetFilter) return assets;
    return assets.filter((asset) => asset.kind === assetFilter);
  }

  function availableFilters(): string[] {
    const set = new Set<string>();
    assets.forEach((asset) => set.add(asset.kind));
    return Array.from(set).sort();
  }

  function renderFeature() {
    if (loading) {
      return (
        <View style={styles.card}>
          <ActivityIndicator color={COLORS.accent} />
          <Text style={styles.status}>Loading app data...</Text>
        </View>
      );
    }

    if (feature === "today") {
      return (
        <View>
          {/* Topic header */}
          {today && (
            <View style={styles.topicCard}>
              <Text style={styles.topicCategory}>{today.topic.category.replace(/_/g, " ")}</Text>
              <Text style={styles.topicAngle}>{today.topic.angle}</Text>
              {today.topic.hook_idea ? (
                <Text style={styles.topicHook}>{today.topic.hook_idea}</Text>
              ) : null}
              <Text style={styles.topicMeta}>
                {today.overview.title} · {today.overview.duration_sec}s · Script v{today.script_version}
              </Text>
            </View>
          )}

          {/* Full script preview */}
          <View style={styles.card}>
            <Text style={styles.previewLabel}>Script Preview</Text>
            {scriptSections.length > 0 ? (
              scriptSections.map((section) => (
                <SectionPreviewCard key={section.index} section={section} styles={styles} />
              ))
            ) : (
              <Text style={styles.emptyText}>No script loaded. Regenerate from Tasks.</Text>
            )}
            <Pressable style={styles.primaryBtn} onPress={onOpenTeleprompter}>
              <Text style={styles.primaryBtnText}>Enter Teleprompter Mode</Text>
            </Pressable>
            {todayStatus ? <Text style={styles.status}>{todayStatus}</Text> : null}
          </View>
        </View>
      );
    }

    if (feature === "tasks") {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Task Controls</Text>
          <Text style={styles.subtitle}>Extra actions are kept here to keep Today minimal.</Text>
          <Pressable style={[styles.secondaryBtn, { marginTop: 12 }]} onPress={onRegenerateScript}>
            <Text style={styles.secondaryBtnText}>Regenerate Script</Text>
          </Pressable>
          <Text style={styles.status}>{taskStatus}</Text>
        </View>
      );
    }

    const filters = availableFilters();
    const list = filteredAssets();

    return (
      <View>
        <View style={[styles.card, { marginBottom: 10 }]}>
          <Text style={styles.cardTitle}>Storage</Text>
          <View style={[styles.summaryRow, { marginTop: 10 }]}>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>Total Files</Text>
              <Text style={styles.summaryValue}>{summary?.total_files ?? 0}</Text>
            </View>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>Total Size</Text>
              <Text style={styles.summaryValue}>{formatBytes(summary?.total_size_bytes ?? 0)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Upload Asset</Text>
          <Text style={styles.subtitle}>Allowed kinds: a_roll and b_roll_custom.</Text>
          <View style={styles.kindRow}>
            {assetKinds.map((kind) => {
              const active = selectedKind === kind;
              return (
                <Pressable
                  key={kind}
                  style={[styles.kindChip, active && styles.kindChipActive]}
                  onPress={() => setSelectedKind(kind)}
                >
                  <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>{kind}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.rowWrap}>
            <TextInput
              style={styles.input}
              value={topicInput}
              onChangeText={setTopicInput}
              placeholder="Topic (optional)"
              placeholderTextColor={COLORS.muted}
            />
            <TextInput
              style={styles.input}
              value={recordingDateInput}
              onChangeText={setRecordingDateInput}
              placeholder="Recording date YYYY-MM-DD"
              placeholderTextColor={COLORS.muted}
            />
          </View>

          <Pressable style={styles.primaryBtn} onPress={onPickAndUpload}>
            <Text style={styles.primaryBtnText}>Pick File and Upload</Text>
          </Pressable>
          <Text style={styles.status}>{uploadStatus}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Assets</Text>
          <View style={styles.kindRow}>
            <Pressable
              style={[styles.kindChip, !assetFilter && styles.kindChipActive]}
              onPress={() => setAssetFilter("")}
            >
              <Text style={[styles.kindChipText, !assetFilter && styles.kindChipTextActive]}>all</Text>
            </Pressable>
            {filters.map((kind) => {
              const active = assetFilter === kind;
              return (
                <Pressable
                  key={kind}
                  style={[styles.kindChip, active && styles.kindChipActive]}
                  onPress={() => setAssetFilter(kind)}
                >
                  <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>{kind}</Text>
                </Pressable>
              );
            })}
          </View>

          {list.length ? (
            list.map((asset) => (
              <View style={styles.assetRow} key={asset.id}>
                <Text style={styles.assetName}>{asset.original_name}</Text>
                <Text style={styles.assetMeta}>
                  {asset.kind} | {asset.topic || "-"} | {asset.recording_date || "-"} | {formatBytes(asset.size_bytes)}
                </Text>
                <View style={styles.assetActions}>
                  <Pressable
                    style={styles.miniBtn}
                    onPress={() => Linking.openURL(`${getApiBaseUrl()}${asset.download_url}`)}
                  >
                    <Text style={styles.miniBtnText}>Download</Text>
                  </Pressable>
                  <Pressable
                    style={styles.miniBtn}
                    onPress={() => Linking.openURL(`${getApiBaseUrl()}${asset.preview_url}`)}
                  >
                    <Text style={styles.miniBtnText}>Open</Text>
                  </Pressable>
                  <Pressable style={[styles.miniBtn, styles.miniBtnDanger]} onPress={() => onDeleteAsset(asset.id)}>
                    <Text style={[styles.miniBtnText, styles.miniBtnTextDanger]}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No assets found for this filter.</Text>
          )}
        </View>
      </View>
    );
  }

  const currentSection = scriptSections[teleIndex];

  useEffect(() => {
    void refreshData();
  }, []);

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.kicker}>Daily Creator</Text>
            <Text style={styles.title}>Today First Workflow</Text>
          </View>
          <View style={styles.localDotWrap}>
            <View style={styles.localDot} />
          </View>
        </View>

        <View style={styles.switcher}>
          {(["today", "tasks", "assets"] as FeatureKey[]).map((key) => {
            const active = key === feature;
            return (
              <Pressable
                key={key}
                style={[styles.switchBtn, active && styles.switchBtnActive]}
                onPress={() => setFeature(key)}
              >
                <Text style={[styles.switchText, active && styles.switchTextActive]}>{key.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 26 }}>
        {renderFeature()}
      </ScrollView>

      <Modal
        visible={teleOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { stopSectionTimer(); setTeleOpen(false); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalTop}>
              <Text style={styles.cardTitle}>Teleprompter</Text>
              <Pressable style={styles.secondaryBtn} onPress={() => { stopSectionTimer(); setTeleOpen(false); }}>
                <Text style={styles.secondaryBtnText}>Close</Text>
              </Pressable>
            </View>

            {currentSection ? (
              <>
                {/* Section meta */}
                <Text style={styles.teleMeta}>
                  {teleIndex + 1}/{scriptSections.length} · {currentSection.label} · {currentSection.timing.start_s}–{currentSection.timing.end_s}s · {currentSection.word_count}w
                </Text>

                {/* Word progress bar */}
                {(() => {
                  const duration = currentSection.timing.end_s - currentSection.timing.start_s;
                  const pct = duration > 0 ? Math.min(100, (sectionElapsed / duration) * 100) : 0;
                  return (
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: "#ffe4cc", overflow: "hidden" }}>
                      <View style={{ height: 5, borderRadius: 3, backgroundColor: COLORS.accent, width: `${pct}%` }} />
                    </View>
                  );
                })()}

                {/* Cue chips for this section */}
                {currentSection.cue_summary.length > 0 && (
                  <View style={styles.cueRow}>
                    {currentSection.cue_summary.map((cue) => {
                      const bg = CUE_COLORS[cue] ?? "#9CA3AF";
                      const textColor = LIGHT_CUES.has(cue) ? "#1a1a1a" : "#fff";
                      return (
                        <View key={cue} style={[styles.cuePill, { backgroundColor: bg }]}>
                          <Text style={[styles.cuePillText, { color: textColor }]}>{cue}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Inline cued text */}
                <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ padding: 14 }}>
                  <InlineCuedText text={currentSection.text} fontSize={teleTextSize} />
                </ScrollView>

                {/* Text size controls */}
                <View style={styles.teleControls}>
                  <Pressable
                    style={styles.teleControlBtn}
                    onPress={() => setTeleTextSize((v) => Math.max(22, v - 2))}
                  >
                    <Text style={styles.teleControlText}>A-</Text>
                  </Pressable>
                  <Pressable
                    style={styles.teleControlBtn}
                    onPress={() => setTeleTextSize((v) => Math.min(64, v + 2))}
                  >
                    <Text style={styles.teleControlText}>A+</Text>
                  </Pressable>
                </View>

                {/* Camera row + REC/STOP */}
                {Platform.OS !== "web" && (
                  <View style={{ flexDirection: "row", gap: 10, alignItems: "center", marginTop: 2 }}>
                    <CameraView
                      ref={cameraRef}
                      mode="video"
                      videoQuality="2160p"
                      facing="front"
                      style={{ width: 110, height: 150, borderRadius: 10, overflow: "hidden", backgroundColor: "#000" }}
                    />
                    <View style={{ flex: 1, gap: 8 }}>
                      {isRecording ? (
                        <>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: COLORS.danger }} />
                            <Text style={{ color: COLORS.danger, fontWeight: "800", fontSize: 13 }}>RECORDING</Text>
                          </View>
                          {clipUploading ? (
                            <Text style={{ color: COLORS.muted, fontSize: 12 }}>Uploading clip...</Text>
                          ) : (
                            <Pressable
                              style={{ backgroundColor: "#1a1a1a", borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
                              onPress={onPressStop}
                            >
                              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>■ STOP</Text>
                            </Pressable>
                          )}
                        </>
                      ) : (
                        <>
                          {!hasPermissions && (
                            <Text style={{ color: COLORS.muted, fontSize: 11, lineHeight: 15 }}>
                              Tap REC to grant camera &amp; mic access.
                            </Text>
                          )}
                          <Pressable
                            style={{
                              backgroundColor: COLORS.danger,
                              borderRadius: 10,
                              paddingVertical: 12,
                              alignItems: "center",
                            }}
                            onPress={onPressRecord}
                          >
                            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>● REC</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  </View>
                )}

                {/* Navigation — hidden while recording */}
                {!isRecording && (
                  <View style={styles.teleNav}>
                    <Pressable
                      style={styles.secondaryBtn}
                      onPress={() => {
                        const prev = Math.max(0, teleIndex - 1);
                        setTeleIndex(prev);
                        const sec = scriptSections[prev];
                        startSectionTimer(sec.timing.end_s - sec.timing.start_s);
                      }}
                    >
                      <Text style={styles.secondaryBtnText}>Previous</Text>
                    </Pressable>
                    <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={onNextTeleSection}>
                      <Text style={styles.primaryBtnText}>
                        {teleIndex < scriptSections.length - 1 ? "Next Section" : "Finish"}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.emptyText}>No teleprompter sections found.</Text>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
