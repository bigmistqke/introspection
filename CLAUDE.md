See [CONTRIBUTING.md](./CONTRIBUTING.md) for TypeScript and testing conventions.

## Dogfood the `introspect` tooling

This repo builds `introspect`. **Use it aggressively** — both as a way to surface bugs in the tooling and to build muscle memory for the CLI.

- When a Playwright test fails or behaves unexpectedly, reach for `introspect summary` / `introspect events --type <pattern>` / `introspect assets` **before** `page.on('console')`, `cat .introspect/*/events.ndjson`, or adding `console.log` instrumentation. If the existing captured events don't answer the question, that's a gap worth noting and fixing.
- When writing a new plugin, query your own events with the CLI while developing — don't inspect ndjson by hand.
- If you find yourself reaching for a bash/grep workaround because the CLI doesn't expose what you need, that's feedback about the tool. Flag it explicitly so we can improve the surface (a missing flag, a missing subcommand, a missing heuristic).

The skills at `.claude/skills/introspect-*` document the available commands — invoke them (`introspect-debug`, `introspect-setup`, `introspect-plugin`) rather than rediscovering the CLI each session.
