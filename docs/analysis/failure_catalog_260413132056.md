# Failure-handling catalog — 2026-04-13

Exhaustive list of every site in `src/**/*.ts` (non-test, non-dist) where an exception can be thrown, caught, or swallowed. Collected in parallel across core packages and all 11 plugins. No dedup, no summary — this is input material for the next design round.

Paths are relative to `/Users/bigmistqke/Documents/GitHub/introspection`.

---

## A. Try/catch blocks

### Core packages

- `packages/utils/src/summarise-body.ts:5` — `JSON.parse(raw)` — catches parse failures; returns empty default on error.
- `packages/read/src/node.ts:17` — `readdir(dir)` — catches directory read failures in `listDirectories()`; swallows silently, returns empty array.
- `packages/read/src/index.ts:48` — `adapter.readText(...)` + `JSON.parse(raw)` — catches read/parse failures in `listTraces()`; swallows silently, skips malformed trace (comment: `// skip malformed traces`).
- `packages/read/src/index.ts:217` — `adapter.readText(...)` + `JSON.parse(raw)` — catches read/parse failures in `getLatestTraceId()`; swallows silently, defaults `startedAt` to 0.
- `packages/playwright/src/snapshot.ts:26` — `cdpSession.send('DOM.getDocument')` — catches CDP command failure; swallows silently (`/* non-fatal */`), leaves `dom` empty string.
- `packages/playwright/src/snapshot.ts:37` — `cdpSession.send('Runtime.getProperties')` — catches CDP command failure; swallows silently (`/* non-fatal */`), skips this scope frame.
- `packages/playwright/src/snapshot.ts:52` — `cdpSession.send('Runtime.evaluate', …)` — catches CDP command failure; swallows silently (`/* non-fatal */`), skips this global variable.
- `packages/playwright/src/attach.ts:99` — `JSON.parse(bindingCall.payload)` — catches JSON parse of browser-side push message; swallows silently (`/* malformed push — ignore */`).
- `packages/playwright/src/attach.ts:120` — `cdpSession.send('Runtime.evaluate', …)` in navigation recovery loop — catches CDP command; swallows silently (`/* non-fatal */`).
- `packages/cli/src/commands/debug.ts:44` — `stat(configPath)` — catches stat failure; swallows, sets `configExists = false`.
- `packages/cli/src/commands/debug.ts:54` — `import(configPath)` — catches config import failure; rethrows if config was explicitly provided, silently defaults if implicit.
- `packages/cli/src/commands/events.ts:65` — `runInNewContext(opts.filter!, …)` — catches VM execution failure in event filter; swallows silently and returns false (filter fails to match, no indication of why).

### Plugins (A–N)

- `plugins/plugin-cdp/src/index.ts:49` — `originalSend(method, params)` — catches CDP send failure; emits `cdp.error` event with method/params/error string, then rethrows to caller.
- `plugins/plugin-debugger/src/index.ts:70` — `JSON.parse(params.payload)` for `{ label?: string }` — catches parse failure; swallows silently (`/* ignore malformed payload */`).
- `plugins/plugin-debugger/src/index.ts:121` — `cdpSession.send('Runtime.getProperties', …)` + property unpacking — catches; swallows silently (`/* non-fatal */`).
- `plugins/plugin-network/src/index.ts:78` — `cdpSession.send('Network.getResponseBody', …)` + `Buffer.from(…).toString(…)` + `ctx.writeAsset(…)` — catches; logs error via `debug()` and returns without emitting body event.

### Plugins (P–W)

- `plugins/plugin-redux/src/index.ts:27` — `JSON.parse(JSON.stringify(value))` deep clone — catches (`catch (e)`); returns `undefined` (swallows silently, loses payload/state).
- `plugins/plugin-solid-devtools/src/index.ts:77` — `JSON.parse(parameters.payload)` — catches; swallows silently (`/* ignore malformed push */`).
- `plugins/plugin-webgl/src/index.ts:171` — `pluginCtx.page.evaluate(async () => { … return await plugin.captureCanvases() })` — catches; sets `canvases = []` on error.
- `plugins/plugin-webgl/src/browser.ts:325` — `canvas.toDataURL()` + `canvas.convertToBlob()` in capture loop — catches; swallows silently (`/* non-fatal — skip this context */`), failing canvases skipped, loop continues.

---

## B. Promise `.catch()` sites

### Core packages

