# F014 — Path to a Real iOS/Android App

## The headline: you already picked React Native

`frontend_rn` **is** a React Native (Expo) app today — `App.tsx`, `expo-document-picker`, the works. Every time you've tested it, you've been running that same codebase through `expo start --web` (`react-native-web`), which is a browser preview of it, not a separate thing. There is no rewrite. "Make it work on iOS and Android with one codebase" is already the architecture — what's missing is everything *around* the app that currently assumes "my laptop, localhost, one person at a time."

## Scope decision: in-app camera recording is V2, not V1

`App.tsx` has an `expo-camera`-based in-app recorder, but it's wrapped in a `Platform.OS !== "web"` guard, so it has never actually run — not on web (hidden), and not confirmed on a device either. Every a-roll clip used so far was recorded externally (phone's own camera app) and uploaded via the Assets tab's file picker. **V1 keeps that exact workflow** — record outside the app, upload the file — and the untested in-app recorder is explicitly deferred to V2. This removes the riskiest, completely-unvalidated native code path from the V1 critical path.

Concretely, for V1:
- Don't add `expo-camera` to `package.json`, and don't add `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` to `app.json` — V1 doesn't touch the camera at all, so there's nothing to declare.
- The in-app recorder's `Platform.OS !== "web"` guard should become something stronger — e.g. a `FEATURE_IN_APP_RECORDER = false` flag gating the same block — so it also stays hidden on a real iOS/Android build, not just on web. Otherwise it would be the one path in the whole app that's never been tested on any platform, sitting live in a real release.
- The Assets tab's manual upload flow is what V1 actually depends on — so that's what gets the real device testing pass, not the recorder.

Confirmed gaps as of today (the parts still relevant for V1):
- `app.json` has **no `ios`/`android` config at all** — no bundle identifier, no package name, no EAS project id. It's only ever been configured for web bundling.
- The backend (`backend/app/main.py`, run via `uvicorn` on your machine) only exists on your laptop. `frontend_rn/.env.example` already has a note for pointing the app at your LAN IP for phone testing — that's step one, not the finish line.
- All the heavy lifting (Whisper transcription, FFmpeg assembly, Veo generation) happens **server-side**, which is exactly right for mobile — a phone was never going to run Whisper or FFmpeg itself. The job is to get that server somewhere a phone can always reach it, not just your home WiFi.

## Phase 1 — Prove it on a real device, zero new infrastructure

Goal: confirm the existing app actually behaves on a phone (teleprompter, manual upload, pipeline trigger) before spending anything on infra.

1. Gate the in-app recorder off for V1 (see above), so there's nothing camera-related to validate yet.
2. Add minimal native config to `app.json`:
   - `ios.bundleIdentifier` (reverse-DNS, e.g. `com.yourname.shortscreator`)
   - `android.package` (same format)
3. Run `npx expo start`, scan the QR code with **Expo Go** (App Store / Play Store) on your phone, same WiFi as your laptop.
4. Set `EXPO_PUBLIC_API_BASE_URL` in `frontend_rn/.env` to your laptop's LAN IP (e.g. `http://192.168.1.12:8000`) — already documented in `.env.example`, just needs to actually be set and your backend started with `--host 0.0.0.0` so it accepts non-localhost connections.
5. Walk the whole flow on the phone: today card → teleprompter (read-through) → Assets tab upload (a file recorded externally) → trigger pipeline → download. This is the cheapest possible way to find native-only bugs (file-picker quirks, upload failures) before touching deployment.

`expo-document-picker` is fine inside Expo Go for this validation pass.

## Phase 2 — Get the backend off your laptop

This is the real lift. Right now: FastAPI + SQLite + a `local_storage/` folder, all on one machine, reachable only on your LAN. For a phone to use this app away from your house, the backend needs to live somewhere always-on and network-reachable over HTTPS.

**Recommended target: a single cloud VM, containerized.** You're already on GCP (Vertex AI for Veo) — a GCP Compute Engine VM in the same project is the path of least resistance:

1. **Dockerize the backend** — a `Dockerfile` installing Python deps, `ffmpeg`, and the Whisper model weights (bake them into the image at build time so cold-starts aren't downloading a model). This also makes the "works on my machine" FFmpeg-on-PATH problem disappear forever.
2. **Move file storage off local disk.** `local_storage/assets` and `local_storage/outputs` currently live on disk next to the code — fine for one laptop, not for a VM you might resize/replace, and not for serving files back to a phone reliably. Move to a GCS bucket; `storage.py`'s `save_upload`/`get_asset`/asset download endpoints become "upload to GCS" / "signed URL" instead of local file paths.
3. **Move the DB off SQLite eventually.** SQLite is genuinely fine for "just me, one request at a time," which is still true even with a phone client as long as it's still just you. If you ever add a second user or expect concurrent pipeline runs, that's the trigger to move to Cloud SQL (Postgres) — not before.
4. **Secrets, properly.** `vertex_key.json` (a raw service-account key file) and the Gemini API key currently sit in plaintext on your laptop. On the VM, use GCP Secret Manager (or, better, skip the key file entirely and run the VM under a service account with Vertex AI permissions — no key file to leak at all).
5. **HTTPS.** iOS's App Transport Security blocks plain HTTP by default for real builds (it's lenient in Expo Go/dev, not in TestFlight/production). Easiest paths: put the VM behind a GCP HTTPS load balancer with a managed cert, or skip the VM entirely and deploy the container to **Cloud Run** instead — HTTPS, scaling, and a public URL come for free, and Cloud Run's request-based billing suits a "runs occasionally" personal tool well. (Caveat: Cloud Run has a request timeout ceiling — check it against your longest pipeline run, which can be 10+ minutes; if it's tight, the VM route gives you an unbounded long-running process instead.)
6. Point `EXPO_PUBLIC_API_BASE_URL` at the new public HTTPS URL for non-dev builds.

