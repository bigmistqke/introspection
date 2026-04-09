import { describe, it, expect } from 'vitest'
import { createBus } from '../src/bus.js'

describe('createBus', () => {
  it('calls handlers with the emitted payload', async () => {
    const bus = createBus()
    const received: number[] = []

    bus.on('manual', payload => {
      received.push(payload.timestamp)
    })

    await bus.emit('manual', { trigger: 'manual', timestamp: 42 })

    expect(received).toEqual([42])
  })

  it('awaits async handlers before emit resolves', async () => {
    const bus = createBus()
    const order: string[] = []

    bus.on('manual', async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 10))
      order.push('handler done')
    })

    await bus.emit('manual', { trigger: 'manual', timestamp: 1 })
    order.push('emit resolved')

    expect(order).toEqual(['handler done', 'emit resolved'])
  })

  it('does not prevent other handlers from running when one throws', async () => {
    const bus = createBus()
    const called: string[] = []

    bus.on('manual', () => {
      throw new Error('handler error')
    })

    bus.on('manual', () => {
      called.push('second handler')
    })

    await bus.emit('manual', { trigger: 'manual', timestamp: 0 })

    expect(called).toEqual(['second handler'])
  })
})
