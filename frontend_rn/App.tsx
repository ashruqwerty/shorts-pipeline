import * as DocumentPicker from "expo-document-picker";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
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
  activateSeries,
  applyScriptProposal,
  chatScript,
  chatSeries,
  deleteAsset,
  fetchAssetKinds,
  fetchAssets,
  fetchStorageSummary,
  fetchTeleprompter,
  fetchToday,
  fetchAllVeoPrompts,
  fetchTopics,
  generateEpisodeScript,
  generateSeries,
  getActiveSeries,
  getApiBaseUrl,
  getBrollTestStatus,
  previewVeoPrompt,
  getPipelineDownloadUrl,
  getPipelineStatus,
  planSeriesEpisode,
  reassignTodayTopic,
  saveEpisodePlan,
  regenerateScript,
  revertScript,
  startBrollTest,
  triggerPipeline,
  updateSessionStatus,
  uploadAsset,
} from "./src/api/client";
import { AssetOut, BRollTestStatusOut, ChatMessage, EpisodePlan, EpisodePlanMessage, EpisodePlanResponse, EpisodeScriptOut, FeatureKey, PipelineStatusOut, ScriptChatResponse, ScriptSectionV2, SeriesChatMessage, SeriesChatResponse, SeriesDraft, SeriesItem, StorageSummary, TodayResponse } from "./src/types";

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
    app: { flex: 1, backgroundColor: COLORS.bg },
    topBar: {
      borderBottomWidth: 1, borderBottomColor: COLORS.border,
      backgroundColor: "#fff7ef", paddingHorizontal: 14, paddingVertical: 10, gap: 10,
    },
    topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    kicker: { color: COLORS.accent, fontSize: 11, textTransform: "uppercase", fontWeight: "700", letterSpacing: 0.6 },
    title: { color: COLORS.text, fontWeight: "800", fontSize: isDesktop ? 22 : 18 },
    localDotWrap: {
      width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: "#ffd7b8",
      alignItems: "center", justifyContent: "center", backgroundColor: "#fff4ea",
    },
    localDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: COLORS.accent },
    switcher: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    switchBtn: {
      paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
      borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card,
    },
    switchBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
    switchText: { fontWeight: "700", color: COLORS.muted, fontSize: 13 },
    switchTextActive: { color: "#fff" },
    container: { flex: 1, paddingHorizontal: isDesktop ? 28 : 14, paddingVertical: 14 },
    card: {
      backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1,
      borderRadius: 18, padding: 14, marginBottom: 12,
    },
    cardTitle: { fontWeight: "800", fontSize: 20, color: COLORS.text },
    subtitle: { marginTop: 5, color: COLORS.muted, fontSize: 14 },
    status: { marginTop: 10, color: COLORS.muted, fontSize: 13 },
    topicCard: {
      backgroundColor: "#fff7ef", borderColor: "#ffe4cc", borderWidth: 1,
      borderRadius: 14, padding: 12, marginBottom: 10, gap: 4,
    },
    topicCategory: { color: COLORS.accent, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    topicAngle: { color: COLORS.text, fontSize: 16, fontWeight: "800", lineHeight: 22 },
    topicHook: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
    topicMeta: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
    sectionCard: {
      borderWidth: 1, borderColor: COLORS.border, borderRadius: 12,
      padding: 12, marginBottom: 8, backgroundColor: "#fafaf9", gap: 7,
    },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
    sectionLabel: { color: COLORS.text, fontWeight: "800", fontSize: 14 },
    sectionMeta: { color: COLORS.muted, fontSize: 11, fontWeight: "600" },
    shotBadge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: "#e8f0fe" },
    shotBadgeText: { color: "#3b5fce", fontSize: 10, fontWeight: "700" },
    cueRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
    cuePill: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
    cuePillText: { fontSize: 10, fontWeight: "800", color: "#fff" },
    sectionText: { color: COLORS.text, fontSize: 14, lineHeight: 20 },
    sectionOnScreen: { color: COLORS.muted, fontSize: 12, fontStyle: "italic" },
    previewLabel: {
      color: COLORS.muted, fontSize: 12, fontWeight: "700",
      textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6,
    },
    todayGrid: { marginTop: 12, gap: 10, flexDirection: isTablet ? "row" : "column", flexWrap: "wrap" },
    todayBlock: {
      width: isTablet ? "48.5%" : "100%", borderRadius: 12, borderWidth: 1,
      borderColor: "#ffe4cc", backgroundColor: "#fffaf5", padding: 10, gap: 6,
    },
    blockTitle: { color: COLORS.warn, fontSize: 13, fontWeight: "700" },
    blockText: { color: COLORS.text, fontSize: 14, lineHeight: 19 },
    primaryBtn: {
      marginTop: 12, backgroundColor: COLORS.accent, borderRadius: 12,
      alignItems: "center", justifyContent: "center", paddingVertical: 14,
    },
    primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
    secondaryBtn: {
      backgroundColor: "#fff2e5", borderRadius: 12, alignItems: "center",
      justifyContent: "center", paddingVertical: 11, paddingHorizontal: 14, alignSelf: "flex-start",
    },
    secondaryBtnText: { color: "#8a4e1e", fontWeight: "700", fontSize: 14 },
    summaryRow: { flexDirection: isTablet ? "row" : "column", gap: 8 },
    summaryBox: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 10, backgroundColor: "#fff" },
    summaryLabel: { color: COLORS.muted, fontSize: 12 },
    summaryValue: { marginTop: 4, color: COLORS.text, fontWeight: "800", fontSize: 18 },
    rowWrap: { flexDirection: isTablet ? "row" : "column", gap: 8, marginBottom: 8 },
    input: {
      flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12,
      paddingHorizontal: 12, paddingVertical: 10, color: COLORS.text, fontSize: 14, backgroundColor: "#fff",
    },
    kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
    kindChip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#fff" },
    kindChipActive: { borderColor: COLORS.accent, backgroundColor: "#fff2e5" },
    kindChipText: { color: COLORS.muted, fontWeight: "700", fontSize: 12 },
    kindChipTextActive: { color: "#8a4e1e" },
    assetRow: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 10, marginBottom: 8, gap: 6, backgroundColor: "#fff" },
    assetName: { color: COLORS.text, fontWeight: "700", fontSize: 14 },
    assetMeta: { color: COLORS.muted, fontSize: 12 },
    assetActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    miniBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "#fff" },
    miniBtnDanger: { borderColor: "#ffd5d5", backgroundColor: "#ffecec" },
    miniBtnText: { color: COLORS.text, fontWeight: "700", fontSize: 12 },
    miniBtnTextDanger: { color: COLORS.danger },
    modalBackdrop: { flex: 1, backgroundColor: "rgba(23, 18, 14, 0.55)", alignItems: "center", justifyContent: "center", padding: 16 },
    modalCard: {
      width: "100%", maxWidth: 980, backgroundColor: "#fff", borderRadius: 16,
      borderWidth: 1, borderColor: COLORS.border, padding: 14, gap: 10,
    },
    modalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    teleMeta: { color: COLORS.muted, fontSize: 13 },
    teleText: {
      borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14,
      backgroundColor: "#fffdfb", minHeight: isDesktop ? 240 : 170,
      color: COLORS.text, lineHeight: 40, fontWeight: "700",
    },
    teleControls: { flexDirection: isTablet ? "row" : "column", gap: 8 },
    teleControlBtn: {
      flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
      paddingVertical: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#fff",
    },
    teleControlText: { color: COLORS.text, fontSize: 13, fontWeight: "700" },
    teleNav: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
    emptyText: { color: COLORS.muted, fontSize: 13, marginTop: 6 },
  });
}

// ── Cue text parsing & rendering ─────────────────────────────────────────────

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

// ── Section preview card ──────────────────────────────────────────────────────

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
            const isLight = LIGHT_CUES.has(cue);
            return (
              <View key={cue} style={[styles.cuePill, { backgroundColor: bg }]}>
                <Text style={[styles.cuePillText, { color: isLight ? "#1a1a1a" : "#fff" }]}>{cue}</Text>
              </View>
            );
          })}
        </View>
      )}
      <Text style={styles.sectionText}>{plain_text}</Text>
      {on_screen_text ? <Text style={styles.sectionOnScreen}>On screen: {on_screen_text}</Text> : null}
    </View>
  );
}

function inferScope(message: string, target: string | null): "section" | "script" {
  if (target) return "section";
  const lower = message.toLowerCase();
  const sectionNames = ["hook", "context", "evidence", "story_turn", "takeaway", "cta", "story turn"];
  if (sectionNames.some((n) => lower.includes(n))) return "section";
  return "script";
}

// ── Episode Plan Popup (series episode detail + script planning chat) ─────────

