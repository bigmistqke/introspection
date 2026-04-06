---
name: debug-demo
description: Run a debugging agent inside a demo directory. The agent uses introspect to diagnose the failing test without reading source code.
---

# Debug Demo

When invoked, determine which demo to debug (from the user's message or ask if unclear), then dispatch a sub-agent with the instructions below.

Read the following files and embed their full contents into the agent prompt:
- `packages/playwright/README.md`
- `packages/cli/README.md`
- `packages/plugin-webgl/README.md`

Compute the rapport path: `<repo-root>/demo-rapports/<YYYY-MM-DD>-<demo-name>.md` using today's date and the demo directory name.

Then launch a general-purpose agent with this prompt (substituting `<DEMO_DIR>` with the absolute path, `<RAPPORT_PATH>` with the computed rapport path, and `<README_CONTENTS>` with the file contents read above):

---

## Agent prompt template

You are debugging a failing Playwright test. Your working directory is `<DEMO_DIR>`.

**You are not allowed to read any source files** — not `index.ts`, not `test.spec.ts`, not any `.ts` or `.js` files in the demo or packages. Your only window into what happened is the `introspect` CLI.

## Your task

1. Run the test to generate a trace: `pnpm test`
2. If no `.introspect/` directory is produced, introspection is not yet wired up. Add it yourself using the packages documented below.
3. Use `introspect` to investigate. Run `pnpm exec introspect --help` to discover available commands, then explore the trace to find the root cause.
4. Identify the root cause from trace evidence alone — do not read `index.ts` until you have a confident hypothesis
5. Fix the bug (you may read `index.ts` only after you have a confident hypothesis)
6. Verify the fix: run `pnpm test` again
7. Revert everything: restore `index.ts` to its original buggy state, and if you added instrumentation to `test.spec.ts`, remove it too
8. Log the rapport path `<RAPPORT_PATH>` in your final response

All `introspect` commands accept `--dir .introspect` to point at the trace directory.

## Package documentation

<README_CONTENTS:playwright>

<README_CONTENTS:cli>

<README_CONTENTS:plugin-webgl>

## Rapport — write as you go

Maintain a rapport at `<RAPPORT_PATH>` throughout your investigation. Write each entry **immediately** after the tool call completes — not as a summary at the end.

Every entry must follow this format:

```
### <tool-label>: <short description>
**Tool:** `<tool name>` — <"introspect CLI" | "non-CLI tool — <reason it was needed>">
**Why:** <why you chose this action at this moment>
**Output:** <exact output, or a concise excerpt if long>
**Learned:** <what this told you>
**Next:** <what you decided to do next>
```

Mark any tool use that is **not** the introspect CLI with `non-CLI tool` and the reason. This makes it visible when the introspect workflow was insufficient.

**Every file edit or write must also get its own rapport entry.** This includes: adding instrumentation to `test.spec.ts`, editing `index.ts` to apply a fix, reverting files. Use the same format — tool is `Edit` or `Write`, non-CLI tool, reason is why the source change was needed at that moment.

---

After the agent completes, share the rapport path `<RAPPORT_PATH>` with the user and summarise:
- What signals the agent found in the trace
- Whether it needed to read source code or reasoned from the trace alone
- Any points where the workflow felt incomplete or the agent got stuck
