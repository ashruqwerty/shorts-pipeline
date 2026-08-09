# F005 — In-App Video Recorder

## Goal
Add a section-by-section video recorder to the teleprompter modal. One clip per section; REC starts recording and the section timer; STOP ends recording, auto-uploads the clip as `a_roll` with `section_index`, then auto-advances the teleprompter. Full native resolution throughout.

## Library
`expo-camera` (Expo 51 compatible: `~14.0.2`). Use `CameraView` component + `useCameraPermissions` / `useMicrophonePermissions` hooks.

## Recording quality
`videoQuality: "2160p"` passed to `cameraRef.current.recordAsync()`. Falls back gracefully if device cap is lower — no server-side validation, just max quality requested.

## Camera placement
Small `CameraView` (120×160 px) fixed to the top-right corner of the teleprompter modal. Full recording happens through this view; the preview size does not limit the captured resolution.

## Recording flow
1. User enters teleprompter modal → permissions requested → camera preview shown
2. Press **REC** → `recordAsync({ videoQuality: "2160p" })` + `startSectionTimer()`
3. User reads section aloud
4. Press **STOP** → `stopRecording()` → await clip URI → upload clip → advance section
5. On last section: upload + mark session uploaded + close modal

When recording is active: navigation buttons hidden; only STOP visible.

## Upload
Reuse `uploadAsset` from `client.ts` with:
```
kind: "a_roll"
section_index: teleIndex   (0–5)
topic: today.topic.angle
```

`client.ts` must be updated to accept `sectionIndex?: number` and include it in form data.

## Permissions UX
- Request camera + microphone permissions on first teleprompter open
- If denied: show inline error, disable REC button; teleprompter still works for rehearsal

## app.json
Add expo-camera plugin entry with `cameraPermission` and `microphonePermission` strings.

## Acceptance criteria
1. REC pressed → red dot indicator visible; STOP replaces REC.
2. STOP pressed → clip saves, upload happens, teleprompter advances.
3. All 6 clips saved with correct `section_index` 0–5 on backend.
4. If camera permission denied, teleprompter still works (recorder disabled gracefully).
5. TypeScript no errors.
