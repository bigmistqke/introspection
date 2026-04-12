# Plugin README Template

This document describes the standard structure for Introspection plugin README files. All plugins should follow this template for consistency.

## Template Structure

```markdown
# @introspection/plugin-{name}

{One-line description of what the plugin captures}

{2-3 sentence explanation of how it works and when to use it}

## Table of Contents

- [Install](#install)
- [Usage](#usage)
{- [Options](#options)                    # if plugin has options}
{- [What it captures](#what-it-captures)   # or "What it emits"}
{- [Events emitted](#events-emitted)       # if it emits structured events}
{- [Additional sections](#additional)     # Caveats, How it works, etc.}

## Install

\`\`\`bash
pnpm add -D @introspection/plugin-{name}
\`\`\`

## Usage

\`\`\`ts
import { attach } from '@introspection/playwright'
import { {pluginFunction} } from '@introspection/plugin-{name}'

const handle = await attach(page, { plugins: [{pluginFunction}()] })
\`\`\`

{Additional usage notes if needed}

{## Options (if applicable)

\`\`\`ts
{pluginFunction}({
  option1?: boolean,     // description
  option2?: string,      // description
})
\`\`\`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `option1` | `boolean` | `true` | ... |
| `option2` | `string` | `...` | ... |
}

{## What it captures (or "What it emits")

| Event type | Description |
|------------|-------------|
| `event.type` | Brief description |

\`\`\`ts
{
  id: string
  timestamp: number
  type: 'event.type'
  metadata: {
    field1: type
    field2: type
  }
}
\`\`\`
}

{## Bus augmentation (optional, if plugin emits on the bus)

This plugin augments \`BusPayloadMap\` with custom triggers:

\`\`\`ts
interface BusPayloadMap {
  'trigger.name': { trigger: 'trigger.name'; timestamp: number; ... }
}
\`\`\`

Other plugins can react by subscribing:

\`\`\`ts
ctx.bus.on('trigger.name', async (payload) => {
  // react to event
})
\`\`\`
}

{## Additional sections

Caveats, limitations, how it works, supported libraries, etc.}
```

## Key Guidelines

### Description
- **Line 1**: One sentence, action-oriented (what it captures)
- **Paragraph**: 2-3 sentences explaining context, requirements, or use cases

### Table of Contents
- Link to all H2 sections
- Keep only relevant sections (don't include optional ones you're not using)
- Order: Install, Usage, Options (if any), Events/Captures, Caveats/Additional

### Install
- Always `pnpm add -D @introspection/plugin-{name}`
- Single code block, no variations

### Usage
- Start with import + attach pattern
- Show minimal example that demonstrates the plugin is working
- Include additional examples if there are common patterns

### Options (if applicable)
- Use TypeScript code block to show all options
- Follow with table showing Type, Default, and Description
- Mark optional fields with `?`

### Events/Captures
- Use consistent structure with `id`, `timestamp`, `type`, `metadata`
- Never use `source` or `data` fields (outdated)
- Include table of event types with descriptions
- Show full event structure in TypeScript

### Additional Sections
- **Caveats**: Limitations, gotchas, when NOT to use
- **How it works**: Internal mechanism, if helpful for users
- **Supported libraries**: For plugins that work with multiple tools
- **Assets**: For plugins that write snapshot assets
- **API methods**: For plugins that expose methods beyond install

## Event Schema

All events follow this structure:

```ts
{
  id: string                    // unique event identifier
  timestamp: number             // ms since test start
  initiator?: string            // id of event that caused this
  pageId?: string               // which page emitted this
  assets?: AssetRef[]           // associated files
  type: 'event.type'            // the specific event type
  metadata: {                   // event-specific data
    field1: type
    field2: type
  }
}
```

**Never include**:
- `source: 'plugin'` (removed field)
- `data` (renamed to `metadata`)

## Sections Checklist

For each plugin README, use this checklist:

- [ ] Title with `@introspection/plugin-{name}`
- [ ] One-line description
- [ ] 2-3 sentence explanation
- [ ] Table of Contents (only sections you use)
- [ ] Install with correct command
- [ ] Usage example that works out-of-box
- [ ] Options table (if applicable, with Type/Default/Description)
- [ ] Events/Captures with table and example structure
- [ ] All event examples use `metadata`, not `data`
- [ ] All event examples include `id`, `timestamp`, `type`, `metadata`
- [ ] No `source: 'plugin'` in any event examples
- [ ] Bus augmentation section (if plugin emits on the bus)
- [ ] Bus trigger examples show correct structure (`trigger`, `timestamp`, other fields)
- [ ] Instructions for other plugins to subscribe
- [ ] Additional sections as needed (Caveats, How it works, etc.)
