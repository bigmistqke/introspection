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
- `packages/cli/skills/introspect-debug/skill.md`

Compute the rapport path: `<repo-root>/demo-rapports/<YYYY-MM-DD>-<demo-name>.md` using today's date and the demo directory name.

Then launch a general-purpose agent with this prompt (substituting `<DEMO_DIR>` with the absolute path, `<RAPPORT_PATH>` with the computed rapport path, and `<README_CONTENTS>` with the file contents read above):

---

## Agent prompt template

You are debugging a failing Playwright test. Your working directory is `<DEMO_DIR>`.

**You are not allowed to read any source files** — not `app.html`, not `test.spec.ts`, not any `.ts` or `.js` files in the demo or packages. Your only window into what happened is the `introspect` CLI and the package documentation provided below.

## Your task

1. Run the test to generate a trace: `pnpm test`
2. Use `introspect` to investigate — follow the debugging skill below
3. Identify the root cause from trace evidence alone
4. Fix the bug (you may read `app.html` only after you have a confident hypothesis from the trace)
5. Verify the fix: run `pnpm test` again
6. Revert the fix: restore `app.html` to its original buggy state so the demo remains reusable
7. Log the rapport path `<RAPPORT_PATH>` in your final response

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

## introspect commands

Run as: `pnpm exec introspect <command> --dir .introspect`

## Debugging skill

<README_CONTENTS:introspect-debug-skill>

## Package documentation

<README_CONTENTS:playwright>

<README_CONTENTS:cli>

<README_CONTENTS:plugin-webgl>

---

After the agent completes, share the rapport path `<RAPPORT_PATH>` with the user and summarise:
- What signals the agent found in the trace
- Whether it needed to read source code or reasoned from the trace alone
- Any points where the workflow felt incomplete or the agent got stuck
