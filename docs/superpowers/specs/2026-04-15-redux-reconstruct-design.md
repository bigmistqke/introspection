# Redux State Reconstruction Design

> **Status:** landed (2026-04-15) · plan: `docs/superpowers/plans/2026-04-15-redux-json-patch-introspection.md`

## Goal

Provide utilities to reconstruct Redux state from captured events for debugging/visualization.

## Design

### Location

- `@introspection/types` — add `readJSON` to `AssetsAPI`
- `@introspection/plugin-redux` — new file: `src/reconstruct.ts`

### Changes

**1. `AssetsAPI`** (`packages/types/src/index.ts`)

Add `readJSON` method:

```typescript
export interface AssetsAPI {
  ls(): Promise<AssetRef[]>
  metadata(path: string): Promise<AssetRef | undefined>
  readText(path: string): Promise<string>
  readJSON<T>(path: string): Promise<T>  // NEW
  readBinary?(path: string): Promise<ArrayBuffer>
}
```

**2. `reconstruct.ts`** (`plugins/plugin-redux/src/reconstruct.ts`)

```typescript
import type { TraceEvent, AssetsAPI } from '@introspection/types'

export function reconstruct(opts: {
  events: TraceEvent[]
  assets: AssetsAPI
  eventId: string
}): Promise<{ beforeState: unknown; afterState: unknown }>
```

**Behavior:**
- For `redux.dispatch` events: `beforeState` = state before action, `afterState` = state after action
- For other events: `beforeState` = `afterState` = state at that point
- Uses `redux.snapshot` events as checkpoints to replay patches

**Implementation:**
1. Find nearest preceding `redux.snapshot` event
2. Load snapshot asset via `assets.readJSON(path)`
3. Replay all dispatch patches from snapshot forward to target event
4. Apply target event's diff to get `afterState`

### Error Handling

Throws if no preceding `redux.snapshot` found (invariant: plugin always emits initial snapshot).

## Files to Modify

| File | Change |
|------|--------|
| `packages/types/src/index.ts` | Add `readJSON` to `AssetsAPI` |
| `plugins/plugin-redux/src/reconstruct.ts` | New file with `reconstruct` function |
| `plugins/plugin-redux/src/index.ts` | Re-export `reconstruct` |
| `plugins/plugin-redux/test/reconstruct.test.ts` | New test file |