- `packages/write/src/trace.ts:18` — `pending = result.then(() => {}, () => {})` on write-queue pending chain — swallows all errors; disk failures (`ENOSPC`/`EACCES`) during `appendEvent` become resolved state.
- `packages/playwright/src/attach.ts:82` — `.catch(() => {})` on `cdpSession.send('Runtime.evaluate', unwatchExpression)` — swallows silently; unwatch failure non-fatal.
- `packages/playwright/src/attach.ts:111` — `.catch(() => {})` on `page.evaluate(plugin.script)` — swallows silently; plugin-script eval failures not reported.
- `packages/playwright/src/attach.ts:163` — `.catch(() => {})` on `cdpSession.send('Runtime.evaluate', { expression: '0' })` flush roundtrip — swallows silently; no-op roundtrip failure non-fatal.
- `packages/playwright/src/attach.ts:176` — `.catch(() => {})` on bulk unwatch during detach — swallows silently; unwatch on detach non-fatal.
- `packages/playwright/src/attach.ts:179` — `.catch(() => {})` on `cdp.detach()` — swallows silently.
- `packages/playwright/src/trace.ts:91` — `.catch(() => {})` on `handle.snapshot()` — swallows silently; auto-snapshot on test failure non-fatal.
- `packages/cli/src/commands/debug.ts:164` — `.on('error', …)` listener on `createReadStream(filePath)` — responds with 404 and ends response.
- `packages/utils/src/bus.ts:22` — `Promise.allSettled(registered.map(h => Promise.resolve().then(() => h(payload))))` — handler rejections are collected by `allSettled` and discarded; a plugin handler that throws is invisible.

### Plugins (A–N)

- `plugins/plugin-debugger/src/index.ts:94` — `.catch(() => {})` on `cdpSession.send('Debugger.resume')` — swallows silently.
- `plugins/plugin-debugger/src/index.ts:138` — `.catch(() => {})` on `cdpSession.send('Debugger.resume')` after collecting locals — swallows silently.
- `plugins/plugin-debugger/src/index.ts:140-142` — `.then(…).catch(() => '')` on `cdpSession.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })` — returns empty string on rejection.

### Plugins (P–W)

- `plugins/plugin-solid-devtools/src/index.ts:84` — `.catch(() => { /* Navigation may destroy the execution context before configure completes — expected. */ })` on `context.page.evaluate(...)` — swallows silently; navigation context loss expected.

---

## C. Explicit `throw` statements

### Core packages

- `packages/write/src/trace-writer.ts:16` — `throw new Error('Trace directory already exists: …')` — triggered when trace directory already exists; propagates to caller of `initTraceDir`.
- `packages/read/src/index.ts:80` — `throw new Error('No traces found')` — no traces available; propagates to caller of `createTraceReader`.
- `packages/playwright/src/trace.ts:55` — `throw new Error('trace not initialized — attach must be called inside a test')` — `traceRef` is null on attach; propagates to caller.
- `packages/playwright/src/trace.ts:72` — `throw new Error('trace not initialized')` — `currentTrace` is null in test wrapper; propagates to caller.
- `packages/cli/src/commands/debug.ts:25` — `throw new Error('Either url or --serve must be provided')` — neither provided; propagates.
- `packages/cli/src/commands/debug.ts:29` — `throw new Error('Cannot use both url and --serve')` — both provided; propagates.
- `packages/cli/src/commands/debug.ts:60` — `throw new Error('Config must export default object with plugins array')` — config loaded but invalid shape; propagates.
- `packages/cli/src/commands/debug.ts:69` — `throw err` — rethrows from import catch when config explicitly provided; propagates.
- `packages/cli/src/commands/debug.ts:84` — `throw new Error('Either url or --serve must be provided')` — second check; propagates.
- `packages/cli/src/commands/debug.ts:144` — `throw new Error('Path not found: ' + basePath)` — serve path missing; propagates to caller of `startLocalServer`.
- `packages/cli/src/commands/events.ts:17` — `throw new Error('--last must be a positive integer')` — invalid `--last` value; propagates.
- `packages/cli/src/commands/events.ts:25` — `throw new Error('no mark event with label "…" found')` — `--since` label not found; propagates.
- `packages/cli/src/commands/skills.ts:87` — `throw new Error('Could not find bundled skills directory. Try reinstalling the introspect package.')` — skills dir unreadable; propagates.

### Plugins (A–N)

- `plugins/plugin-cdp/src/index.ts:77` — `throw error` inside catch block of monkeypatched `emitter.send()` — rethrows any CDP send rejection to caller of patched send.