function EpisodePlanPopup({
  visible,
  onClose,
  item,
  seriesId,
  seriesName,
  onItemUpdated,
  onPlanSaved,
}: {
  visible: boolean;
  onClose: () => void;
  item: SeriesItem | null;
  seriesId: string;
  seriesName: string;
  onItemUpdated: (dayOffset: number, angle: string, hook: string) => void;
  onPlanSaved: (updatedDraft: SeriesDraft) => void;
  onScriptGenerated: (dayOffset: number, scriptJson: string) => void;
}) {
  const [messages, setMessages] = useState<EpisodePlanMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingScript, setGeneratingScript] = useState(false);
  const [scriptPreview, setScriptPreview] = useState<EpisodeScriptOut | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<{ angle: string; hook: string } | null>(null);
  const [pendingPlan, setPendingPlan] = useState<EpisodePlan | null>(null);
  const [veoPromptLoading, setVeoPromptLoading] = useState<number | null>(null);
  const [veoPromptResult, setVeoPromptResult] = useState<Record<number, { narration: string; b_roll_concept: string; veo_prompt: string }>>({});
  const scrollRef = useRef<ScrollView>(null);

  async function onPreviewVeoPrompt(sectionIndex: number) {
    setVeoPromptLoading(sectionIndex);
    try {
      const res = await previewVeoPrompt(sectionIndex);
      setVeoPromptResult(prev => ({ ...prev, [sectionIndex]: res }));
    } catch { /* ignore */ } finally {
      setVeoPromptLoading(null);
    }
  }

  // Auto-fetch the plan overview when popup opens
  useEffect(() => {
    if (visible && item) {
      setMessages([]);
      setInput("");
      setPendingUpdate(null);
      setPendingPlan(null);
      // Restore saved script draft so it persists across popup open/close
      if (item.script_draft) {
        try {
          const draft = JSON.parse(item.script_draft);
          setScriptPreview({ series_id: seriesId, day_offset: item.day_offset, script: draft });
        } catch {
          setScriptPreview(null);
        }
      } else {
        setScriptPreview(null);
      }
      setThinking(true);
      planSeriesEpisode({ seriesId, dayOffset: item.day_offset, message: "", history: [] })
        .then((res) => {
          setMessages([{
            role: "assistant",
            content: res.reply,
            action: res.action,
            keyPoints: res.key_points ?? undefined,
            updatedAngle: res.updated_angle,
            updatedHook: res.updated_hook,
            plan: res.plan,
          }]);
          if (res.updated_angle || res.updated_hook) {
            setPendingUpdate({ angle: res.updated_angle ?? item.topic_angle, hook: res.updated_hook ?? item.hook_idea });
          }
          if (res.plan) setPendingPlan(res.plan);
        })
        .catch(() => {
          setMessages([{ role: "assistant", content: "Failed to load planning overview — try again.", action: "rejected" }]);
        })
        .finally(() => setThinking(false));
    }
  }, [visible, item?.day_offset]);

  async function sendMessage(msg: string) {
    if (!item || !msg.trim() || thinking) return;
    const trimmed = msg.trim();
    setInput("");
    const newMessages: EpisodePlanMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(newMessages);
    setThinking(true);
    try {
      const apiHistory = messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      const res: EpisodePlanResponse = await planSeriesEpisode({ seriesId, dayOffset: item.day_offset, message: trimmed, history: apiHistory });
      const assistantMsg: EpisodePlanMessage = {
        role: "assistant",
        content: res.reply,
        action: res.action,
        keyPoints: res.key_points ?? undefined,
        updatedAngle: res.updated_angle,
        updatedHook: res.updated_hook,
        plan: res.plan,
      };
      setMessages([...newMessages, assistantMsg]);
      if (res.updated_angle || res.updated_hook) {
        setPendingUpdate({ angle: res.updated_angle ?? item.topic_angle, hook: res.updated_hook ?? item.hook_idea });
      }
      if (res.plan) setPendingPlan(res.plan);
    } catch {
      setMessages([...messages, { role: "assistant", content: "Something went wrong — please try again.", action: "rejected" }]);
    } finally {
      setThinking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  async function applyPlan() {
    if (!item || !pendingPlan || saving) return;
    setSaving(true);
    try {
      const updated = await saveEpisodePlan({ seriesId, dayOffset: item.day_offset, plan: pendingPlan });
      onPlanSaved(updated);
      if (pendingUpdate) {
        onItemUpdated(item.day_offset, pendingUpdate.angle, pendingUpdate.hook);
      } else if (pendingPlan.angle || pendingPlan.hook) {
        onItemUpdated(item.day_offset, pendingPlan.angle ?? item.topic_angle, pendingPlan.hook ?? item.hook_idea);
      }
      setPendingPlan(null);
      setPendingUpdate(null);
    } catch {
      // silently fail — plan still in pending state
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateScript() {
    if (!item || generatingScript) return;
    setGeneratingScript(true);
    try {
      const result = await generateEpisodeScript({ seriesId, dayOffset: item.day_offset });
      setScriptPreview(result);
      onScriptGenerated(item.day_offset, JSON.stringify(result.script));
    } catch {
      // stays in no-script state
    } finally {
      setGeneratingScript(false);
    }
  }

  if (!item) return null;

  // Parse existing saved plan if present
  let savedPlan: EpisodePlan | null = null;
  if (item.plan_notes) {
    try { savedPlan = JSON.parse(item.plan_notes); } catch { /* ignore */ }
  }

  function handleClose() {
    if (pendingPlan) {
      // Auto-apply plan on close if pending (fire-and-forget, don't block)
      applyPlan().then(() => onClose());
      return;
    }
    if (pendingUpdate) {
      onItemUpdated(item.day_offset, pendingUpdate.angle, pendingUpdate.hook);
    }
    onClose();
  }

  const hasSavedPlan = !!(savedPlan && !pendingPlan);
  const hasScript = !!(scriptPreview || item.script_draft);
  const scriptSections: any[] | null = (scriptPreview?.script as any)?.sections
    ?? (() => { try { return (JSON.parse(item.script_draft ?? "") as any).sections; } catch { return null; } })();
  const SECTION_COLORS: Record<string, string> = {
    hook: "#dc2626", context: "#0891b2", evidence: "#7c3aed",
    story_turn: "#b45309", takeaway: "#15803d", cta: "#6b7280",
  };

  // Popup expands: chat-only → plan+chat → plan+chat+script
  const maxWidth = (hasSavedPlan ? 240 : 0) + 480 + (hasScript && !!scriptSections ? 420 : 0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" }} onPress={handleClose}>
        <Pressable
          style={{ width: "96%", maxWidth, maxHeight: "92%", backgroundColor: COLORS.card, borderRadius: 16, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 20, elevation: 10, flexDirection: "row" }}
          onPress={(e) => e.stopPropagation()}
        >

          {/* ── LEFT PANEL: Saved Plan ── visible after Apply Plan */}
          {hasSavedPlan && (
            <View style={{ width: 240, borderRightWidth: 1, borderRightColor: COLORS.border, backgroundColor: "#f0fdf4", flexDirection: "column" }}>
              <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#bbf7d0" }}>
                <Text style={{ fontSize: 10, fontWeight: "800", color: "#166534", letterSpacing: 0.8 }}>AGREED PLAN</Text>
              </View>
              <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
                <View style={{ gap: 2, marginBottom: 4 }}>
                  <Text style={{ fontSize: 10, color: "#166534", fontWeight: "700" }}>ANGLE</Text>
                  <Text style={{ fontSize: 11, color: "#14532d", lineHeight: 16 }}>{savedPlan.angle}</Text>
                </View>
                <View style={{ gap: 2, marginBottom: 4 }}>
                  <Text style={{ fontSize: 10, color: "#166534", fontWeight: "700" }}>HOOK</Text>
                  <Text style={{ fontSize: 11, color: "#14532d", lineHeight: 16 }}>{savedPlan.hook}</Text>
                </View>
                <View style={{ height: 1, backgroundColor: "#bbf7d0", marginVertical: 2 }} />
                {Object.entries(savedPlan.sections).map(([key, val]) => (
                  <View key={key} style={{ gap: 1 }}>
                    <Text style={{ fontSize: 9, color: "#166534", fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" }}>{key.replace("_", " ")}</Text>
                    <Text style={{ fontSize: 11, color: "#14532d", lineHeight: 16 }}>{val}</Text>
                  </View>
                ))}
                {savedPlan.research_checklist?.length > 0 && (
                  <View style={{ marginTop: 6, gap: 4 }}>
                    <View style={{ height: 1, backgroundColor: "#bbf7d0" }} />
                    <Text style={{ fontSize: 9, fontWeight: "800", color: "#166534", letterSpacing: 0.5 }}>RESEARCH</Text>
                    {savedPlan.research_checklist.map((pt, j) => (
                      <View key={j} style={{ flexDirection: "row", gap: 5, alignItems: "flex-start" }}>
                        <Text style={{ fontSize: 10, color: "#16a34a", fontWeight: "800" }}>·</Text>
                        <Text style={{ fontSize: 10, color: "#14532d", flex: 1, lineHeight: 15 }}>{pt}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>
          )}

          {/* ── MIDDLE PANEL: Chat (always visible) ── */}
          <View style={{ width: 480, flexDirection: "column", borderRightWidth: hasScript && !!scriptSections ? 1 : 0, borderRightColor: COLORS.border }}>

            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: "#fafaf9" }}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{item.day_offset}</Text>
                  </View>
                  <Text style={{ fontWeight: "800", fontSize: 15, color: COLORS.text, flex: 1 }}>{item.sub_topic}</Text>
                  {savedPlan && (
                    <View style={{ backgroundColor: "#dcfce7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 10, color: "#166534", fontWeight: "700" }}>✓ PLANNED</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 11, color: COLORS.muted, marginLeft: 32 }}>{seriesName} · {item.category}</Text>
              </View>
              <Pressable onPress={handleClose} style={{ padding: 4 }}>
                <Text style={{ fontSize: 20, color: COLORS.muted }}>×</Text>
              </Pressable>
            </View>

            {/* Angle + hook strip */}
            <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 3 }}>
              <Text style={{ fontSize: 12, color: COLORS.text }} numberOfLines={2}><Text style={{ fontWeight: "700" }}>Angle: </Text>{pendingUpdate?.angle ?? pendingPlan?.angle ?? item.topic_angle}</Text>
              <Text style={{ fontSize: 12, color: COLORS.muted, fontStyle: "italic" }} numberOfLines={2}><Text style={{ fontWeight: "700", fontStyle: "normal" }}>Hook: </Text>{pendingUpdate?.hook ?? pendingPlan?.hook ?? item.hook_idea}</Text>
            </View>

            {/* Apply Plan banner */}
            {pendingPlan && (
              <View style={{ backgroundColor: "#fffbeb", paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#fde68a" }}>
                <Text style={{ fontSize: 12, color: "#92400e", fontWeight: "600" }}>Plan ready — apply to save it</Text>
                <Pressable onPress={applyPlan} disabled={saving} style={{ backgroundColor: "#92400e", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5, opacity: saving ? 0.5 : 1 }}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Apply Plan</Text>}
                </Pressable>
              </View>
            )}

            {/* Generate Script button — only when plan saved, no script yet */}
            {hasSavedPlan && !hasScript && (
              <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#dbeafe", backgroundColor: "#eff6ff" }}>
                <Pressable
                  onPress={handleGenerateScript}
                  disabled={generatingScript}
                  style={{ backgroundColor: "#1d4ed8", borderRadius: 10, paddingVertical: 11, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: generatingScript ? 0.6 : 1 }}
                >
                  {generatingScript ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 14 }}>✨</Text>}
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>
                    {generatingScript ? "Generating 90s Script…" : "Generate 90-second Script"}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Chat messages */}
            <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 8 }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
              {messages.length === 0 && thinking && (
                <View style={{ alignItems: "flex-start" }}>
                  <View style={{ backgroundColor: COLORS.bg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator color={COLORS.accent} size="small" />
                    <Text style={{ fontSize: 13, color: COLORS.muted }}>Planning overview…</Text>
                  </View>
                </View>
              )}
              {messages.map((msg, i) => (
                <View key={i} style={{ alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <View style={{ maxWidth: "90%", backgroundColor: msg.role === "user" ? COLORS.accent : COLORS.bg, borderRadius: 12, padding: 10, borderWidth: msg.role === "user" ? 0 : 1, borderColor: msg.action === "rejected" ? "#fca5a5" : COLORS.border }}>
                    <Text style={{ fontSize: 13, color: msg.role === "user" ? "#fff" : COLORS.text, lineHeight: 19 }}>{msg.content}</Text>
                    {msg.keyPoints && msg.keyPoints.length > 0 && (
                      <View style={{ marginTop: 8, gap: 3 }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: COLORS.muted, letterSpacing: 0.5 }}>RESEARCH CHECKLIST</Text>
                        {msg.keyPoints.map((pt, j) => (
                          <View key={j} style={{ flexDirection: "row", gap: 5, alignItems: "flex-start" }}>
                            <Text style={{ fontSize: 11, color: COLORS.accent, fontWeight: "800", marginTop: 1 }}>·</Text>
                            <Text style={{ fontSize: 12, color: COLORS.text, flex: 1 }}>{pt}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              ))}
              {thinking && messages.length > 0 && (
                <View style={{ alignItems: "flex-start" }}>
                  <View style={{ backgroundColor: COLORS.bg, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: COLORS.border }}>
                    <ActivityIndicator color={COLORS.accent} size="small" />
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Input */}
            <View style={{ flexDirection: "row", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.card }}>
              <TextInput
                style={{ flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: COLORS.text, backgroundColor: COLORS.bg, minHeight: 38, maxHeight: 80 }}
                value={input}
                onChangeText={setInput}
                placeholder="Make the angle more dramatic, focus on the founder story…"
                placeholderTextColor={COLORS.muted}
                multiline
                onSubmitEditing={() => sendMessage(input)}
              />
              <Pressable
                onPress={() => sendMessage(input)}
                disabled={thinking || !input.trim()}
                style={{ backgroundColor: COLORS.accent, borderRadius: 10, paddingHorizontal: 12, justifyContent: "center", opacity: (thinking || !input.trim()) ? 0.4 : 1 }}>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Send</Text>
              </Pressable>
            </View>
          </View>

          {/* ── RIGHT PANEL: Script Preview ── visible after Generate Script */}
          {hasScript && scriptSections && (
            <View style={{ width: 420, flexDirection: "column", backgroundColor: "#f8faff" }}>
              {/* Panel header */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#dbeafe", backgroundColor: "#eff6ff" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <Text style={{ fontSize: 14 }}>📝</Text>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: "#1d4ed8" }}>Script Preview</Text>
                  <View style={{ backgroundColor: "#dbeafe", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
                    <Text style={{ fontSize: 10, color: "#1d4ed8", fontWeight: "700" }}>READY</Text>
                  </View>
                </View>
                <Pressable
                  onPress={handleGenerateScript}
                  disabled={generatingScript}
                  style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#1d4ed8", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5, opacity: generatingScript ? 0.6 : 1 }}
                >
                  {generatingScript ? <ActivityIndicator color="#fff" size="small" /> : null}
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>
                    {generatingScript ? "Regenerating…" : "Regenerate"}
                  </Text>
                </Pressable>
              </View>

              {/* Section cards — full height, own scroll */}
              <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
                {scriptSections.map((sec: any) => (
                  <View key={sec.index} style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#dbeafe" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: SECTION_COLORS[sec.name] ?? "#6b7280" }}>
                      <View style={{ backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, color: "#fff", fontWeight: "800" }}>{sec.timing.start_s}s – {sec.timing.end_s}s</Text>
                      </View>
                      <Text style={{ fontSize: 12, color: "#fff", fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 }}>{sec.label}</Text>
                      <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", marginLeft: "auto" }}>{sec.word_count}w · {sec.shot_type}</Text>
                    </View>
                    <View style={{ padding: 12, backgroundColor: "#fff", gap: 6 }}>
                      <Text style={{ fontSize: 13, color: "#1e293b", lineHeight: 20 }}>{sec.plain_text}</Text>
                      {sec.b_roll_prompt ? (
                        <View style={{ gap: 6 }}>
                          <View style={{ backgroundColor: "#faf5ff", borderRadius: 6, padding: 8, borderLeftWidth: 3, borderLeftColor: "#7c3aed" }}>
                            <Text style={{ fontSize: 10, color: "#7c3aed", fontWeight: "700", marginBottom: 2 }}>B-ROLL CONCEPT</Text>
                            <Text style={{ fontSize: 11, color: "#4c1d95" }}>{sec.b_roll_prompt}</Text>
                          </View>
                          <Pressable
                            onPress={() => onPreviewVeoPrompt(sec.index)}
                            disabled={veoPromptLoading === sec.index}
                            style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#f3f0ff", borderRadius: 6, paddingVertical: 5, paddingHorizontal: 8, alignSelf: "flex-start", opacity: veoPromptLoading === sec.index ? 0.6 : 1 }}
                          >
                            {veoPromptLoading === sec.index
                              ? <ActivityIndicator size="small" color="#7c3aed" />
                              : <Text style={{ fontSize: 11 }}>✨</Text>}
                            <Text style={{ fontSize: 10, color: "#7c3aed", fontWeight: "700" }}>
                              {veoPromptLoading === sec.index ? "Building Veo prompt…" : "Preview Veo Prompt"}
                            </Text>
                          </Pressable>
                          {veoPromptResult[sec.index] && (
                            <View style={{ backgroundColor: "#1e1035", borderRadius: 8, padding: 10, gap: 6 }}>
                              <Text style={{ fontSize: 10, color: "#a78bfa", fontWeight: "700" }}>✨ GEMINI-GENERATED VEO PROMPT</Text>
                              <Text style={{ fontSize: 11, color: "#e9d5ff", lineHeight: 17 }}>{veoPromptResult[sec.index].veo_prompt}</Text>
                              <Text style={{ fontSize: 9, color: "#6b7280", marginTop: 2 }}>Narration used: {veoPromptResult[sec.index].narration.slice(0, 80)}…</Text>
                            </View>
                          )}
                        </View>
                      ) : null}
                      {sec.on_screen_text ? (
                        <View style={{ backgroundColor: "#f0f9ff", borderRadius: 6, padding: 8, borderLeftWidth: 3, borderLeftColor: "#0891b2" }}>
                          <Text style={{ fontSize: 10, color: "#0891b2", fontWeight: "700", marginBottom: 2 }}>ON-SCREEN</Text>
                          <Text style={{ fontSize: 11, color: "#0e4f6b" }}>{sec.on_screen_text}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Section Edit Popup (scoped to one section, opens from Today tab) ──────────

function SectionEditPopup({
  visible,
  onClose,
  section,
  scriptSections,
  today,
  onApplied,
}: {
  visible: boolean;
  onClose: () => void;
  section: ScriptSectionV2 | null;
  scriptSections: ScriptSectionV2[];
  today: TodayResponse | null;
  onApplied: (version: number, dateIst: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pendingApply, setPendingApply] = useState<{ token: string; sections: ScriptSectionV2[]; indices: number[] } | null>(null);
  const [applying, setApplying] = useState(false);
  const [appliedInfo, setAppliedInfo] = useState<{ version: number; dateIst: string } | null>(null);
  const [undoData, setUndoData] = useState<{ dateIst: string; prevVersion: number } | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible && section) {
      setMessages([{
        role: "assistant",
        content: `You're editing the **${section.label}** section (${section.timing.start_s}–${section.timing.end_s}s, ${section.word_count}w). What would you like to change?`,
        action: "reply",
      }]);
      setInput("");
      setPendingApply(null);
      setAppliedInfo(null);
      setUndoVisible(false);
    }
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); };
  }, [visible, section?.index]);

  async function sendMessage(msg: string) {
    if (!section) return;
    const trimmed = msg.trim();
    if (!trimmed || thinking) return;
    setInput("");
    setPendingApply(null);

    // Prepend section context to the first real user message so the LLM knows what to target
    const isFirst = messages.filter((m) => m.role === "user").length === 0;
    const contextualMsg = isFirst
      ? `[Editing "${section.label}" section only] ${trimmed}`
      : trimmed;

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(newMessages);
    setThinking(true);

    try {
      const apiHistory = messages.slice(1).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));
      const res: ScriptChatResponse = await chatScript({ message: contextualMsg, history: apiHistory, scope: "section" });

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: res.reply,
        action: res.action,
        proposedSections: res.proposed_sections ?? undefined,
        sectionsChanged: res.sections_changed ?? undefined,
        applyToken: res.apply_token ?? undefined,
        clarifyingQuestion: res.clarifying_question ?? undefined,
      };
      setMessages([...newMessages, assistantMsg]);

      if ((res.action === "propose" || res.action === "redesign") && res.apply_token) {
        setPendingApply({ token: res.apply_token, sections: res.proposed_sections ?? [], indices: res.sections_changed ?? [] });
      }
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "Something went wrong — please try again.", action: "rejected" }]);
    } finally {
      setThinking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  async function onApply() {
    if (!pendingApply) return;
    setApplying(true);
    try {
      const result = await applyScriptProposal(pendingApply.token);
      const info = { version: result.version, dateIst: result.date_ist };
      setAppliedInfo(info);
      setUndoData({ dateIst: result.date_ist, prevVersion: result.version - 1 });
      setUndoVisible(true);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setUndoVisible(false), 30000);
      setPendingApply(null);
      onApplied(result.version, result.date_ist);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Failed to apply — the proposal may have expired.", action: "rejected" }]);
    } finally {
      setApplying(false);
    }
  }

  async function onUndo() {
    if (!undoData) return;
    try {
      const result = await revertScript(undoData.dateIst, undoData.prevVersion);
      setAppliedInfo({ version: result.version, dateIst: result.date_ist });
      setUndoVisible(false);
      onApplied(result.version, result.date_ist);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Undo failed.", action: "rejected" }]);
    }
  }

  if (!section) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Backdrop */}
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" }}
        onPress={onClose}
      >
        {/* Popup card — stop propagation so tapping inside doesn't close */}
        <Pressable
          style={{ width: "92%", maxWidth: 520, maxHeight: "82%", backgroundColor: COLORS.card, borderRadius: 16, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 20, elevation: 10 }}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontWeight: "800", fontSize: 15, color: COLORS.text }}>{section.label}</Text>
              <Text style={{ fontSize: 11, color: COLORS.muted }}>{section.timing.start_s}–{section.timing.end_s}s · {section.word_count}w</Text>
            </View>
            <Pressable onPress={onClose} style={{ padding: 4 }}>
              <Text style={{ fontSize: 20, color: COLORS.muted }}>×</Text>
            </Pressable>
          </View>

          {/* Section preview (read-only) */}
          <View style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#fafaf9", borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
              {section.cue_summary.map((cue) => (
                <View key={cue} style={{ borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: CUE_COLORS[cue] ?? "#9CA3AF" }}>
                  <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{cue}</Text>
                </View>
              ))}
            </View>
            <InlineCuedText text={section.text} fontSize={12} />
          </View>

          {/* Applied banner */}
          {appliedInfo && (
            <View style={{ backgroundColor: "#d1fae5", paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: "#065f46", fontWeight: "700", fontSize: 12 }}>Saved as v{appliedInfo.version} ✓</Text>
              {undoVisible && undoData && (
                <Pressable onPress={onUndo}>
                  <Text style={{ color: "#b45309", fontWeight: "600", fontSize: 12 }}>Undo</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Chat */}
          <ScrollView ref={scrollRef} style={{ flex: 1, maxHeight: 260 }} contentContainerStyle={{ padding: 12, gap: 8 }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
            {messages.map((msg, i) => (
              <View key={i} style={{ alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                <View style={{
                  maxWidth: "90%",
                  backgroundColor: msg.role === "user" ? COLORS.accent : COLORS.bg,
                  borderRadius: 12,
                  padding: 10,
                  borderWidth: msg.role === "user" ? 0 : 1,
                  borderColor: msg.action === "rejected" ? "#fca5a5" : COLORS.border,
                }}>
                  <Text style={{ fontSize: 13, color: msg.role === "user" ? "#fff" : COLORS.text, lineHeight: 19 }}>{msg.content}</Text>
                  {(msg.action === "propose") && msg.proposedSections && (
                    <View style={{ marginTop: 6, gap: 4 }}>
                      {msg.proposedSections.map((sec) => {
                        const original = scriptSections.find((s) => s.index === sec.index);
                        return (
                          <View key={sec.index} style={{ borderWidth: 1, borderColor: "#d1fae5", borderRadius: 8, overflow: "hidden" }}>
                            <View style={{ backgroundColor: "#ecfdf5", paddingHorizontal: 10, paddingVertical: 5 }}>
                              <Text style={{ fontWeight: "700", fontSize: 11, color: "#065f46" }}>{sec.label} · {sec.timing.start_s}–{sec.timing.end_s}s</Text>
                            </View>
                            <View style={{ padding: 8, gap: 4 }}>
                              {original && <Text style={{ fontSize: 11, color: "#9CA3AF", textDecorationLine: "line-through" }} numberOfLines={2}>{original.plain_text}</Text>}
                              <InlineCuedText text={sec.text} fontSize={12} />
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                  {msg.clarifyingQuestion && msg.action !== "propose" && (
                    <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 5, fontStyle: "italic" }}>{msg.clarifyingQuestion}</Text>
                  )}
                </View>
                {i === messages.length - 1 && pendingApply && msg.action === "propose" && (
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    <Pressable onPress={onApply} disabled={applying} style={{ backgroundColor: "#065f46", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, opacity: applying ? 0.5 : 1 }}>
                      {applying ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>Apply (→ v{(today?.script_version ?? 0) + 1})</Text>}
                    </Pressable>
                    <Pressable onPress={() => sendMessage("Try a different version of this change.")} disabled={thinking} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, opacity: thinking ? 0.5 : 1 }}>
                      <Text style={{ color: COLORS.text, fontSize: 12, fontWeight: "600" }}>Try again</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
            {thinking && (
              <View style={{ alignItems: "flex-start" }}>
                <View style={{ backgroundColor: COLORS.bg, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: COLORS.border }}>
                  <ActivityIndicator color={COLORS.accent} size="small" />
                </View>
              </View>
            )}
          </ScrollView>

          {/* Input */}
          <View style={{ flexDirection: "row", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.card }}>
            <TextInput
              style={{ flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: COLORS.text, backgroundColor: COLORS.bg, minHeight: 38, maxHeight: 80 }}
              value={input}
              onChangeText={setInput}
              placeholder={`Edit the ${section.label.toLowerCase()} section…`}
              placeholderTextColor={COLORS.muted}
              multiline
              onSubmitEditing={() => sendMessage(input)}
            />
            <Pressable
              onPress={() => sendMessage(input)}
              disabled={thinking || !input.trim()}
              style={{ backgroundColor: COLORS.accent, borderRadius: 10, paddingHorizontal: 12, justifyContent: "center", opacity: (thinking || !input.trim()) ? 0.4 : 1 }}>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Send</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ScriptDirectorModal({
  visible,
  onClose,
  scriptSections,
  today,
  target,
  onApplied,
  onOpenTeleprompter,
}: {
  visible: boolean;
  onClose: () => void;
  scriptSections: ScriptSectionV2[];
  today: TodayResponse | null;
  target: string | null;
  onApplied: (version: number, dateIst: string) => void;
  onOpenTeleprompter: () => void;
}) {
  const { width } = useWindowDimensions();
  const styles = useMemo(() => buildStyles(width), [width]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pendingApply, setPendingApply] = useState<{ token: string; sections: ScriptSectionV2[]; indices: number[] } | null>(null);
  const [applying, setApplying] = useState(false);
  const [appliedInfo, setAppliedInfo] = useState<{ version: number; dateIst: string } | null>(null);
  const [undoData, setUndoData] = useState<{ dateIst: string; prevVersion: number } | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const [expandedDiffs, setExpandedDiffs] = useState<Set<number>>(new Set());
  const scrollRef = useRef<ScrollView>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      const version = today?.script_version ?? "?";
      const count = scriptSections.length;
      const openingContent = target
        ? `I have your v${version} script. You've opened the **${target.replace(/_/g, " ")}** section — what would you like to change about it?`
        : `I have your v${version} script (${count} sections). The full script is shown on the left. What would you like to change?`;
      setMessages([{
        role: "assistant",
        content: openingContent,
        action: "reply",
      }]);
      setInput("");
      setPendingApply(null);
      setAppliedInfo(null);
      setUndoVisible(false);
      setExpandedDiffs(new Set());
    }
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, [visible]);

  async function sendMessage(msg: string) {
    const trimmed = msg.trim();
    if (!trimmed || thinking) return;
    setInput("");
    setPendingApply(null);

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(newMessages);
    setThinking(true);

    try {
      const apiHistory = messages.slice(1).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));
      const scope = inferScope(trimmed, null);
      const res: ScriptChatResponse = await chatScript({ message: trimmed, history: apiHistory, scope });

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: res.reply,
        action: res.action,
        proposedSections: res.proposed_sections ?? undefined,
        sectionsChanged: res.sections_changed ?? undefined,
        applyToken: res.apply_token ?? undefined,
        clarifyingQuestion: res.clarifying_question ?? undefined,
      };
      const updated = [...newMessages, assistantMsg];
      setMessages(updated);

      if ((res.action === "propose" || res.action === "redesign") && res.apply_token) {
        setPendingApply({ token: res.apply_token, sections: res.proposed_sections ?? [], indices: res.sections_changed ?? [] });
        setExpandedDiffs(new Set());
      }
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "Something went wrong — please try again.", action: "rejected" }]);
    } finally {
      setThinking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  async function onApply() {
    if (!pendingApply) return;
    setApplying(true);
    try {
      const result = await applyScriptProposal(pendingApply.token);
      const info = { version: result.version, dateIst: result.date_ist };
      setAppliedInfo(info);
      setUndoData({ dateIst: result.date_ist, prevVersion: result.version - 1 });
      setUndoVisible(true);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setUndoVisible(false), 30000);
      setPendingApply(null);
      onApplied(result.version, result.date_ist);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Failed to apply — the proposal may have expired. Try again.", action: "rejected" }]);
    } finally {
      setApplying(false);
    }
  }

  async function onUndo() {
    if (!undoData) return;
    try {
      const result = await revertScript(undoData.dateIst, undoData.prevVersion);
      setAppliedInfo({ version: result.version, dateIst: result.date_ist });
      setUndoVisible(false);
      onApplied(result.version, result.date_ist);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Undo failed — the previous version may not be available.", action: "rejected" }]);
    }
  }

  function onTryAgain() {
    const lastMsg = [...messages].reverse().find((m) => m.role === "assistant");
    const isRedesign = lastMsg?.action === "redesign";
    const tryMsg = isRedesign
      ? "Try again — same direction but write it differently. Use different phrasing, different evidence examples, and a different entry point."
      : "Try a different version of this same change.";
    sendMessage(tryMsg);
  }

  function toggleDiff(idx: number) {
    setExpandedDiffs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function renderDiffCards(msg: ChatMessage) {
    const proposed = msg.proposedSections ?? [];
    const changedIndices = new Set(msg.sectionsChanged ?? proposed.map((s) => s.index));
    const isRedesign = msg.action === "redesign";
    const allExpanded = !isRedesign;

    return (
      <View style={{ marginTop: 8, gap: 6 }}>
        {proposed.map((sec) => {
          const original = scriptSections.find((s) => s.index === sec.index);
          const expanded = allExpanded || expandedDiffs.has(sec.index);
          return (
            <Pressable key={sec.index} onPress={() => isRedesign && toggleDiff(sec.index)}
              style={{ borderWidth: 1, borderColor: "#d1fae5", borderRadius: 10, overflow: "hidden" }}>
              <View style={{ backgroundColor: "#ecfdf5", paddingHorizontal: 10, paddingVertical: 6, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontWeight: "700", fontSize: 12, color: "#065f46" }}>{sec.label} · {sec.timing.start_s}–{sec.timing.end_s}s</Text>
                {isRedesign && <Text style={{ color: "#065f46", fontSize: 11 }}>{expanded ? "▲" : "▼"}</Text>}
              </View>
              {expanded && (
                <View style={{ padding: 10, gap: 6 }}>
                  {original && (
                    <Text style={{ fontSize: 12, color: "#9CA3AF", textDecorationLine: "line-through" }} numberOfLines={2}>
                      {original.plain_text}
                    </Text>
                  )}
                  <InlineCuedText text={sec.text} fontSize={13} />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.card }}>
          <View>
            <Text style={{ fontWeight: "800", fontSize: 16, color: COLORS.text }}>Script Director</Text>
            <Text style={{ fontSize: 11, color: COLORS.muted }}>v{today?.script_version ?? "?"} · {scriptSections.length} sections · {today?.topic.angle?.slice(0, 40) ?? "Today's script"}</Text>
          </View>
          <Pressable onPress={onClose} style={{ padding: 6 }}>
            <Text style={{ fontSize: 20, color: COLORS.muted }}>×</Text>
          </Pressable>
        </View>

        {/* Applied banner */}
        {appliedInfo && (
          <View style={{ backgroundColor: "#d1fae5", paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: "#065f46", fontWeight: "700", fontSize: 13 }}>Saved as v{appliedInfo.version} ✓</Text>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              {undoVisible && undoData && (
                <Pressable onPress={onUndo}>
                  <Text style={{ color: "#b45309", fontWeight: "600", fontSize: 12 }}>Undo</Text>
                </Pressable>
              )}
              <Pressable onPress={() => { onClose(); onOpenTeleprompter(); }} style={{ backgroundColor: "#065f46", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Open Teleprompter →</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Body: split layout on wide screens */}
        <View style={{ flex: 1, flexDirection: width > 800 ? "row" : "column" }}>

        {/* Left: live script panel (wide only) */}
        {width > 800 && (
          <View style={{ width: 340, borderRightWidth: 1, borderRightColor: COLORS.border, backgroundColor: "#fafaf9" }}>
            <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <Text style={{ fontWeight: "700", fontSize: 12, color: COLORS.muted, letterSpacing: 0.5 }}>CURRENT SCRIPT</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: 10, gap: 8 }}>
              {scriptSections.map((sec) => (
                <View key={sec.index} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 10, gap: 5, backgroundColor: COLORS.card }}>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <Text style={{ fontWeight: "800", fontSize: 12, color: COLORS.text }}>{sec.label}</Text>
                    <Text style={{ fontSize: 10, color: COLORS.muted, fontWeight: "600" }}>{sec.timing.start_s}–{sec.timing.end_s}s · {sec.word_count}w</Text>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }}>
                    {sec.cue_summary.map((cue) => (
                      <View key={cue} style={{ borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1, backgroundColor: CUE_COLORS[cue] ?? "#9CA3AF" }}>
                        <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>{cue}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={{ fontSize: 11, color: COLORS.text, lineHeight: 16 }} numberOfLines={4}>{sec.plain_text}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Right: Chat */}
        <View style={{ flex: 1, flexDirection: "column" }}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
          {messages.map((msg, i) => (
            <View key={i} style={{ alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
              <View style={{
                maxWidth: "85%",
                backgroundColor: msg.role === "user" ? COLORS.accent : COLORS.card,
                borderRadius: 14,
                padding: 11,
                borderWidth: msg.role === "user" ? 0 : 1,
                borderColor: msg.action === "rejected" ? "#fca5a5" : COLORS.border,
              }}>
                <Text style={{ fontSize: 14, color: msg.role === "user" ? "#fff" : COLORS.text, lineHeight: 20 }}>{msg.content}</Text>
                {msg.action === "rejected" && (
                  <Text style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>Off-topic — try a script edit request</Text>
                )}
                {(msg.action === "propose" || msg.action === "redesign") && msg.proposedSections && renderDiffCards(msg)}
                {msg.clarifyingQuestion && msg.action !== "propose" && msg.action !== "redesign" && (
                  <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 6, fontStyle: "italic" }}>{msg.clarifyingQuestion}</Text>
                )}
              </View>
              {/* Apply/Try again buttons on the last proposal */}
              {i === messages.length - 1 && pendingApply && (msg.action === "propose" || msg.action === "redesign") && (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <Pressable
                    onPress={onApply}
                    disabled={applying}
                    style={{ backgroundColor: "#065f46", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, opacity: applying ? 0.5 : 1 }}>
                    {applying ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Apply (→ v{(today?.script_version ?? 0) + 1})</Text>}
                  </Pressable>
                  <Pressable onPress={onTryAgain} disabled={thinking} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, opacity: thinking ? 0.5 : 1 }}>
                    <Text style={{ color: COLORS.text, fontSize: 13, fontWeight: "600" }}>Try again</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
          {thinking && (
            <View style={{ alignItems: "flex-start" }}>
              <View style={{ backgroundColor: COLORS.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: COLORS.border }}>
                <ActivityIndicator color={COLORS.accent} size="small" />
              </View>
            </View>
          )}
        </ScrollView>

        {/* Input */}
        <View style={{ flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.card }}>
          <TextInput
            style={{ flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: COLORS.text, backgroundColor: COLORS.bg, minHeight: 40, maxHeight: 100 }}
            value={input}
            onChangeText={setInput}
            placeholder={target ? `Edit the ${target.replace(/_/g, " ")} section…` : "Make the hook more alarming…"}
            placeholderTextColor={COLORS.muted}
            multiline
            onSubmitEditing={() => sendMessage(input)}
          />
          <Pressable
            onPress={() => sendMessage(input)}
            disabled={thinking || !input.trim()}
            style={{ backgroundColor: COLORS.accent, borderRadius: 10, paddingHorizontal: 14, justifyContent: "center", opacity: (thinking || !input.trim()) ? 0.4 : 1 }}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Send</Text>
          </Pressable>
        </View>
        </View>{/* end right chat column */}
        </View>{/* end split row */}
      </SafeAreaView>
    </Modal>
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
  const [regenerating, setRegenerating] = useState(false);
  const [pipelineJob, setPipelineJob] = useState<PipelineStatusOut | null>(null);
  const [triggeringPipeline, setTriggeringPipeline] = useState(false);
  const pipelinePollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [brollTest, setBrollTest] = useState<BRollTestStatusOut | null>(null);
  const [startingBrollTest, setStartingBrollTest] = useState(false);
  const brollPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [promptPreview, setPromptPreview] = useState<{
    date_ist: string;
    visual_bible: Record<string, { name: string; definition: string }>;
    sections: {
      section_index: number; section_name: string; section_label: string;
      narration: string; b_roll_concept: string; total_duration_s: number;
      shots: { moment: string; duration_s: number; prompt: string }[];
    }[];
  } | null>(null);
  const [loadingPromptPreview, setLoadingPromptPreview] = useState(false);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [directorTarget, setDirectorTarget] = useState<string | null>(null);
  const [sectionEditOpen, setSectionEditOpen] = useState(false);
  const [sectionEditSection, setSectionEditSection] = useState<ScriptSectionV2 | null>(null);
  const [veoPreviewSectionIdx, setVeoPreviewSectionIdx] = useState<number | null>(null);
  const [veoPreviewLoading, setVeoPreviewLoading] = useState(false);
  const [veoPreviewResult, setVeoPreviewResult] = useState<{
    section_name: string; section_label: string; narration: string; b_roll_concept: string;
    total_duration_s: number;
    visual_bible: Record<string, { name: string; definition: string }>;
    shots: { moment: string; duration_s: number; prompt: string }[];
  } | null>(null);

  // Topic picker state
  const [topicPickerOpen, setTopicPickerOpen] = useState(false);
  const [topicPickerList, setTopicPickerList] = useState<{ id: string; day_index: number; category: string; topic_angle: string; hook_idea: string }[]>([]);
  const [topicPickerLoading, setTopicPickerLoading] = useState(false);
  const [topicPickerStatus, setTopicPickerStatus] = useState("");

  // Series Creator state
  const [seriesDraft, setSeriesDraft] = useState<SeriesDraft | null>(null);
  const [activeSeries, setActiveSeries] = useState<SeriesDraft | null>(null);
  const [seriesTheme, setSeriesTheme] = useState("");
  const [seriesDayCount, setSeriesDayCount] = useState(10);
  const [seriesGenerating, setSeriesGenerating] = useState(false);
  const [seriesActivating, setSeriesActivating] = useState(false);
  const [seriesMessages, setSeriesMessages] = useState<SeriesChatMessage[]>([]);
  const [seriesInput, setSeriesInput] = useState("");
  const [seriesThinking, setSeriesThinking] = useState(false);
  const [seriesStatus, setSeriesStatus] = useState("");
  const seriesScrollRef = useRef<ScrollView>(null);
  const [episodePlanOpen, setEpisodePlanOpen] = useState(false);
  const [episodePlanItem, setEpisodePlanItem] = useState<SeriesItem | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [teleOpen, setTeleOpen] = useState(false);
  const [teleIndex, setTeleIndex] = useState(0);
  const [teleTextSize, setTeleTextSize] = useState(38);
  const [sectionElapsed, setSectionElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [clipUploading, setClipUploading] = useState(false);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const hasPermissions = (cameraPermission?.granted ?? false) && (micPermission?.granted ?? false);

  async function refreshData() {
    try {
      const [kinds, todayPayload, summaryPayload, assetsPayload] = await Promise.all([
        fetchAssetKinds(),
        fetchToday(),
        fetchStorageSummary(),
        fetchAssets(),
      ]);
      setAssetKinds(kinds);
      if (kinds.length && !kinds.includes(selectedKind)) setSelectedKind(kinds[0]);
      setToday(todayPayload);
      setSummary(summaryPayload);
      setAssets(assetsPayload);

      try {
        const telePayload = await fetchTeleprompter();
        setScriptSections(telePayload.sections || []);
      } catch {
        // teleprompter fetch failed — sections stay empty, rest of app still works
      }

      try {
        const activeSeriesPayload = await getActiveSeries();
        setActiveSeries(activeSeriesPayload);
      } catch {
        // active series fetch is non-critical
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setTodayStatus(`Failed to load: ${message}`);
      setTaskStatus(`Failed to load: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function onRegenerateScript() {
    setRegenerating(true);
    setTaskStatus("Generating new script with AI... (takes ~10s)");
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
    } finally {
      setRegenerating(false);
    }
  }

  async function onDirectorApplied(version: number, _dateIst: string) {
    await refreshData();
    setTaskStatus(`Script updated to v${version} via Script Director.`);
  }

  async function onOpenTopicPicker() {
    setTopicPickerOpen(true);
    setTopicPickerLoading(true);
    setTopicPickerStatus("");
    try {
      const topics = await fetchTopics();
      setTopicPickerList(topics);
    } catch (err) {
      setTopicPickerStatus("Failed to load topics.");
    } finally {
      setTopicPickerLoading(false);
    }
  }

  async function onPickTopic(topicId: string) {
    setTopicPickerStatus("Reassigning topic…");
    try {
      await reassignTodayTopic(topicId);
      setTopicPickerOpen(false);
      setTopicPickerStatus("");
      setTodayStatus("Topic changed — regenerating script…");
      setRegenerating(true);
      try {
        await regenerateScript();
        await refreshData();
        setTodayStatus("New topic and script ready.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setTodayStatus(`Script regen failed: ${msg}`);
      } finally {
        setRegenerating(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setTopicPickerStatus(`Failed: ${msg}`);
    }
  }

  function _startBrollPoller() {
    if (brollPollerRef.current) return;
    brollPollerRef.current = setInterval(async () => {
      try {
        const status = await getBrollTestStatus();
        setBrollTest(status);
        if (status.status === "done" || status.status === "failed") {
          if (brollPollerRef.current) { clearInterval(brollPollerRef.current); brollPollerRef.current = null; }
        }
      } catch { /* ignore */ }
    }, 3000);
  }

  async function onStartBrollTest() {
    setStartingBrollTest(true);
    try {
      const result = await startBrollTest();
      setBrollTest(result);
      if (result.status === "running") _startBrollPoller();
    } catch (e: any) {
      setBrollTest({ status: "failed", date_ist: null, results: [], logs: [`Error: ${e?.message ?? "unknown"}`] });
    } finally {
      setStartingBrollTest(false);
    }
  }

  async function onFetchAllVeoPrompts() {
    setLoadingPromptPreview(true);
    setPromptPreview(null);
    try {
      const result = await fetchAllVeoPrompts();
      setPromptPreview(result);
    } catch (e: any) {
      alert(`Failed to load prompts: ${e?.message ?? "unknown error"}`);
    } finally {
      setLoadingPromptPreview(false);
    }
  }

  async function onPreviewVeoPromptMain() {
    if (veoPreviewSectionIdx === null) return;
    setVeoPreviewLoading(true);
    setVeoPreviewResult(null);
    try {
      const res = await previewVeoPrompt(veoPreviewSectionIdx);
      setVeoPreviewResult(res);
    } catch { /* ignore */ } finally {
      setVeoPreviewLoading(false);
    }
  }

  function _startPipelinePoller() {
    if (pipelinePollerRef.current) return;
    pipelinePollerRef.current = setInterval(async () => {
      try {
        const status = await getPipelineStatus();
        setPipelineJob(status);
        if (status.status === "done" || status.status === "failed") {
          if (pipelinePollerRef.current) { clearInterval(pipelinePollerRef.current); pipelinePollerRef.current = null; }
        }
      } catch { /* ignore poll errors */ }
    }, 3000);
  }

  async function onTriggerPipeline() {
    setTriggeringPipeline(true);
    try {
      const result = await triggerPipeline();
      setPipelineJob({ date_ist: result.date_ist, status: result.status, progress: result.progress, output_path: result.output_path });
      if (result.status === "running") _startPipelinePoller();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setPipelineJob({ date_ist: "", status: "failed", progress: msg, output_path: null });
    } finally {
      setTriggeringPipeline(false);
    }
  }

  function startSectionTimer(durationSec: number) {
    if (timerRef.current) clearInterval(timerRef.current);
    setSectionElapsed(0);
    timerRef.current = setInterval(() => {
      setSectionElapsed((prev) => {
        if (prev >= durationSec) { if (timerRef.current) clearInterval(timerRef.current); return durationSec; }
        return prev + 0.5;
      });
    }, 500);
  }

  function stopSectionTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function onOpenTeleprompter() {
    if (scriptSections.length === 0) { setTodayStatus("Script not loaded yet."); return; }
    try {
      setTeleIndex(0);
      setTeleOpen(true);
      startSectionTimer(scriptSections[0].timing.end_s - scriptSections[0].timing.start_s);
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
      startSectionTimer(scriptSections[nextIndex].timing.end_s - scriptSections[nextIndex].timing.start_s);
      return;
    }
    stopSectionTimer();
    try {
      await updateSessionStatus("uploaded");
      setTeleOpen(false);
      setTodayStatus("All sections done. Starting video pipeline…");
      try {
        const pipelineResult = await triggerPipeline();
        setPipelineJob({ date_ist: pipelineResult.date_ist, status: pipelineResult.status, progress: pipelineResult.progress, output_path: pipelineResult.output_path });
        if (pipelineResult.status === "running") _startPipelinePoller();
        setTodayStatus("Recording uploaded. Pipeline running — check Tasks tab for progress.");
      } catch { setTodayStatus("Session uploaded. Pipeline trigger failed — check Tasks tab."); }
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setTaskStatus(`Status update failed: ${message}`);
    }
  }

  async function onPressRecord() {
    if (!cameraPermission?.granted) { const r = await requestCameraPermission(); if (!r.granted) return; }
    if (!micPermission?.granted) { const r = await requestMicPermission(); if (!r.granted) return; }
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
        await uploadAsset({ fileUri: result.uri, fileName: `section_${teleIndex}.mp4`, mimeType: "video/mp4", kind: "a_roll", topic: today?.topic.angle ?? undefined, sectionIndex: teleIndex });
      } finally { setClipUploading(false); }
    }
    await onNextTeleSection();
  }

  async function onPickAndUpload() {
    if (!selectedKind) { setUploadStatus("Select an upload kind first."); return; }
    setUploadStatus("Selecting file...");
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, type: "*/*", copyToCacheDirectory: true });
    if (result.canceled) { setUploadStatus("Upload cancelled."); return; }
    const file = result.assets[0];
    if (!file) { setUploadStatus("No file selected."); return; }
    setUploadStatus("Uploading...");
    try {
      await uploadAsset({ fileUri: file.uri, fileName: file.name || "upload.bin", mimeType: file.mimeType || "application/octet-stream", kind: selectedKind, topic: topicInput.trim() || undefined, recordingDate: recordingDateInput.trim() || undefined });
      setUploadStatus("Upload complete.");
      setTopicInput(""); setRecordingDateInput("");
      await refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setUploadStatus(`Upload failed: ${message}`);
    }
  }

  async function onDeleteAsset(assetId: string) {
    let proceed = true;
    if (Platform.OS === "web") { const confirmFn = globalThis.confirm; proceed = typeof confirmFn === "function" ? confirmFn("Delete this asset?") : true; }
    if (!proceed) return;
    try { await deleteAsset(assetId); await refreshData(); } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setUploadStatus(`Delete failed: ${message}`);
    }
  }

  function filteredAssets(): AssetOut[] {
    if (!assetFilter) return assets;
    return assets.filter((a) => a.kind === assetFilter);
  }

  function availableFilters(): string[] {
    const set = new Set<string>();
    assets.forEach((a) => set.add(a.kind));
    return Array.from(set).sort();
  }

  // ── Series helpers ────────────────────────────────────────────────────────

  async function onGenerateSeries() {
    if (!seriesTheme.trim()) return;
    setSeriesGenerating(true);
    setSeriesStatus("");
    try {
      const draft = await generateSeries(seriesTheme.trim(), seriesDayCount);
      setSeriesDraft(draft);
      setSeriesMessages([{
        role: "assistant",
        content: `I've planned a ${draft.day_count}-day series on **${draft.name}**. The episodes are shown on the left — ask me to swap any episode, adjust the tone, or make changes.`,
        action: "reply",
      }]);
      setSeriesInput("");
    } catch (err) {
      setSeriesStatus(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setSeriesGenerating(false);
    }
  }

  async function onSeriesChat() {
    if (!seriesDraft || !seriesInput.trim() || seriesThinking) return;
    const trimmed = seriesInput.trim();
    setSeriesInput("");
    const newMessages: SeriesChatMessage[] = [...seriesMessages, { role: "user", content: trimmed }];
    setSeriesMessages(newMessages);
    setSeriesThinking(true);
    try {
      const apiHistory = seriesMessages.slice(1).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      const res: SeriesChatResponse = await chatSeries({ seriesId: seriesDraft.id, message: trimmed, history: apiHistory });
      const assistantMsg: SeriesChatMessage = {
        role: "assistant",
        content: res.reply,
        action: res.action,
        episodes: res.episodes ?? undefined,
        episodesChanged: res.episodes_changed ?? undefined,
        clarifyingQuestion: res.clarifying_question ?? undefined,
      };
      setSeriesMessages([...newMessages, assistantMsg]);
      if (res.action === "update" && res.episodes) {
        setSeriesDraft((prev) => prev ? { ...prev, items: res.episodes! } : prev);
      }
    } catch {
      setSeriesMessages([...newMessages, { role: "assistant", content: "Something went wrong — please try again.", action: "rejected" }]);
    } finally {
      setSeriesThinking(false);
      setTimeout(() => seriesScrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  function onEpisodeItemUpdated(dayOffset: number, angle: string, hook: string) {
    setSeriesDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((it) =>
          it.day_offset === dayOffset ? { ...it, topic_angle: angle, hook_idea: hook } : it
        ),
      };
    });
    // Keep episodePlanItem in sync so the popup re-renders with updated values
    setEpisodePlanItem((prev) => prev && prev.day_offset === dayOffset ? { ...prev, topic_angle: angle, hook_idea: hook } : prev);
  }

  function onEpisodeScriptGenerated(dayOffset: number, scriptJson: string) {
    setSeriesDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, items: prev.items.map((it) => it.day_offset === dayOffset ? { ...it, script_draft: scriptJson } : it) };
    });
    setEpisodePlanItem((prev) => prev && prev.day_offset === dayOffset ? { ...prev, script_draft: scriptJson } : prev);
  }

  function onEpisodePlanSaved(updatedDraft: SeriesDraft) {
    setSeriesDraft(updatedDraft);
    // Sync the open popup item with updated plan_notes from the fresh draft
    if (episodePlanItem) {
      const freshItem = updatedDraft.items.find((it) => it.day_offset === episodePlanItem.day_offset);
      if (freshItem) setEpisodePlanItem(freshItem);
    }
  }

  async function onActivateSeries() {
    if (!seriesDraft) return;
    setSeriesActivating(true);
    try {
      const activated = await activateSeries(seriesDraft.id);
      setActiveSeries(activated);
      setSeriesDraft(null);
      setSeriesMessages([]);
      setSeriesTheme("");
      setSeriesStatus(`Series "${activated.name}" activated! Starting tomorrow for ${activated.day_count} days.`);
    } catch (err) {
      setSeriesStatus(err instanceof Error ? err.message : "Activation failed.");
    } finally {
      setSeriesActivating(false);
    }
  }

  function renderSeriesTab() {
    // ── Active series view ─────────────────────────────────────────────────
    if (!seriesDraft && activeSeries) {
      return (
        <View style={styles.card}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <View style={{ backgroundColor: "#d1fae5", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: "#065f46", fontSize: 10, fontWeight: "800" }}>ACTIVE</Text>
            </View>
            <Text style={{ fontWeight: "800", fontSize: 16, color: COLORS.text }}>{activeSeries.name}</Text>
          </View>
          <Text style={{ fontSize: 12, color: COLORS.muted, marginBottom: 12 }}>{activeSeries.day_count} episodes · starting tomorrow</Text>
          {activeSeries.items.map((item) => (
            <View key={item.day_offset} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 10, marginBottom: 8, gap: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{item.day_offset}</Text>
                </View>
                <Text style={{ fontWeight: "700", fontSize: 13, color: COLORS.text, flex: 1 }}>{item.sub_topic}</Text>
                <View style={{ backgroundColor: COLORS.bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 10, color: COLORS.muted, fontWeight: "600" }}>{item.category}</Text>
                </View>
              </View>
              <Text style={{ fontSize: 12, color: COLORS.muted, marginLeft: 32 }} numberOfLines={2}>{item.topic_angle}</Text>
            </View>
          ))}
          <Pressable
            style={[styles.secondaryBtn, { marginTop: 4 }]}
            onPress={() => { setSeriesDraft(null); setSeriesMessages([]); setSeriesTheme(""); setActiveSeries(null); }}
          >
            <Text style={styles.secondaryBtnText}>Plan New Series</Text>
          </Pressable>
          {seriesStatus ? <Text style={styles.status}>{seriesStatus}</Text> : null}
        </View>
      );
    }

    // ── Draft planning view (split layout on wide screens) ──────────────────
    if (seriesDraft) {
      return (
        <View style={{ flex: 1, flexDirection: width > 800 ? "row" : "column", gap: 0 }}>
          {/* Left: episode list */}
          <View style={{ width: width > 800 ? 360 : "100%", borderRightWidth: width > 800 ? 1 : 0, borderRightColor: COLORS.border, backgroundColor: "#fafaf9" }}>
            <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View>
                <Text style={{ fontWeight: "800", fontSize: 14, color: COLORS.text }}>{seriesDraft.name}</Text>
                <Text style={{ fontSize: 11, color: COLORS.muted }}>{seriesDraft.day_count} episodes · draft</Text>
              </View>
              <Pressable onPress={() => { setSeriesDraft(null); setSeriesMessages([]); }}>
                <Text style={{ fontSize: 12, color: COLORS.muted }}>✕ Start over</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 10, gap: 8 }}>
              {seriesDraft.items.map((item) => {
                let hookPreview: string | null = null;
                if (item.plan_notes) {
                  try { hookPreview = (JSON.parse(item.plan_notes) as { hook?: string }).hook ?? null; } catch { /* ignore */ }
                }
                return (
                  <Pressable
                    key={item.day_offset}
                    onPress={() => { setEpisodePlanItem(item); setEpisodePlanOpen(true); }}
                    style={{ borderWidth: 1, borderColor: item.plan_notes ? "#bbf7d0" : COLORS.border, borderRadius: 10, padding: 10, backgroundColor: item.plan_notes ? "#f0fdf4" : COLORS.card, gap: 4 }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: item.plan_notes ? "#16a34a" : COLORS.accent, alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{item.plan_notes ? "✓" : item.day_offset}</Text>
                      </View>
                      <Text style={{ fontWeight: "700", fontSize: 12, color: COLORS.text, flex: 1 }}>{item.sub_topic}</Text>
                      <Text style={{ fontSize: 10, color: COLORS.muted }}>{item.category}</Text>
                    </View>
                    <Text style={{ fontSize: 11, color: COLORS.muted, marginLeft: 30 }} numberOfLines={2}>{item.topic_angle}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", marginLeft: 30, gap: 8 }}>
                      {hookPreview
                        ? <Text style={{ fontSize: 10, color: "#166534", fontStyle: "italic", flex: 1 }} numberOfLines={1}>"{hookPreview}"</Text>
                        : <Text style={{ fontSize: 10, color: "#b45309", fontStyle: "italic" }} numberOfLines={1}>Tap to plan →</Text>}
                      {item.script_draft && (
                        <View style={{ backgroundColor: "#dbeafe", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                          <Text style={{ fontSize: 9, color: "#1d4ed8", fontWeight: "700" }}>📝 SCRIPT</Text>
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={onActivateSeries}
                disabled={seriesActivating}
                style={{ backgroundColor: "#065f46", borderRadius: 10, padding: 12, alignItems: "center", marginTop: 4, opacity: seriesActivating ? 0.5 : 1 }}
              >
                {seriesActivating
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>Activate Series (starts tomorrow)</Text>}
              </Pressable>
            </ScrollView>
          </View>

          {/* Right: chat */}
          <View style={{ flex: 1, flexDirection: "column" }}>
            <ScrollView ref={seriesScrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }} onContentSizeChange={() => seriesScrollRef.current?.scrollToEnd({ animated: false })}>
              {seriesMessages.map((msg, i) => (
                <View key={i} style={{ alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <View style={{
                    maxWidth: "85%",
                    backgroundColor: msg.role === "user" ? COLORS.accent : COLORS.card,
                    borderRadius: 14, padding: 11,
                    borderWidth: msg.role === "user" ? 0 : 1,
                    borderColor: msg.action === "rejected" ? "#fca5a5" : COLORS.border,
                  }}>
                    <Text style={{ fontSize: 14, color: msg.role === "user" ? "#fff" : COLORS.text, lineHeight: 20 }}>{msg.content}</Text>
                    {msg.action === "rejected" && <Text style={{ fontSize: 11, color: "#ef4444", marginTop: 4 }}>Off-topic — I can only help plan this series.</Text>}
                    {msg.episodesChanged && msg.action === "update" && (
                      <View style={{ marginTop: 6 }}>
                        <Text style={{ fontSize: 11, color: "#065f46", fontWeight: "700" }}>
                          Updated: Day{msg.episodesChanged.length > 1 ? "s" : ""} {msg.episodesChanged.join(", ")}
                        </Text>
                      </View>
                    )}
                    {msg.clarifyingQuestion && <Text style={{ fontSize: 13, color: COLORS.muted, marginTop: 6, fontStyle: "italic" }}>{msg.clarifyingQuestion}</Text>}
                  </View>
                </View>
              ))}
              {seriesThinking && (
                <View style={{ alignItems: "flex-start" }}>
                  <View style={{ backgroundColor: COLORS.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: COLORS.border }}>
                    <ActivityIndicator color={COLORS.accent} size="small" />
                  </View>
                </View>
              )}
            </ScrollView>
            <View style={{ flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.card }}>
              <TextInput
                style={{ flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: COLORS.text, backgroundColor: COLORS.bg, minHeight: 40, maxHeight: 100 }}
                value={seriesInput}
                onChangeText={setSeriesInput}
                placeholder="Replace day 4 with Amul, swap days 2 and 6…"
                placeholderTextColor={COLORS.muted}
                multiline
                onSubmitEditing={onSeriesChat}
              />
              <Pressable
                onPress={onSeriesChat}
                disabled={seriesThinking || !seriesInput.trim()}
                style={{ backgroundColor: COLORS.accent, borderRadius: 10, paddingHorizontal: 14, justifyContent: "center", opacity: (seriesThinking || !seriesInput.trim()) ? 0.4 : 1 }}>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Send</Text>
              </Pressable>
            </View>
          </View>
        </View>
      );
    }

    // ── Theme entry (no draft yet) ──────────────────────────────────────────
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Series Creator</Text>
        <Text style={styles.subtitle}>Plan your next 10 days of content around a master theme. Gemini will research the topic and generate daily episode ideas — you refine via chat before activating.</Text>
        <TextInput
          style={[styles.input, { marginTop: 12 }]}
          value={seriesTheme}
          onChangeText={setSeriesTheme}
          placeholder="Master theme — e.g. Iconic Indian Brands, Red Sea Crisis, Indian Startups That Failed"
          placeholderTextColor={COLORS.muted}
          multiline
        />
        <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 8, marginBottom: 4 }}>Number of days</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {[5, 7, 10, 14].map((n) => (
            <Pressable
              key={n}
              onPress={() => setSeriesDayCount(n)}
              style={{ borderWidth: 1, borderColor: seriesDayCount === n ? COLORS.accent : COLORS.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: seriesDayCount === n ? "#fff3eb" : COLORS.card }}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: seriesDayCount === n ? COLORS.accent : COLORS.muted }}>{n} days</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={[styles.primaryBtn, { marginTop: 16, opacity: (seriesGenerating || !seriesTheme.trim()) ? 0.5 : 1 }]}
          onPress={onGenerateSeries}
          disabled={seriesGenerating || !seriesTheme.trim()}
        >
          {seriesGenerating
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.primaryBtnText}>Generate Series with AI</Text>}
        </Pressable>
        {seriesStatus ? <Text style={styles.status}>{seriesStatus}</Text> : null}
      </View>
    );
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
          {today && (
            <View style={styles.topicCard}>
              {today.series_context && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <View style={{ backgroundColor: COLORS.accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 }}>SERIES</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: COLORS.muted, fontWeight: "600" }}>
                    Day {today.series_context.day} of {today.series_context.total} · {today.series_context.name}
                  </Text>
                </View>
              )}
              <Text style={styles.topicCategory}>{today.topic.category.replace(/_/g, " ")}</Text>
              <Text style={styles.topicAngle}>{today.topic.angle}</Text>
              {today.topic.hook_idea ? <Text style={styles.topicHook}>{today.topic.hook_idea}</Text> : null}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                <Text style={styles.topicMeta}>{today.overview.title} · {today.overview.duration_sec}s · Script v{today.script_version}</Text>
                <Pressable
                  onPress={onOpenTopicPicker}
                  style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#ffe4cc", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}
                >
                  <Text style={{ color: COLORS.accent, fontSize: 12, fontWeight: "700" }}>Change Topic</Text>
                </Pressable>
              </View>
            </View>
          )}
          <View style={styles.card}>
            <Text style={styles.previewLabel}>Script Preview</Text>
            {scriptSections.length > 0 ? (
              scriptSections.map((section) => (
                <Pressable
                  key={section.index}
                  onPress={() => { setSectionEditSection(section); setSectionEditOpen(true); }}
                  style={{ position: "relative" }}
                >
                  <SectionPreviewCard section={section} styles={styles} />
                  <View style={{ position: "absolute", top: 8, right: 8, backgroundColor: COLORS.accent, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>Edit</Text>
                  </View>
                </Pressable>
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
      const pipelineRunning = pipelineJob?.status === "running";
      const pipelineDone = pipelineJob?.status === "done";
      const pipelineFailed = pipelineJob?.status === "failed";
      const downloadUrl = getPipelineDownloadUrl();

      return (
        <View style={{ gap: 12 }}>
          {/* Script controls */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Task Controls</Text>
            <Text style={styles.subtitle}>Extra actions are kept here to keep Today minimal.</Text>
            <Pressable
              style={[styles.secondaryBtn, { marginTop: 12, opacity: regenerating ? 0.5 : 1 }]}
              onPress={onRegenerateScript}
              disabled={regenerating}
            >
              {regenerating
                ? <ActivityIndicator color="#8a4e1e" size="small" />
                : <Text style={styles.secondaryBtnText}>Regenerate Script</Text>}
            </Pressable>
            <Text style={styles.status}>{taskStatus}</Text>
            <View style={{ height: 1, backgroundColor: COLORS.border, marginVertical: 12 }} />
            <Text style={{ fontWeight: "700", fontSize: 13, color: COLORS.text, marginBottom: 4 }}>Script Director</Text>
            <Text style={{ fontSize: 12, color: COLORS.muted, marginBottom: 8 }}>Chat with AI to edit specific sections, reorder, add data, or redesign the whole script.</Text>
            <Pressable
              style={[styles.primaryBtn, { opacity: scriptSections.length === 0 ? 0.4 : 1 }]}
              onPress={() => setDirectorOpen(true)}
              disabled={scriptSections.length === 0}
            >
              <Text style={styles.primaryBtnText}>Open Script Director</Text>
            </Pressable>
          </View>

          {/* Video editing pipeline */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Video Pipeline</Text>
            <Text style={styles.subtitle}>
              Upload your a-roll recording + b-roll clips (Assets tab), then run the pipeline to assemble the final Short.
            </Text>

            {/* Step stepper */}
            {(() => {
              const STEPS = [
                { key: "assets",    icon: "📂", label: "Assets" },
                { key: "whisper",   icon: "🎙", label: "Whisper" },
                { key: "newspaper", icon: "📰", label: "Newspaper" },
                { key: "ffmpeg",    icon: "🎬", label: "FFmpeg" },
              ];
              const currentStep = pipelineJob?.step ?? null;
              const stepIdx = STEPS.findIndex(s => s.key === currentStep);
              return (
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, marginBottom: 14 }}>
                  {STEPS.map((s, i) => {
                    const done = pipelineDone || (stepIdx > i);
                    const active = stepIdx === i && pipelineRunning;
                    const failed = pipelineFailed && stepIdx === i;
                    const dotColor = failed ? "#dc2626" : done ? "#166534" : active ? "#1d4ed8" : COLORS.border;
                    const textColor = failed ? "#dc2626" : done ? "#166534" : active ? "#1d4ed8" : COLORS.muted;
                    return (
                      <View key={s.key} style={{ flex: 1, alignItems: "center" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", width: "100%" }}>
                          {i > 0 && <View style={{ flex: 1, height: 2, backgroundColor: done || (stepIdx >= i) ? "#166534" : COLORS.border }} />}
                          <View style={{
                            width: 28, height: 28, borderRadius: 14,
                            backgroundColor: dotColor,
                            alignItems: "center", justifyContent: "center",
                            borderWidth: active ? 2 : 0,
                            borderColor: "#93c5fd",
                          }}>
                            {active
                              ? <ActivityIndicator size="small" color="#fff" />
                              : <Text style={{ fontSize: 12 }}>{done ? "✓" : failed ? "✗" : s.icon}</Text>}
                          </View>
                          {i < STEPS.length - 1 && <View style={{ flex: 1, height: 2, backgroundColor: done ? "#166534" : COLORS.border }} />}
                        </View>
                        <Text style={{ fontSize: 9, color: textColor, marginTop: 4, fontWeight: active ? "700" : "400" }}>{s.label}</Text>
                      </View>
                    );
                  })}
                </View>
              );
            })()}

            {/* Status + current message */}
            {pipelineJob && (
              <View style={{
                borderRadius: 8, padding: 10, marginBottom: 10,
                backgroundColor: pipelineDone ? "#f0fdf4" : pipelineFailed ? "#fef2f2" : "#eff6ff",
                borderWidth: 1,
                borderColor: pipelineDone ? "#bbf7d0" : pipelineFailed ? "#fecaca" : "#dbeafe",
              }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: pipelineDone ? "#166534" : pipelineFailed ? "#dc2626" : "#1d4ed8" }}>
                    {pipelineDone ? "✓ DONE" : pipelineFailed ? "✗ FAILED" : "⟳ RUNNING"}
                  </Text>
                </View>
                <Text style={{ fontSize: 11, color: pipelineFailed ? "#dc2626" : COLORS.muted, marginTop: 3, lineHeight: 16 }}>
                  {pipelineJob.progress}
                </Text>

                {/* FFmpeg progress bar */}
                {pipelineRunning && pipelineJob.step === "ffmpeg" && typeof pipelineJob.ffmpeg_pct === "number" && (
                  <View style={{ marginTop: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                      <Text style={{ fontSize: 10, color: COLORS.muted }}>FFmpeg</Text>
                      <Text style={{ fontSize: 10, color: "#1d4ed8", fontWeight: "700" }}>{Math.round(pipelineJob.ffmpeg_pct * 100)}%</Text>
                    </View>
                    <View style={{ height: 6, backgroundColor: "#dbeafe", borderRadius: 3, overflow: "hidden" }}>
                      <View style={{ height: 6, width: `${Math.round(pipelineJob.ffmpeg_pct * 100)}%` as any, backgroundColor: "#1d4ed8", borderRadius: 3 }} />
                    </View>
                  </View>
                )}

                {/* Live log list */}
                {(pipelineJob.logs ?? []).length > 0 && (
                  <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: pipelineDone ? "#bbf7d0" : pipelineFailed ? "#fecaca" : "#dbeafe", paddingTop: 8 }}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: COLORS.muted, marginBottom: 4 }}>LOG</Text>
                    {(pipelineJob.logs ?? []).slice(-12).map((line, i) => (
                      <Text key={i} style={{ fontSize: 10, color: COLORS.muted, fontFamily: "monospace", lineHeight: 15 }}>{line}</Text>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Trigger button */}
            {!pipelineRunning && !pipelineDone && (
              <Pressable
                style={{ backgroundColor: "#1d4ed8", borderRadius: 10, paddingVertical: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: triggeringPipeline ? 0.6 : 1 }}
                onPress={onTriggerPipeline}
                disabled={triggeringPipeline}
              >
                {triggeringPipeline ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 16 }}>🎬</Text>}
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>
                  {triggeringPipeline ? "Starting…" : "Run Video Pipeline"}
                </Text>
              </Pressable>
            )}

            {/* Re-run button when done/failed */}
            {(pipelineDone || pipelineFailed) && (
              <Pressable
                style={{ backgroundColor: pipelineFailed ? "#dc2626" : "#374151", borderRadius: 10, paddingVertical: 11, alignItems: "center", marginTop: 6, opacity: triggeringPipeline ? 0.5 : 1 }}
                onPress={onTriggerPipeline}
                disabled={triggeringPipeline}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
                  {pipelineFailed ? "Retry Pipeline" : "Re-run Pipeline"}
                </Text>
              </Pressable>
            )}

            {/* Download button when output ready */}
            {pipelineDone && pipelineJob?.output_path && (
              <Pressable
                style={{ backgroundColor: "#166534", borderRadius: 10, paddingVertical: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 8 }}
                onPress={() => {
                  const { Linking } = require("react-native");
                  Linking.openURL(downloadUrl);
                }}
              >
                <Text style={{ fontSize: 16 }}>⬇️</Text>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>Download Final Edit</Text>
              </Pressable>
            )}
          </View>

          {/* Veo Prompt Preview card */}
          {(() => {
            const brollSections = scriptSections;
            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Veo Shot Plan Preview</Text>
                <Text style={styles.subtitle}>Gemini reads the narration and writes 2–3 individually directed Veo prompts. Each becomes a separate clip; FFmpeg stitches them.</Text>
                {brollSections.length === 0 ? (
                  <Text style={{ fontSize: 12, color: COLORS.muted, marginTop: 8 }}>No sections in today's script. Generate a script first.</Text>
                ) : (
                  <View style={{ gap: 10, marginTop: 10 }}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {brollSections.map((s: any) => {
                        const active = veoPreviewSectionIdx === s.index;
                        return (
                          <Pressable
                            key={s.index}
                            onPress={() => { setVeoPreviewSectionIdx(s.index); setVeoPreviewResult(null); }}
                            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: active ? "#7c3aed" : "#f3f0ff", borderWidth: 1, borderColor: active ? "#7c3aed" : "#ddd6fe" }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: "700", color: active ? "#fff" : "#7c3aed" }}>
                              §{s.index} {s.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {veoPreviewSectionIdx !== null && (
                      <Pressable
                        onPress={onPreviewVeoPromptMain}
                        disabled={veoPreviewLoading}
                        style={{ backgroundColor: "#7c3aed", borderRadius: 10, paddingVertical: 11, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: veoPreviewLoading ? 0.6 : 1 }}
                      >
                        {veoPreviewLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 14 }}>✨</Text>}
                        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>
                          {veoPreviewLoading ? "Building shot plan…" : "Generate Shot Plan"}
                        </Text>
                      </Pressable>
                    )}
                    {veoPreviewResult && (
                      <View style={{ gap: 10 }}>
                        {/* Narration strip */}
                        <View style={{ backgroundColor: "#f3f0ff", borderRadius: 8, padding: 10 }}>
                          <Text style={{ fontSize: 10, color: "#7c3aed", fontWeight: "700", marginBottom: 3, letterSpacing: 0.5 }}>NARRATION USED</Text>
                          <Text style={{ fontSize: 11, color: "#4c1d95", lineHeight: 16 }}>{veoPreviewResult.narration}</Text>
                        </View>
                        {/* Visual Bible */}
                        {veoPreviewResult.visual_bible && Object.keys(veoPreviewResult.visual_bible).length > 0 && (
                          <View style={{ backgroundColor: "#0f172a", borderRadius: 10, overflow: "hidden" }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#1e3a5f" }}>
                              <Text style={{ fontSize: 10, fontWeight: "800", color: "#93c5fd", letterSpacing: 0.8, textTransform: "uppercase" }}>
                                Visual Entity Bible
                              </Text>
                              <View style={{ backgroundColor: "#1d4ed8", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 10, color: "#fff", fontWeight: "700" }}>
                                  {Object.keys(veoPreviewResult.visual_bible).length} entities
                                </Text>
                              </View>
                            </View>
                            <View style={{ padding: 12, gap: 8 }}>
                              <Text style={{ fontSize: 10, color: "#64748b", lineHeight: 14, marginBottom: 2 }}>
                                Canonical descriptions injected into every shot prompt for visual consistency across clips.
                              </Text>
                              {Object.values(veoPreviewResult.visual_bible).map((entity, i) => (
                                <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: "#1d4ed8", paddingLeft: 8 }}>
                                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#93c5fd", marginBottom: 2 }}>{entity.name}</Text>
                                  <Text style={{ fontSize: 10, color: "#94a3b8", lineHeight: 15 }}>{entity.definition}</Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        )}
                        {/* Shot plan header */}
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <Text style={{ fontSize: 11, fontWeight: "800", color: COLORS.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>
                            Shot Plan
                          </Text>
                          <View style={{ backgroundColor: "#7c3aed", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ fontSize: 10, color: "#fff", fontWeight: "700" }}>
                              {veoPreviewResult.shots.length} clips · {veoPreviewResult.shots.reduce((acc, s) => acc + s.duration_s, 0)}s total
                            </Text>
                          </View>
                        </View>
                        {/* Individual shot cards */}
                        {veoPreviewResult.shots.map((shot, i) => (
                          <View key={i} style={{ backgroundColor: "#1e1035", borderRadius: 10, overflow: "hidden" }}>
                            {/* Shot header */}
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#2d1b69" }}>
                              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" }}>
                                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{i + 1}</Text>
                              </View>
                              <Text style={{ flex: 1, fontSize: 12, fontWeight: "700", color: "#e9d5ff" }}>{shot.moment}</Text>
                              <View style={{ backgroundColor: "#7c3aed", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 10, color: "#fff", fontWeight: "700" }}>{shot.duration_s}s</Text>
                              </View>
                            </View>
                            {/* Prompt body */}
                            <View style={{ padding: 12 }}>
                              <Text style={{ fontSize: 11, color: "#c4b5fd", lineHeight: 18 }}>{shot.prompt}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })()}

          {/* B-Roll Test card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>AI B-Roll Test</Text>
            <Text style={styles.subtitle}>
              Uses Gemini to craft a detailed cinematic prompt, then generates a real 8-second vertical video with Veo 2. FFmpeg normalizes it to 1080×1920 for the pipeline. Validate before running the full pipeline.
            </Text>

            {brollTest && (
              <View style={{
                borderRadius: 8, padding: 10, marginTop: 10, marginBottom: 8,
                backgroundColor: brollTest.status === "done" ? "#f0fdf4" : brollTest.status === "failed" ? "#fef2f2" : "#eff6ff",
                borderWidth: 1,
                borderColor: brollTest.status === "done" ? "#bbf7d0" : brollTest.status === "failed" ? "#fecaca" : "#dbeafe",
              }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: brollTest.status === "done" ? "#166534" : brollTest.status === "failed" ? "#dc2626" : "#1d4ed8", marginBottom: 6 }}>
                  {brollTest.status === "done" ? "✓ DONE" : brollTest.status === "failed" ? "✗ FAILED" : "⟳ RUNNING"}
                </Text>

                {brollTest.results.map((r, i) => (
                  <View key={i} style={{ borderWidth: 1, borderColor: r.success ? "#bbf7d0" : "#fecaca", borderRadius: 8, padding: 8, marginBottom: 6, backgroundColor: r.success ? "#f0fdf4" : "#fef2f2" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <Text style={{ fontSize: 13 }}>{r.success ? "✓" : "✗"}</Text>
                      <Text style={{ fontWeight: "700", fontSize: 12, color: r.success ? "#166534" : "#dc2626" }}>
                        Section {r.section_index} — {r.section_name}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 11, color: "#6b6a77", lineHeight: 15, marginBottom: 2 }} numberOfLines={2}>{r.prompt}</Text>
                    {r.success && r.file_name ? (
                      <Text style={{ fontSize: 10, color: "#166534", fontFamily: "monospace" }}>{r.file_name}</Text>
                    ) : null}
                    {!r.success && r.error ? (
                      <Text style={{ fontSize: 10, color: "#dc2626" }}>{r.error}</Text>
                    ) : null}
                  </View>
                ))}

                {brollTest.logs.length > 0 && (
                  <View style={{ borderTopWidth: 1, borderTopColor: brollTest.status === "done" ? "#bbf7d0" : "#dbeafe", paddingTop: 6, marginTop: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: "#6b6a77", marginBottom: 3 }}>LOG</Text>
                    {brollTest.logs.slice(-10).map((line, i) => (
                      <Text key={i} style={{ fontSize: 10, color: "#6b6a77", fontFamily: "monospace", lineHeight: 14 }}>{line}</Text>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* ── Preview Final Prompts (no Veo cost) ───────────── */}
            <Pressable
              style={{ backgroundColor: "#1e3a5f", borderRadius: 10, paddingVertical: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 8, opacity: loadingPromptPreview ? 0.6 : 1 }}
              onPress={onFetchAllVeoPrompts}
              disabled={loadingPromptPreview}
            >
              {loadingPromptPreview ? <ActivityIndicator color="#93c5fd" size="small" /> : <Text style={{ fontSize: 15 }}>🔍</Text>}
              <Text style={{ color: "#93c5fd", fontWeight: "800", fontSize: 14 }}>
                {loadingPromptPreview ? "Building prompts…" : promptPreview ? "Refresh Prompts Preview" : "Preview Final Prompts"}
              </Text>
              <Text style={{ color: "#64748b", fontSize: 11 }}>no Veo cost</Text>
            </Pressable>

            {promptPreview && (
              <View style={{ marginTop: 12, gap: 12 }}>
                {/* Visual Bible */}
                <View style={{ backgroundColor: "#0f172a", borderRadius: 10, overflow: "hidden" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#1e3a5f" }}>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: "#93c5fd", letterSpacing: 0.8, textTransform: "uppercase" }}>Visual Entity Bible</Text>
                    <View style={{ backgroundColor: "#1d4ed8", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 10, color: "#fff", fontWeight: "700" }}>{Object.keys(promptPreview.visual_bible).length} entities</Text>
                    </View>
                  </View>
                  <View style={{ padding: 12, gap: 8 }}>
                    <Text style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>
                      These definitions are injected into every Veo shot prompt for visual consistency.
                    </Text>
                    {Object.values(promptPreview.visual_bible).map((entity, i) => (
                      <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: "#1d4ed8", paddingLeft: 8 }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#93c5fd", marginBottom: 2 }}>{entity.name}</Text>
                        <Text style={{ fontSize: 10, color: "#94a3b8", lineHeight: 15 }}>{entity.definition}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Shot plans per section */}
                {promptPreview.sections.map((sec) => (
                  <View key={sec.section_index} style={{ backgroundColor: "#0f0a1e", borderRadius: 10, overflow: "hidden" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#2d1b69" }}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: "#e9d5ff", textTransform: "uppercase", letterSpacing: 0.6 }}>{sec.section_label}</Text>
                      <View style={{ backgroundColor: "#7c3aed", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, color: "#fff", fontWeight: "700" }}>{sec.shots.length} shots · {sec.total_duration_s}s</Text>
                      </View>
                    </View>
                    <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
                      <Text style={{ fontSize: 10, color: "#7c3aed", fontWeight: "700", marginBottom: 3, letterSpacing: 0.5 }}>NARRATION</Text>
                      <Text style={{ fontSize: 10, color: "#c4b5fd", lineHeight: 15, marginBottom: 10 }}>{sec.narration}</Text>
                    </View>
                    <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
                      {sec.shots.map((shot, i) => (
                        <View key={i} style={{ backgroundColor: "#1e1035", borderRadius: 8, overflow: "hidden" }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#2d1b69" }}>
                            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" }}>
                              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{i + 1}</Text>
                            </View>
                            <Text style={{ flex: 1, fontSize: 11, fontWeight: "700", color: "#e9d5ff" }}>{shot.moment}</Text>
                            <Text style={{ fontSize: 10, color: "#a78bfa", fontWeight: "700" }}>{shot.duration_s}s</Text>
                          </View>
                          <View style={{ padding: 10 }}>
                            <Text style={{ fontSize: 10, color: "#c4b5fd", lineHeight: 16 }}>{shot.prompt}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* ── Run B-Roll Test (generates real Veo clips) ──── */}
            <Pressable
              style={{ backgroundColor: brollTest?.status === "running" ? "#6b6a77" : "#7c3aed", borderRadius: 10, paddingVertical: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 8, opacity: (startingBrollTest || brollTest?.status === "running") ? 0.6 : 1 }}
              onPress={onStartBrollTest}
              disabled={startingBrollTest || brollTest?.status === "running"}
            >
              {(startingBrollTest || brollTest?.status === "running") ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 16 }}>✨</Text>}
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>
                {brollTest?.status === "running" ? "Generating B-Roll…" : brollTest?.status === "done" ? "Re-run B-Roll Test" : "Run B-Roll Test"}
              </Text>
            </Pressable>
          </View>
        </View>
      );
    }

    if (feature === "series") {
      return renderSeriesTab();
    }

    const filters = availableFilters();
    const list = filteredAssets();

    return (
      <View>
        <View style={[styles.card, { marginBottom: 10 }]}>
          <Text style={styles.cardTitle}>Storage</Text>
          <View style={[styles.summaryRow, { marginTop: 10 }]}>
            <View style={styles.summaryBox}><Text style={styles.summaryLabel}>Total Files</Text><Text style={styles.summaryValue}>{summary?.total_files ?? 0}</Text></View>
            <View style={styles.summaryBox}><Text style={styles.summaryLabel}>Total Size</Text><Text style={styles.summaryValue}>{formatBytes(summary?.total_size_bytes ?? 0)}</Text></View>
          </View>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Upload Asset</Text>
          <Text style={styles.subtitle}>Allowed kinds: a_roll and b_roll_custom.</Text>
          <View style={styles.kindRow}>
            {assetKinds.map((kind) => {
              const active = selectedKind === kind;
              return (
                <Pressable key={kind} style={[styles.kindChip, active && styles.kindChipActive]} onPress={() => setSelectedKind(kind)}>
                  <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>{kind}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.rowWrap}>
            <TextInput style={styles.input} value={topicInput} onChangeText={setTopicInput} placeholder="Topic (optional)" placeholderTextColor={COLORS.muted} />
            <TextInput style={styles.input} value={recordingDateInput} onChangeText={setRecordingDateInput} placeholder="Recording date YYYY-MM-DD" placeholderTextColor={COLORS.muted} />
          </View>
          <Pressable style={styles.primaryBtn} onPress={onPickAndUpload}><Text style={styles.primaryBtnText}>Pick File and Upload</Text></Pressable>
          <Text style={styles.status}>{uploadStatus}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Assets</Text>
          <View style={styles.kindRow}>
            <Pressable style={[styles.kindChip, !assetFilter && styles.kindChipActive]} onPress={() => setAssetFilter("")}>
              <Text style={[styles.kindChipText, !assetFilter && styles.kindChipTextActive]}>all</Text>
            </Pressable>
            {filters.map((kind) => {
              const active = assetFilter === kind;
              return (
                <Pressable key={kind} style={[styles.kindChip, active && styles.kindChipActive]} onPress={() => setAssetFilter(kind)}>
                  <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>{kind}</Text>
                </Pressable>
              );
            })}
          </View>
          {list.length ? list.map((asset) => (
            <View style={styles.assetRow} key={asset.id}>
              <Text style={styles.assetName}>{asset.original_name}</Text>
              <Text style={styles.assetMeta}>{asset.kind} | {asset.topic || "-"} | {asset.recording_date || "-"} | {formatBytes(asset.size_bytes)}</Text>
              <View style={styles.assetActions}>
                <Pressable style={styles.miniBtn} onPress={() => Linking.openURL(`${getApiBaseUrl()}${asset.download_url}`)}><Text style={styles.miniBtnText}>Download</Text></Pressable>
                <Pressable style={styles.miniBtn} onPress={() => Linking.openURL(`${getApiBaseUrl()}${asset.preview_url}`)}><Text style={styles.miniBtnText}>Open</Text></Pressable>
                <Pressable style={[styles.miniBtn, styles.miniBtnDanger]} onPress={() => onDeleteAsset(asset.id)}><Text style={[styles.miniBtnText, styles.miniBtnTextDanger]}>Delete</Text></Pressable>
              </View>
            </View>
          )) : <Text style={styles.emptyText}>No assets found for this filter.</Text>}
        </View>
      </View>
    );
  }

  const currentSection = scriptSections[teleIndex];

  useEffect(() => { void refreshData(); }, []);

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.kicker}>Daily Creator</Text>
            <Text style={styles.title}>Today First Workflow</Text>
          </View>
          <View style={styles.localDotWrap}><View style={styles.localDot} /></View>
        </View>
        <View style={styles.switcher}>
          {(["today", "tasks", "assets", "series"] as FeatureKey[]).map((key) => {
            const active = key === feature;
            return (
              <Pressable key={key} style={[styles.switchBtn, active && styles.switchBtnActive]} onPress={() => setFeature(key)}>
                <Text style={[styles.switchText, active && styles.switchTextActive]}>{key.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 26 }}>
        {renderFeature()}
      </ScrollView>

      <Modal visible={teleOpen} transparent animationType="fade" onRequestClose={() => { stopSectionTimer(); setTeleOpen(false); }}>
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
                <Text style={styles.teleMeta}>
                  {teleIndex + 1}/{scriptSections.length} · {currentSection.label} · {currentSection.timing.start_s}–{currentSection.timing.end_s}s · {currentSection.word_count}w
                </Text>

                {(() => {
                  const duration = currentSection.timing.end_s - currentSection.timing.start_s;
                  const pct = duration > 0 ? Math.min(100, (sectionElapsed / duration) * 100) : 0;
                  return (
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: "#ffe4cc", overflow: "hidden" }}>
                      <View style={{ height: 5, borderRadius: 3, backgroundColor: COLORS.accent, width: `${pct}%` }} />
                    </View>
                  );
                })()}

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

                <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ padding: 14 }}>
                  <InlineCuedText text={currentSection.text} fontSize={teleTextSize} />
                </ScrollView>

                <View style={styles.teleControls}>
                  <Pressable style={styles.teleControlBtn} onPress={() => setTeleTextSize((v) => Math.max(22, v - 2))}>
                    <Text style={styles.teleControlText}>A-</Text>
                  </Pressable>
                  <Pressable style={styles.teleControlBtn} onPress={() => setTeleTextSize((v) => Math.min(64, v + 2))}>
                    <Text style={styles.teleControlText}>A+</Text>
                  </Pressable>
                </View>

                {Platform.OS !== "web" && (
                  <View style={{ flexDirection: "row", gap: 10, alignItems: "center", marginTop: 2 }}>
                    <CameraView ref={cameraRef} mode="video" videoQuality="2160p" facing="front"
                      style={{ width: 110, height: 150, borderRadius: 10, overflow: "hidden", backgroundColor: "#000" }} />
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
                            <Pressable style={{ backgroundColor: "#1a1a1a", borderRadius: 10, paddingVertical: 12, alignItems: "center" }} onPress={onPressStop}>
                              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>■ STOP</Text>
                            </Pressable>
                          )}
                        </>
                      ) : (
                        <>
                          {!hasPermissions && <Text style={{ color: COLORS.muted, fontSize: 11, lineHeight: 15 }}>Tap REC to grant camera &amp; mic access.</Text>}
                          <Pressable style={{ backgroundColor: COLORS.danger, borderRadius: 10, paddingVertical: 12, alignItems: "center" }} onPress={onPressRecord}>
                            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>● REC</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  </View>
                )}

                {!isRecording && (
                  <View style={styles.teleNav}>
                    <Pressable style={styles.secondaryBtn} onPress={() => {
                      const prev = Math.max(0, teleIndex - 1);
                      setTeleIndex(prev);
                      startSectionTimer(scriptSections[prev].timing.end_s - scriptSections[prev].timing.start_s);
                    }}>
                      <Text style={styles.secondaryBtnText}>Previous</Text>
                    </Pressable>
                    <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={onNextTeleSection}>
                      <Text style={styles.primaryBtnText}>{teleIndex < scriptSections.length - 1 ? "Next Section" : "Finish"}</Text>
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

      <ScriptDirectorModal
        visible={directorOpen}
        onClose={() => { setDirectorOpen(false); setDirectorTarget(null); }}
        scriptSections={scriptSections}
        today={today}
        target={directorTarget}
        onApplied={onDirectorApplied}
        onOpenTeleprompter={onOpenTeleprompter}
      />

      <SectionEditPopup
        visible={sectionEditOpen}
        onClose={() => { setSectionEditOpen(false); setSectionEditSection(null); }}
        section={sectionEditSection}
        scriptSections={scriptSections}
        today={today}
        onApplied={onDirectorApplied}
      />

      <EpisodePlanPopup
        visible={episodePlanOpen}
        onClose={() => { setEpisodePlanOpen(false); setEpisodePlanItem(null); }}
        item={episodePlanItem}
        seriesId={seriesDraft?.id ?? ""}
        seriesName={seriesDraft?.name ?? ""}
        onItemUpdated={onEpisodeItemUpdated}
        onPlanSaved={onEpisodePlanSaved}
        onScriptGenerated={onEpisodeScriptGenerated}
      />

      {/* Topic Picker Modal */}
      <Modal visible={topicPickerOpen} transparent animationType="slide" onRequestClose={() => setTopicPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(23,18,14,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", paddingTop: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <Text style={{ fontWeight: "800", fontSize: 17, color: COLORS.text }}>Pick a Different Topic</Text>
              <Pressable onPress={() => setTopicPickerOpen(false)} style={{ padding: 4 }}>
                <Text style={{ fontSize: 20, color: COLORS.muted }}>×</Text>
              </Pressable>
            </View>
            {topicPickerStatus ? (
              <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#fff8f0" }}>
                <Text style={{ color: COLORS.accent, fontSize: 13, fontWeight: "600" }}>{topicPickerStatus}</Text>
              </View>
            ) : null}
            {topicPickerLoading ? (
              <View style={{ padding: 32, alignItems: "center" }}>
                <ActivityIndicator color={COLORS.accent} />
                <Text style={{ marginTop: 10, color: COLORS.muted, fontSize: 13 }}>Loading topics…</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
                {topicPickerList.map((t) => {
                  const isCurrent = today?.topic.angle === t.topic_angle;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => !isCurrent && onPickTopic(t.id)}
                      style={{
                        borderWidth: 1,
                        borderColor: isCurrent ? COLORS.accent : COLORS.border,
                        borderRadius: 14,
                        padding: 12,
                        backgroundColor: isCurrent ? "#fff7ef" : "#fafaf9",
                        gap: 3,
                        opacity: isCurrent ? 0.7 : 1,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={{ color: COLORS.accent, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>
                          {t.category.replace(/_/g, " ")} · Day {t.day_index}
                        </Text>
                        {isCurrent && (
                          <View style={{ backgroundColor: COLORS.accent, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>TODAY</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: COLORS.text, fontSize: 14, fontWeight: "800", lineHeight: 20 }}>{t.topic_angle}</Text>
                      {t.hook_idea ? <Text style={{ color: COLORS.muted, fontSize: 12, lineHeight: 17 }}>{t.hook_idea}</Text> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
