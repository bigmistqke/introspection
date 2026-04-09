import { test, expect } from '@playwright/test'
import { debuggerPlugin } from '@introspection/plugin-debugger'

test.describe('debuggerPlugin', () => {
  test('returns a valid plugin object', () => {
    const plugin = debuggerPlugin()
    expect(plugin.name).toBe('debugger')
    expect(plugin.description).toBeDefined()
    expect(typeof plugin.install).toBe('function')
  })

  test('accepts pauseOnExceptions option', () => {
    const pluginAll = debuggerPlugin({ pauseOnExceptions: 'all' })
    expect(pluginAll.options?.pauseOnExceptions.value).toBe('all')

    const pluginUncaught = debuggerPlugin({ pauseOnExceptions: 'uncaught' })
    expect(pluginUncaught.options?.pauseOnExceptions.value).toBe('uncaught')
  })

  test('accepts breakpoints option', () => {
    const plugin = debuggerPlugin({
      breakpoints: [
        { url: 'app.js', line: 42 },
        { url: 'utils.js', line: 10, condition: 'user == null' },
      ],
    })
    expect(plugin.options).toBeDefined()
  })

  test('has events metadata', () => {
    const plugin = debuggerPlugin()
    expect(plugin.events).toBeDefined()
    expect(plugin.events?.scopes).toBeDefined()
  })

  test('has options metadata', () => {
    const plugin = debuggerPlugin()
    expect(plugin.options).toBeDefined()
    expect(plugin.options?.pauseOnExceptions.description).toBeDefined()
  })
})