### Plugins (P–W)

- `plugins/plugin-react-scan/src/index.ts:44` — `throw new Error('reactScanPlugin.report() called before install()')` — `ctx` is undefined; propagates to caller.
- `plugins/plugin-webgl/src/index.ts:142` — `throw new Error('webgl plugin: watch() called before install()')` — `pluginCtx` is null; propagates to caller.
- `plugins/plugin-webgl/src/index.ts:168` — `throw new Error('webgl plugin: captureCanvas() called before install()')` — `pluginCtx` is null; propagates to caller.

---

## D. Implicit / uncaught throw sites

### D1. `JSON.parse(x)` without try/catch

- `packages/write/src/trace-writer.ts:52` — `JSON.parse(await readFile(metaPath, 'utf-8'))` in `finalizeTrace`; SyntaxError if `meta.json` corrupted.
- `packages/read/src/index.ts:83` — `JSON.parse(metaRaw)` in `createTraceReader` after readText succeeds; SyntaxError if `meta.json` corrupted.
- `packages/read/src/index.ts:235` — `.map(line => JSON.parse(line))` in `loadEvents`; a single malformed line throws and aborts the whole map, making the entire trace unreadable.
- `packages/playwright/src/attach.ts:100` — `JSON.parse(bindingCall.payload) as EmitInput` — inside try/catch but the type assertion is unvalidated; a parsed object missing required fields reaches `emit()`.
- `plugins/plugin-react-scan/src/index.ts:49` — `JSON.parse(result.result.value)` in `report()` path; malformed JSON throws.

### D2. `JSON.stringify(x)` without try/catch (circular/BigInt/Symbol risk)

- `packages/write/src/trace-writer.ts:25` — `JSON.stringify(meta, null, 2)` in `initTraceDir`.
- `packages/write/src/trace-writer.ts:30` — `JSON.stringify(event)` in `appendEvent`; an event containing circular refs / BigInt / Symbol would throw and the write fails.
- `packages/playwright/src/attach.ts:73` — `JSON.stringify(spec)` — injected into browser evaluation; throws on circular/BigInt/Symbol in spec.
- `packages/playwright/src/attach.ts:81` — `JSON.stringify(subscription.browserId)` — injected into unwatch expression.
- `packages/playwright/src/attach.ts:121` — `JSON.stringify(subscription.spec)` — injected into navigation recovery loop.
- `packages/playwright/src/attach.ts:175` — `JSON.stringify(subscription.browserId)` — injected into detach unwatch.
- `packages/playwright/src/proxy.ts:67` — `JSON.parse(JSON.stringify(arg))` — inner `stringify` only, outer `parse` not wrapped; if `stringify` throws, error propagates.
- `packages/cli/src/commands/events.ts:74` — `JSON.stringify(filtered, null, 2)` — if any event contains circular/BigInt/Symbol, throws.
- `packages/cli/src/commands/plugins.ts:28` — `JSON.stringify(value)` on plugin option value.
- `plugins/plugin-debugger/src/index.ts:155` — `JSON.stringify({ reason, message, stack, url, timestamp, scopes })` where `scopes` is a nested Record of locals — BigInt/Symbol/circular in captured locals would throw.
- `plugins/plugin-react-scan/src/browser.ts:22` — `JSON.stringify(event)` in push helper.
- `plugins/plugin-solid-devtools/src/index.ts:23` — `JSON.stringify(state.structure)`.
- `plugins/plugin-solid-devtools/src/index.ts:31` — `JSON.stringify(state.dgraph)`.
- `plugins/plugin-solid-devtools/src/index.ts:39` — `JSON.stringify(state.updates)`.
- `plugins/plugin-solid-devtools/src/browser.ts:30` — `JSON.stringify({ type, metadata })`.
- `plugins/plugin-webgl/src/index.ts:89` — `JSON.stringify(snapshot)`.
- `plugins/plugin-webgl/src/browser.ts:37` — `JSON.stringify({ type, metadata })`.
- `plugins/plugin-webgl/src/browser.ts:190` — two `JSON.stringify(...)` calls for `lastUniformValue` and `value` comparison.
- `plugins/plugin-redux/src/index.ts:52` — `JSON.stringify(event)` in browser-embedded helper.
- `plugins/plugin-performance/src/browser.ts:8` — `JSON.stringify({ type, metadata })`.

### D3. `await <call>` without try/catch that can reject

