# Memory Adapters Design

## Goal

Add in-memory storage adapters for testing and flexible storage backends.

## Motivation

- **Testing:** Avoid mocking `StorageAdapter` in unit tests — use real in-memory implementation
- **Flexibility:** Enable alternative storage backends beyond filesystem
- **Integration:** Shared memory between writer and reader for seamless testing

## Design

### Location

- `@introspection/types` — move `StorageAdapter` interface here
- `@introspection/utils` — add memory adapter implementations
- `@introspection/read` — import `StorageAdapter` from types

### Changes

**1. `StorageAdapter` moved to `@introspection/types`**

```typescript
// packages/types/src/index.ts
export interface StorageAdapter {
  listDirectories(): Promise<string[]>
  readText(path: string): Promise<string>
  readBinary?(path: string): Promise<ArrayBuffer>
}
```

**2. Memory adapters in `@introspection/utils`**

```typescript
// packages/utils/src/memory.ts

export interface MemoryWriteAdapter extends StorageAdapter {
  writeText(path: string, content: string): Promise<void>
  writeBinary?(path: string, content: ArrayBuffer): Promise<void>
  writeAsset(path: string, content: string | ArrayBuffer): Promise<void>
}

export function createMemoryAdapters(
  store?: Map<string, string | ArrayBuffer>
): {
  reader: StorageAdapter
  write: MemoryWriteAdapter
}
```

**3. Trace factory**

```typescript
export async function createMemoryTrace(): Promise<{
  writer: TraceWriter
  reader: TraceReader
}>
```

### API

```typescript
// Option 1: Separate adapters for flexibility
const { reader, write } = createMemoryAdapters()
const writer = await createTraceWriter({ adapter: write })
const reader = await createTraceReader(reader)

// Option 2: Convenience factory
const { writer, reader } = await createMemoryTrace()
```

## Files to Modify

| File | Change |
|------|--------|
| `packages/types/src/index.ts` | Add `StorageAdapter` interface |
| `packages/utils/src/memory.ts` | New file with memory adapter implementations |
| `packages/utils/src/index.ts` | Export memory adapters |
| `packages/read/src/index.ts` | Import `StorageAdapter` from types, remove local definition |
| `packages/write/src/trace.ts` | Add `adapter` option to `createTraceWriter` |

## Files to Create

| File | Purpose |
|------|---------|
| `packages/utils/src/memory.ts` | Memory adapter implementations |
| `packages/utils/test/memory.test.ts` | Unit tests |

## Verification

- [ ] Types compile: `pnpm typecheck`
- [ ] Build succeeds: `pnpm build`
- [ ] Tests pass: `pnpm test`
