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

Then launch a general-purpose agent with this prompt (substituting `<DEMO_DIR>` with the absolute path and `<README_CONTENTS>` with the file contents read above):

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

## RAPPORT.md — write as you go

Maintain `RAPPORT.md` in the demo directory throughout your investigation. For every command you run, append:

- **Why** you chose this command at this moment
- **What** the output told you
- **What** you decided to do next

This is a running log written in real time, not a summary at the end. It documents your debugging mindset so the workflow can be evaluated and improved.

## introspect commands

Run as: `node /Users/puckey/rg/introspection/packages/cli/dist/index.js <command> --dir .introspect`

## Debugging skill

<README_CONTENTS:introspect-debug-skill>

## Package documentation

<README_CONTENTS:playwright>

<README_CONTENTS:cli>

<README_CONTENTS:plugin-webgl>

---

After the agent completes, read `RAPPORT.md` and summarise to the user:
- What signals the agent found in the trace
- Whether it needed to read source code or reasoned from the trace alone
- Any points where the workflow felt incomplete or the agent got stuck
