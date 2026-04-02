import { describe, it, expect, vi, afterEach } from 'vitest'
import { createReactPlugin } from '../src/index.js'
import type { BrowserAgent } from '@introspection/types'

type Hook = Record<string, unknown>

function makeAgent(): { agent: BrowserAgent; emitted: unknown[] } {
  const emitted: unknown[] = []
  return { agent: { emit: vi.fn((e: unknown) => { emitted.push(e) }) }, emitted }
}

function makeFiber(name: string, child: unknown = null, sibling: unknown = null) {
  return { type: { displayName: name }, child, sibling }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__']
})

describe('createReactPlugin', () => {
  it('installs __REACT_DEVTOOLS_GLOBAL_HOOK__ when absent', () => {
    const plugin = createReactPlugin()
    const { agent } = makeAgent()
    plugin.browser!.setup(agent)
    expect((globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__']).toBeDefined()
  })

  it('emits plugin.react.commit with component names on fiber commit', () => {
    const plugin = createReactPlugin()
    const { agent, emitted } = makeAgent()
    plugin.browser!.setup(agent)

    const hook = (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as Hook
    const fiberRoot = { current: { type: null, child: makeFiber('App', makeFiber('Header')), sibling: null } }
    ;(hook['onCommitFiberRoot'] as Function)(1, fiberRoot)

    expect(emitted).toHaveLength(1)
    const evt = emitted[0] as { type: string; data: { components: string[] } }
    expect(evt.type).toBe('plugin.react.commit')
    expect(evt.data.components).toContain('App')
    expect(evt.data.components).toContain('Header')
  })

  it('only includes user components (capital-letter names)', () => {
    const plugin = createReactPlugin()
    const { agent, emitted } = makeAgent()
    plugin.browser!.setup(agent)

    const hook = (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as Hook
    const divFiber = { type: 'div', child: makeFiber('Button'), sibling: null }
    ;(hook['onCommitFiberRoot'] as Function)(1, { current: { type: null, child: divFiber, sibling: null } })

    const evt = emitted[0] as { data: { components: string[] } }
    expect(evt.data.components).not.toContain('div')
    expect(evt.data.components).toContain('Button')
  })

  it('chains to an existing onCommitFiberRoot handler', () => {
    const existingFn = vi.fn()
    ;(globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] = {
      isDisabled: false, supportsFiber: true, inject: () => {},
      onCommitFiberRoot: existingFn,
      onCommitFiberUnmount: () => {},
    }

    const plugin = createReactPlugin()
    const { agent } = makeAgent()
    plugin.browser!.setup(agent)

    const hook = (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as Hook
    ;(hook['onCommitFiberRoot'] as Function)(1, { current: { type: null, child: null, sibling: null } })

    expect(existingFn).toHaveBeenCalledOnce()
  })

  it('snapshot returns accumulated mounted component names', () => {
    const plugin = createReactPlugin()
    const { agent } = makeAgent()
    plugin.browser!.setup(agent)

    const hook = (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as Hook
    ;(hook['onCommitFiberRoot'] as Function)(1, { current: { type: null, child: makeFiber('Dashboard'), sibling: null } })

    const snap = plugin.browser!.snapshot() as { mountedComponents: string[] }
    expect(snap.mountedComponents).toContain('Dashboard')
  })
})
