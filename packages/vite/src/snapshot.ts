import type { OnErrorSnapshot, IntrospectionPlugin, ScopeFrame } from '@introspection/types'

interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}

interface CallFrame {
  callFrameId: string
  functionName: string
  url: string
  location: { scriptId: string; lineNumber: number; columnNumber: number }
  scopeChain: Array<{ type: string; object: { objectId?: string } }>
}

interface TakeSnapshotOptions {
  cdpSession: CdpSession
  trigger: OnErrorSnapshot['trigger']
  url: string
  callFrames: CallFrame[]
  plugins: IntrospectionPlugin[]
}

export async function takeSnapshot(options: TakeSnapshotOptions): Promise<OnErrorSnapshot> {
  const { cdpSession, trigger, url, callFrames, plugins } = options

  // DOM
  let dom = ''
  try {
    const { root } = await cdpSession.send('DOM.getDocument') as { root: { nodeId: number } }
    const { outerHTML } = await cdpSession.send('DOM.getOuterHTML', { nodeId: root.nodeId }) as { outerHTML: string }
    dom = outerHTML
  } catch { /* non-fatal */ }

  // Scope chain
  const scopes: ScopeFrame[] = []
  for (const frame of callFrames.slice(0, 5)) {
    const vars: Record<string, unknown> = {}
    for (const scope of frame.scopeChain.slice(0, 3)) {
      if (!scope.object.objectId) continue
      try {
        const { result } = await cdpSession.send('Runtime.getProperties', {
          objectId: scope.object.objectId,
          ownProperties: true,
        }) as { result: Array<{ name: string; value?: { value?: unknown; description?: string } }> }
        for (const prop of result.slice(0, 20)) {
          vars[prop.name] = prop.value?.value ?? prop.value?.description ?? undefined
        }
      } catch { /* non-fatal */ }
    }
    scopes.push({ frame: `${frame.functionName} (${frame.url}:${frame.location.lineNumber + 1})`, vars })
  }

  // Key globals
  const globals: Record<string, unknown> = {}
  for (const expr of ['location.pathname', 'localStorage', 'sessionStorage']) {
    try {
      const { result } = await cdpSession.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        silent: true,
      }) as { result: { value?: unknown } }
      globals[expr] = result.value
    } catch { /* non-fatal */ }
  }

  // Plugin extensions — pass assembled snapshot (without plugins to avoid circularity)
  const partialSnapshot = { ts: Date.now(), trigger, url, dom, scopes, globals, plugins: {} }
  const pluginData: Record<string, unknown> = {}
  for (const plugin of plugins) {
    if (plugin.server?.extendSnapshot) {
      try {
        pluginData[plugin.name] = await Promise.resolve(plugin.server.extendSnapshot(partialSnapshot))
      } catch { /* non-fatal */ }
    }
  }

  return { ...partialSnapshot, plugins: pluginData }
}