- `plugins/plugin-console/src/index.ts:29` — `await ctx.cdpSession.send('Runtime.enable')` in `install()`; rejection aborts the plugin install, which rejects `attach()`.
- `plugins/plugin-debugger/src/index.ts:52` — `await ctx.cdpSession.send('Debugger.enable')` in `install()`.
- `plugins/plugin-debugger/src/index.ts:53` — `await ctx.cdpSession.send('Debugger.setPauseOnExceptions', …)`.
- `plugins/plugin-debugger/src/index.ts:54` — `await ctx.cdpSession.send('Runtime.addBinding', …)`.
- `plugins/plugin-debugger/src/index.ts:59` — `await ctx.cdpSession.send('Debugger.setBreakpoint', …)` in loop; first failure aborts loop, rejects install.
- `plugins/plugin-network/src/index.ts:39` — `await ctx.cdpSession.send('Network.enable')`.
- `plugins/plugin-react-scan/src/index.ts:45` — `await ctx.cdpSession.send('Runtime.evaluate', …)` in `report()`.
- `plugins/plugin-react-scan/src/index.ts:50` — `await ctx.emit(…)` in `report()`.
- `plugins/plugin-solid-devtools/src/index.ts:10` — `await context.page.evaluate(() => { … })`.
- `plugins/plugin-solid-devtools/src/index.ts:21` — `await context.writeAsset(…)`.
- `plugins/plugin-solid-devtools/src/index.ts:29` — `await context.writeAsset(…)`.
- `plugins/plugin-solid-devtools/src/index.ts:37` — `await context.writeAsset(…)`.
- `plugins/plugin-solid-devtools/src/index.ts:45` — `await context.emit(…)`.
- `plugins/plugin-solid-devtools/src/index.ts:67` — `await context.page.evaluate(…)`.
- `plugins/plugin-webgl/src/index.ts:72` — `await ctx.page.evaluate(…)`.
- `plugins/plugin-webgl/src/index.ts:77` — `await ctx.page.evaluate(…)` (not inside try/catch).
- `plugins/plugin-webgl/src/index.ts:87` — `await ctx.writeAsset(…)`.
- `plugins/plugin-webgl/src/index.ts:96` — `await ctx.writeAsset(…)`.
- `plugins/plugin-webgl/src/index.ts:105` — `await ctx.emit(…)`.
- `plugins/plugin-webgl/src/index.ts:188` — `await pluginCtx.writeAsset(…)` in captureCanvas path.
- `plugins/plugin-webgl/src/index.ts:196` — `await pluginCtx.emit(…)` in captureCanvas path.
- `packages/playwright/src/attach.ts:113` — `await plugin.install(makePluginContext(plugin))` in sequential loop — first plugin to reject aborts the loop, no subsequent plugins install, and the `attach()` call rejects.
- `packages/playwright/src/attach.ts:130` — `emit({ type: 'page.attach', metadata: { pageId } })` — unawaited; return promise rejection becomes unhandled (but internal write queue tolerates it via its own swallow).
- `packages/playwright/src/attach.ts:133` — `emit({ type: 'playwright.test.start', metadata: … })` — unawaited; same as above.
- `packages/playwright/src/attach.ts:171` — `emit({ type: 'page.detach', metadata: { pageId } })` — unawaited.
- `packages/playwright/src/attach.ts:168` — `emit({ type: 'playwright.result', metadata: detachResult })` — unawaited.

### D4. Type assertions on dynamic/external data (don't throw but mask runtime errors)

