import { useState } from 'react'
import type { StorageAdapter, SessionSummary } from '@introspection/read'
import type { TraceEvent } from '@introspection/types'
import { useSessionReader } from './hooks/useSessionReader.js'

const COLORS: Record<string, string> = {
  'playwright.action': '#6c9cfc',
  'network.request': '#8bc38b',
  'network.response': '#59a359',
  'js.error': '#fc6c6c',
  'console': '#fcb86c',
  'playwright.result': '#c084fc',
  'browser.navigate': '#e0e0e0',
}

const STATUS_COLORS: Record<string, string> = {
  passed: '#8bc38b',
  failed: '#fc6c6c',
  timedOut: '#fcb86c',
  skipped: '#888',
}

function formatEvent(event: TraceEvent): string {
  switch (event.type) {
    case 'playwright.action':
      return `${event.data.method}(${event.data.args.map(argument => JSON.stringify(argument)).join(', ')})`
    case 'network.request':
      return `${event.data.method} ${event.data.url}`
    case 'network.response':
      return `${event.data.status} ${event.data.url}`
    case 'js.error':
      return event.data.message
    case 'console':
      return `[${event.data.level}] ${event.data.message}`
    case 'playwright.result':
      return `${event.data.status ?? 'unknown'}${event.data.duration ? ` (${event.data.duration}ms)` : ''}`
    case 'browser.navigate':
      return `${event.data.from} → ${event.data.to}`
    default:
      return ''
  }
}

export function SessionCard({ adapter, summary }: { adapter: StorageAdapter; summary: SessionSummary }) {
  const [expanded, setExpanded] = useState(false)
  const { events, loading } = useSessionReader(adapter, summary.id)

  const result = events.find(event => event.type === 'playwright.result')
  const status = result?.type === 'playwright.result' ? (result.data.status ?? 'unknown') : (loading ? '...' : 'unknown')
  const duration = summary.duration

  const errorCount = events.filter(event => event.type === 'js.error').length
  const requestCount = events.filter(event => event.type === 'network.request').length
  const actionCount = events.filter(event => event.type === 'playwright.action').length

  return (
    <div style={{
      background: '#111',
      borderRadius: 8,
      borderLeft: `3px solid ${STATUS_COLORS[status] ?? '#888'}`,
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        <span style={{ fontWeight: 500 }}>{summary.label ?? summary.id}</span>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#888' }}>
          {!loading && <>
            <span>{actionCount} actions</span>
            <span>{requestCount} requests</span>
            {errorCount > 0 && <span style={{ color: '#fc6c6c' }}>{errorCount} errors</span>}
          </>}
          {duration != null && <span>{duration}ms</span>}
          <span style={{ color: STATUS_COLORS[status] ?? '#888', fontWeight: 500 }}>{status}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 12px', borderTop: '1px solid #1a1a1a' }}>
          {loading ? (
            <p style={{ color: '#666', fontSize: 12, padding: '8px 0' }}>Loading...</p>
          ) : (
            <div style={{ marginTop: 8 }}>
              {events.map(event => (
                <div key={event.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '50px 1fr',
                  gap: 8,
                  padding: '4px 0',
                  fontSize: 12,
                }}>
                  <span style={{ color: '#555', fontVariantNumeric: 'tabular-nums' }}>{event.timestamp}ms</span>
                  <span style={{ color: COLORS[event.type] ?? '#888' }}>{formatEvent(event)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
