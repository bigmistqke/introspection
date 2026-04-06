import { describe, it, expectTypeOf } from 'vitest'
import type { TraceEvent, OnErrorSnapshot, DetachResult } from '../src/index.js'

describe('@introspection/types 2.0', () => {
  it('TraceEvent does not include PluginEvent or SessionEndEvent', () => {
    type NoPlugin = Extract<TraceEvent, { type: `plugin.${string}` }>
    type NoSessionEnd = Extract<TraceEvent, { type: 'session.end' }>
    expectTypeOf<NoPlugin>().toBeNever()
    expectTypeOf<NoSessionEnd>().toBeNever()
  })

  it('OnErrorSnapshot trigger is limited to js.error | manual', () => {
    type Trigger = OnErrorSnapshot['trigger']
    expectTypeOf<'js.error'>().toMatchTypeOf<Trigger>()
    expectTypeOf<'manual'>().toMatchTypeOf<Trigger>()
    expectTypeOf<Trigger>().not.toEqualTypeOf<'playwright.assertion'>()
  })

  it('DetachResult has simplified status union', () => {
    type Status = DetachResult['status']
    expectTypeOf<Status>().toEqualTypeOf<'passed' | 'failed' | 'timedOut'>()
  })

  it('AssetEvent is in TraceEvent union', () => {
    type Asset = Extract<TraceEvent, { type: 'asset' }>
    expectTypeOf<Asset>().not.toBeNever()
  })
})
