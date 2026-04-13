---
name: introspect-reflect
description: Use at the end of a debugging or tool-dogfooding session (or when the user asks "reflect / retro / what did we learn") to review how the introspect CLI was used, identify gaps, and propose concrete fixes. Repo-local — do not bundle.
---

# Reflect on a debugging session

Dogfood review. Turn what just happened into structured feedback on `introspect` itself. This skill exists because the repo builds `introspect`; every debug session here is also a usability test of the tool, and the friction should be captured while it's still fresh.

## When to invoke

- User asks "reflect on this," "retro this," "what did we learn," or similar.
- A debugging task just concluded and the user hasn't moved on.
- **Do not invoke silently mid-task.** Reflection is a session-end activity — running it while debugging is noise.

## What to produce

Write a markdown file at `.claude/reflections/<YYYY-MM-DD>-<slug>.md`. Keep it ≤150 lines. Structure:

```
# <one-sentence summary of the problem debugged>

Date: YYYY-MM-DD

## Flow

<5–10 bullets, chronological. For each step note the tool used: an `introspect` command, a bash workaround (`cat`, `grep`, `tail`), a test-side handler (`page.on`), a file read, etc. Be honest about false starts.>

## Gaps

Categorize each friction point:

- **CLI gap** — introspect doesn't surface this. Proposed fix: `<file path>` — one-line description.
- **Formatter gap** — data is captured but renders badly. Proposed fix: `<file path>` — what to change.
- **Skill gap** — introspect can do this but skills didn't prompt it. Proposed fix: which skill, what to add.
- **Muscle-memory gap** — skill mentions it; it wasn't reached for anyway. No code fix; note as recurring friction.
- **Plugin / types gap** — the captured data itself is missing. Proposed fix: which plugin, what event shape.

## Proposed fixes

<Bullet list, each a concrete path + change type. Do not open PRs — this is backlog.>

## Open questions

<Design questions the reflection surfaced but didn't resolve. One sentence each.>
```

## Honesty rules

- **Record actual behavior, not aspirational.** If `cat .introspect/*/events.ndjson | grep` was used, log it. Do not rewrite history to put `introspect` first.
- **Distinguish "tool didn't have the capability" from "I didn't reach for it."** Former is a CLI gap (fix code). Latter is a muscle-memory gap (no code fix; recurring note).
- **Prefer mechanical fixes over magic.** If the proposed fix is "summarize what went wrong" / "detect render loops" / "classify failure mode," push back in the reflection. Favor: new flag, new formatter branch, new skill line. Dismiss: AI-in-the-loop summaries, heuristic classifiers dressed up as general-purpose features.
- **Don't propose features the user hasn't validated.** If unsure, list under "open questions."

## Do not

- Open a PR.
- Run `introspect skills install` or touch `packages/cli/skills/*`. Bundled skills are a different surface; reflection feeds ideas back to those skills separately.
- Duplicate content from a previous reflection unless the same friction recurred (if so, flag it as recurring — that's signal).

## After writing

- Print the file path.
- Summarise the top 2–3 proposed fixes in one short paragraph, so the user has something actionable without re-reading the file.
