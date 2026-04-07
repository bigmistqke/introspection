import { describe, it, expect } from 'vitest'
import { createBus } from '../src/bus.js'

declare module '@introspection/types' {
  interface BusPayloadMap {
    'test.ping': { trigger: 'test.ping'; value: number }
  }
}

describe('createBus', () => {
  it('calls handlers with the emitted payload', async () => {
    const bus = createBus()
    const received: number[] = []

    bus.on('test.ping', payload => {
      received.push(payload.value)
    })

    await bus.emit('test.ping', { trigger: 'test.ping', value: 42 })

    expect(received).toEqual([42])
  })

  it('awaits async handlers before emit resolves', async () => {
    const bus = createBus()
    const order: string[] = []

    bus.on('test.ping', async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 10))
      order.push('handler done')
    })

    await bus.emit('test.ping', { trigger: 'test.ping', value: 1 })
    order.push('emit resolved')

    expect(order).toEqual(['handler done', 'emit resolved'])
  })

  it('does not prevent other handlers from running when one throws', async () => {
    const bus = createBus()
    const called: string[] = []

    bus.on('test.ping', () => {
      throw new Error('handler error')
    })

    bus.on('test.ping', () => {
      called.push('second handler')
    })

    await bus.emit('test.ping', { trigger: 'test.ping', value: 0 })

    expect(called).toEqual(['second handler'])
  })
})
