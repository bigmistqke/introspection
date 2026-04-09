# CTF — Capture the Flag for AI agents

Each sub-directory is a self-contained challenge: a small browser app with a hidden bug and a failing Playwright test.

The rules are simple — an agent is dropped into one of these directories and must find the bug **without reading the source code**. Its only tool is the `introspect` CLI, which queries the structured trace produced by the test run. The agent works from errors, network responses, DOM snapshots, and scope locals to form a hypothesis, then reads the source only to confirm and fix.

## Running a challenge

```bash
cd ctf/<challenge-name>
pnpm test                          # run the failing test, generates .introspect/
pnpm exec introspect summary --dir .introspect   # start investigating
```

Or use the `/run-ctf` skill to dispatch a debugging agent automatically.

## Creating a challenge

Use the `/create-ctf` skill, or see `.claude/skills/create-ctf/SKILL.md` for the full process.
