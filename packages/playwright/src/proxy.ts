import type { EmitInput, WriteAssetOptions, AssetRef } from '@introspection/types'
import type { Page } from '@playwright/test'

const TRACKED_METHODS = new Set([
  'click', 'fill', 'goto', 'press', 'selectOption', 'check',
  'uncheck', 'hover', 'dragAndDrop', 'evaluate', 'waitForURL', 'waitForSelector',
])

const ARTIFACT_METHODS = new Set(['screenshot'])

type EmitFn = (event: EmitInput) => void

type WriteAssetFn = (options: WriteAssetOptions) => Promise<AssetRef>

export interface PageProxyOptions {
  emit: EmitFn
  writeAsset: WriteAssetFn
  timestamp: () => number
  page: Page
}

export function createPageProxy(options: PageProxyOptions): Page {
  const { emit, writeAsset, timestamp, page } = options
  return new Proxy(page, {
    get(target, prop) {
      const original = target[prop as keyof Page]
      if (typeof original !== 'function') return original

      if (TRACKED_METHODS.has(prop as string)) {
        return (...args: unknown[]) => {
          emit({
            type: 'playwright.action',
            source: 'playwright',
            data: { method: prop as string, args: sanitizeArgs(args) },
          })
          return (original as Function).apply(target, args)
        }
      }

      if (ARTIFACT_METHODS.has(prop as string)) {
        return async (...args: unknown[]) => {
          const result = await (original as Function).apply(target, args)
          if (prop === 'screenshot') {
            const viewport = target.viewportSize()
            const asset = await writeAsset({
              kind: 'screenshot',
              contentType: 'image',
              content: result as Buffer,
              ext: 'png',
              metadata: viewport ? { viewport } : {},
            })
            emit({
              type: 'playwright.screenshot',
              source: 'playwright',
              assets: [asset],
              data: {},
            })
          }
          return result
        }
      }

      return original
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