- `packages/playwright/src/attach.ts:122` — `as { result: { value: string } }` on `cdp.send('Runtime.evaluate', …)` result; `result.value` accessed without null check.
- `packages/playwright/src/snapshot.ts:27` — cast on `cdp.send('DOM.getDocument')` result; `root.nodeId` accessed without null check.
- `packages/playwright/src/snapshot.ts:28` — cast on `cdp.send('DOM.getOuterHTML')` result; `outerHTML` accessed without null check.
- `packages/playwright/src/snapshot.ts:38-39` — cast on `cdp.send('Runtime.getProperties')`; result array access without bounds check.
- `packages/playwright/src/snapshot.ts:53-55` — cast on `cdp.send('Runtime.evaluate')`; `result.value` accessed without null check.
- `packages/utils/src/cdp.ts:44-48` — type assertions on `frame.lineNumber` / `frame.columnNumber` without null checks.
- `plugins/plugin-cdp/src/index.ts:41` — `trace as unknown as { send: …; emit: … }` — raw CDPSession cast; missing methods cause TypeError at call-time.
- `plugins/plugin-console/src/index.ts:32` — `rawParams as { type: string; args: Array<{ type: string; value?: string; description?: string }>; timestamp: number }` — if CDP returns different shape, destructuring fails silently.
- `plugins/plugin-debugger/src/index.ts:68` — `rawParams as { name: string; payload: string }`.
- `plugins/plugin-debugger/src/index.ts:77` — `rawParams as { reason: string; data?: Record<string, unknown>; callFrames?: Array<…> }`.
- `plugins/plugin-debugger/src/index.ts:124` — `as { result: Array<{ name: string; value?: { … } }> }` on `cdp.send('Runtime.getProperties', …)` — `result.slice(0, 20)` throws TypeError if `result` is missing.
- `plugins/plugin-debugger/src/index.ts:141` — `(r as { result: { value?: string } }).result.value` — accessing `.value` on undefined fails.
- `plugins/plugin-debugger/src/index.ts:146` — `String((params.data as Record<string, unknown>)?.description ?? '')` — non-Error throws produce empty/unhelpful messages.
- `plugins/plugin-js-error/src/index.ts:22` — `rawParams as { exceptionDetails: Record<string, unknown> }`.
- `plugins/plugin-network/src/index.ts:47` — `rawParams as { requestId: string; request: { url: string } }`.
- `plugins/plugin-network/src/index.ts:56-57` — `rawParams as Record<string, unknown>` then `(parameters as { requestId: string }).requestId`.
- `plugins/plugin-network/src/index.ts:60` — `(responseEvent.metadata?.headers as Record<string, string> | undefined) ?? {}` — iteration assumes Record shape.
- `plugins/plugin-network/src/index.ts:72` — `rawParams as { requestId: string; errorText?: string }`.
- `plugins/plugin-network/src/index.ts:79` — `cdp.send('Network.getResponseBody', …) as { body: string; base64Encoded: boolean }` — inside try/catch, but if CDP returns shape without `body`, downstream reads undefined.
- `plugins/plugin-solid-devtools/src/index.ts:75` — `as { name: string; payload: string }`.
- `plugins/plugin-react-scan/src/index.ts:48` — `as { result: { value: string } }` on CDP response.
- `plugins/plugin-react-scan/src/browser.ts:37` — `report as { count: number; time: number; displayName: string | null }` — assumes shape without validation; non-matching shape fails at property access.

### D5. Array / property access risks

- `plugins/plugin-debugger/src/index.ts:107-114` — `frames.map(frame => normaliseStackFrame({ … frame.location.lineNumber … }))` — `frame.location` accessed without optional chaining; missing `location` yields `undefined` fields (guarded downstream via `??`, so no throw but lossy).
- `plugins/plugin-debugger/src/index.ts:125` — `for (const property of scopeProperties.slice(0, 20))` — if type-assert on line 124 was wrong and `scopeProperties` is undefined, `.slice` throws TypeError (caught by outer try/catch on line 121).

### D6. Buffer / RegExp / DOM ops that can throw

- `plugins/plugin-network/src/index.ts:81` — `Buffer.from(responseBody.body, 'base64').toString('utf-8')` — RangeError if body isn't valid base64; inside the outer try/catch on line 78.
- `plugins/plugin-webgl/src/browser.ts:74` — `new RegExp(source, flags)` — throws on invalid flags; no surrounding try/catch.
- `plugins/plugin-webgl/src/browser.ts:327` — `canvas.toDataURL('image/png')` — can throw if canvas tainted or in invalid state; guarded by outer try/catch on line 325.
- `plugins/plugin-webgl/src/browser.ts:329-330` — `await canvas.convertToBlob(…)` and `await blob.arrayBuffer()` — can reject; guarded by outer try/catch on line 325.

### D7. Console .map() on unvalidated shape

- `plugins/plugin-console/src/index.ts:39` — `params.args.map(a => a.value ?? a.description ?? '').join(' ')` — if type-assert on line 32 is wrong and `params.args` isn't an array, `.map` throws TypeError.

### D8. VM / user-code execution

- `packages/cli/src/commands/debug.ts:113` — `new Function('page', …)` + `await fn(page)` — no surrounding try/catch; user script throw propagates to handler, caught at command boundary (lines 185-189).
- `packages/cli/src/commands/skills.ts:85` — `readdir(skillsDir)` — inside the try wrapping `installSkills` (line 84).
