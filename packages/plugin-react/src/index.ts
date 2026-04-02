import type { IntrospectionPlugin, BrowserAgent } from '@introspection/types'

interface ReactFiber {
  type: unknown
  child: ReactFiber | null
  sibling: ReactFiber | null
}

interface ReactFiberRoot {
  current: ReactFiber
}

type DevToolsHook = Record<string, unknown>

function getFiberName(fiber: ReactFiber): string | null {
  const t = fiber.type
  if (typeof t === 'string') return t
  if (typeof t === 'function') return (t as { displayName?: string; name?: string }).displayName || (t as { name?: string }).name || null
  if (t && typeof t === 'object' && 'displayName' in t) return (t as { displayName: string }).displayName
  return null
}

function walkFiber(fiber: ReactFiber | null, names: string[], depth = 0): void {
  if (!fiber || depth > 30) return
  const name = getFiberName(fiber)
  if (name && /^[A-Z]/.test(name)) names.push(name)
  walkFiber(fiber.child, names, depth + 1)
  walkFiber(fiber.sibling, names, depth + 1)
}

export function createReactPlugin(): IntrospectionPlugin {
  const mountedComponents = new Set<string>()

  return {
    name: 'react',
    browser: {
      setup(agent: BrowserAgent) {
        const g = globalThis as Record<string, unknown>

        if (!g['__REACT_DEVTOOLS_GLOBAL_HOOK__']) {
          g['__REACT_DEVTOOLS_GLOBAL_HOOK__'] = {
            isDisabled: false,
            supportsFiber: true,
            inject: () => {},
            onScheduleFiberRoot: () => {},
            onCommitFiberRoot: () => {},
            onCommitFiberUnmount: () => {},
          }
        }

        const hook = g['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as DevToolsHook
        const prevCommit = hook['onCommitFiberRoot'] as ((...args: unknown[]) => void) | undefined
        const prevUnmount = hook['onCommitFiberUnmount'] as ((...args: unknown[]) => void) | undefined

        hook['onCommitFiberRoot'] = (...args: unknown[]) => {
          prevCommit?.(...args)
          const fiberRoot = args[1] as ReactFiberRoot | undefined
          if (!fiberRoot?.current) return
          const names: string[] = []
          walkFiber(fiberRoot.current.child, names)
          for (const n of names) mountedComponents.add(n)
          if (names.length > 0) {
            agent.emit({ type: 'plugin.react.commit', data: { components: names } })
          }
        }

        hook['onCommitFiberUnmount'] = (...args: unknown[]) => {
          prevUnmount?.(...args)
          const fiber = args[0] as ReactFiber | undefined
          if (!fiber) return
          const name = getFiberName(fiber)
          if (name) mountedComponents.delete(name)
        }
      },

      snapshot() {
        return { mountedComponents: [...mountedComponents] }
      },
    },
  }
}
