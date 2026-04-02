import type { PlaywrightActionEvent } from '@introspection/types'
import type { Page } from '@playwright/test'

const TRACKED_METHODS = new Set([
  'click', 'fill', 'goto', 'press', 'selectOption', 'check',
  'uncheck', 'hover', 'dragAndDrop', 'evaluate', 'waitForURL', 'waitForSelector',
])

type EmitFn = (event: Omit<PlaywrightActionEvent, 'id' | 'ts'>) => void

export function createPageProxy(page: Page, emit: EmitFn): Page {
  return new Proxy(page, {
    get(target, prop) {
      const original = target[prop as keyof Page]
      if (typeof original !== 'function' || !TRACKED_METHODS.has(prop as string)) {
        return original
      }
      return (...args: unknown[]) => {
        emit({
          type: 'playwright.action',
          source: 'playwright',
          data: { method: prop as string, args: sanitizeArgs(args) },
        })
        return (original as Function).apply(target, args)
      }
    },
  })
}

function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map(arg => {
    if (arg === null || arg === undefined) return arg
    if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') return arg
    if (typeof arg === 'object') {
      try { return JSON.parse(JSON.stringify(arg)) } catch { return '[unserializable]' }
    }
    return '[function]'
  })
}