## Phase 3 — Long AI jobs don't mix well with "keep the app open"

Your pipeline run can take 5-10+ minutes (sequential Whisper transcription + several Veo generations). On a phone, nobody keeps an app pinned open and foregrounded for that long — and iOS/Android both aggressively suspend backgrounded apps, which will kill your current 3-second polling loop the moment the screen locks.

The good news: since all the actual work already happens server-side, backgrounding the app doesn't interrupt the *job* — it just means the app can't show you live progress while it's backgrounded. Two complementary fixes:

1. **Push notifications on completion** — Expo's push notification service (wraps APNs/FCM so you write one implementation for both platforms) sends "Your video is ready 🎬" when the pipeline finishes, instead of relying on the app being open to notice.
2. **Re-check status on resume, not just via the poller** — add an `AppState` listener so that when the app comes back to the foreground, it immediately re-fetches `/api/pipeline/status` once (the job status already survives server restarts via the `daily_sessions` table — just needs the client to ask again, not assume its old poller is still ticking).

## Phase 4 — Native-specific rough edges to expect

- **Upload size over cellular.** You deliberately chose full-quality, no-compression recordings. That's the right call for output quality, but a 4K multi-minute clip over LTE/5G is a real wait and a real data cost. Consider a "Wi-Fi only" upload toggle, or at minimum a visible upload-progress indicator (currently uploads are fire-and-forget with no progress bar) so it doesn't look hung.
- **Resumable/chunked uploads** are worth it once you're uploading over real mobile networks instead of localhost — a dropped connection mid-upload today just fails silently (noted in the earlier frontend audit: `onPressStop` swallows an upload failure and advances anyway).
- **App icons, splash screen, store screenshots** — `app.json` has none of this yet; Expo's `expo-splash-screen`/icon config needs real asset files before a store submission will even build cleanly.

## Phase 5 — Actually building and shipping the binary

This is where **EAS Build** (Expo's cloud build service) earns its keep — it builds iOS binaries without you owning a Mac, and both platforms from one `eas build` command:

1. `npx eas build:configure` — sets up `eas.json` with build profiles (`development`, `preview`, `production`).
2. **Apple**: enroll in the Apple Developer Program ($99/yr) — required for any device testing beyond the simulator, and for TestFlight. `eas build --platform ios --profile preview` → distribute via TestFlight to yourself first, then invite testers.
3. **Google**: a Google Play Console account ($25 one-time) → `eas build --platform android --profile preview` → upload to an internal testing track.
4. **EAS Submit** (`eas submit`) automates pushing the built binary to App Store Connect / Play Console once you're past manual testing.
5. Store listing requirements worth knowing about now rather than at submission time: a privacy policy URL (you're uploading and processing video — both stores will ask), a Data Safety form (Google) / privacy "nutrition label" (Apple) describing what you collect, and an age rating questionnaire. (This gets a second pass in V2 once in-app camera/mic capture is added — that adds its own disclosure requirements on top of what V1 needs.)

## Suggested sequencing (V1)

| Milestone | What it proves | New cost/infra |
|---|---|---|
| 1. Expo Go on your phone, backend on LAN IP | The native app itself works — teleprompter, file upload, pipeline trigger | None |
| 2. Backend containerized + deployed (Cloud Run or a VM), HTTPS | App works from anywhere, not just your WiFi | A GCP always-on service |
| 3. EAS preview build → TestFlight / Play internal track | Real install, not a dev client — true store-shaped testing | Apple $99/yr, Google $25 |
| 4. Push notifications + resume-aware status polling | Usable without babysitting the app for 10 minutes | Expo push service (free) |
| 5. Store assets, privacy policy, submission | Public release | — |

Each milestone is independently useful and separately gated by things outside this codebase (device access, developer accounts, billing) — happy to help implement any specific piece (the Dockerfile, the `app.json` native config, the push-notification wiring, the GCS migration) whenever you're ready to start one.

## Deferred to V2

- The in-app `expo-camera` recorder — pin the dependency, add `NSCameraUsageDescription`/`NSMicrophoneUsageDescription`, remove the feature gate, and actually test the record/stop/upload flow for the first time on a real device.
- Per-section recording → multi-clip assembly: even if V2 re-enables the in-app recorder's per-section capture, note that `_resolve_pipeline_assets` on the backend currently only picks *one* a-roll file (the first match) — it was never wired up to stitch multiple per-section clips together. That's backend work that goes along with re-enabling the recorder, not just a frontend flag flip.
- Updated store privacy disclosures once camera/mic capture is live.
