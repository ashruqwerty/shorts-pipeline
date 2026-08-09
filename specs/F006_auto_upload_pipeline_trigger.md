# F006 — Auto-Upload + Downstream Pipeline Trigger

## Goal
After all 6 section clips are recorded and uploaded (each via F005's `onPressStop`), automatically call the backend pipeline trigger endpoint. The trigger kicks off FFmpeg assembly (F007) without requiring manual action.

## What F005 already does
Each `onPressStop` call uploads the clip as `a_roll` with the correct `section_index`. The final `onNextTeleSection` call marks session status as `uploaded`.

## What F006 adds

### Backend: `POST /api/daily/pipeline/trigger`
- Finds today's `a_roll` assets in the DB ordered by `section_index`
- Validates: at least 1 clip present (trigger can be called before all 6 are done — pipeline will use what's available)
- Delegates to `assemble_clips()` (F007 implementation)
- Returns `{ status, output_path, clip_count, message }`

### Frontend
In `onNextTeleSection`: after `updateSessionStatus("uploaded")` succeeds on the last section, call `POST /api/daily/pipeline/trigger`. Display result in `todayStatus`.

Add `triggerPipeline()` to `client.ts`:
```typescript
export function triggerPipeline(): Promise<PipelineTriggerResult>
```

## Acceptance criteria
1. Pressing STOP on section 5 → clip uploads → session marked uploaded → trigger called automatically.
2. Backend trigger finds the clips in section_index order.
3. Response includes `output_path` when assembly succeeds, error message when FFmpeg missing/fails.
4. Frontend shows trigger result in status message.
