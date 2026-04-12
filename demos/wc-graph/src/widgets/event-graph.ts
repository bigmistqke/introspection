import type { TraceEvent } from '@introspection/types'

const COLORS: Record<string, string> = {
  'playwright.action': '#6c9cfc',
  'network.request': '#8bc38b',
  'network.response': '#59a359',
  'js.error': '#fc6c6c',
  'console': '#fcb86c',
  'playwright.result': '#c084fc',
  'browser.navigate': '#e0e0e0',
}

function summarizeEvent(event: TraceEvent): string {
  switch (event.type) {
    case 'playwright.action':
      return `${event.metadata.method}()`
    case 'network.request':
      return `${event.metadata.method} ${event.metadata.url.split('/').pop()}`
    case 'network.response':
      return `${event.metadata.status} ${event.metadata.url.split('/').pop()}`
    case 'js.error':
      return event.metadata.message.slice(0, 25)
    case 'console':
      return `[${event.metadata.level}] ${event.metadata.message}`.slice(0, 25)
    case 'playwright.result':
      return `${event.metadata.status ?? 'unknown'}`
    case 'browser.navigate':
      return event.metadata.to.split('/').pop() ?? ''
    default:
      return ''
  }
}

interface GraphNode {
  event: TraceEvent
  x: number
  y: number
  column: number
}

class EventGraph extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; background: #111; border-radius: 8px; overflow: auto; }
        canvas { display: block; }
        .tooltip {
          position: absolute;
          background: #222;
          border: 1px solid #333;
          border-radius: 4px;
          padding: 8px 12px;
          font-size: 12px;
          color: #ccc;
          pointer-events: none;
          display: none;
          max-width: 400px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
      <canvas></canvas>
      <div class="tooltip"></div>
    `
  }

  load(events: TraceEvent[]) {
    const canvas = this.shadowRoot!.querySelector('canvas')!
    const tooltip = this.shadowRoot!.querySelector('.tooltip') as HTMLElement
    const context = canvas.getContext('2d')!

    const nodes = this.#layout(events)
    const maxColumn = Math.max(...nodes.map(node => node.column))
    const nodeWidth = 160
    const nodeHeight = 32
    const horizontalGap = 40
    const verticalGap = 16

    canvas.width = (maxColumn + 1) * (nodeWidth + horizontalGap) + 80
    canvas.height = nodes.length * (nodeHeight + verticalGap) + 60

    // Draw edges
    const nodeMap = new Map(nodes.map(node => [node.event.id, node]))
    for (const node of nodes) {
      if (!node.event.initiator) continue
      const parent = nodeMap.get(node.event.initiator)
      if (!parent) continue

      context.beginPath()
      context.moveTo(parent.x + nodeWidth, parent.y + nodeHeight / 2)

      const midX = (parent.x + nodeWidth + node.x) / 2
      context.bezierCurveTo(
        midX, parent.y + nodeHeight / 2,
        midX, node.y + nodeHeight / 2,
        node.x, node.y + nodeHeight / 2
      )

      context.strokeStyle = '#333'
      context.lineWidth = 1.5
      context.stroke()
    }

    // Draw nodes
    for (const node of nodes) {
      const color = COLORS[node.event.type] ?? '#888'
      // Node background
      context.fillStyle = '#1a1a1a'
      context.beginPath()
      context.roundRect(node.x, node.y, nodeWidth, nodeHeight, 4)
      context.fill()

      // Left color bar
      context.fillStyle = color
      context.beginPath()
      context.roundRect(node.x, node.y, 3, nodeHeight, [4, 0, 0, 4])
      context.fill()

      // Type label
      context.fillStyle = color
      context.font = '500 11px system-ui'
      context.fillText(node.event.type, node.x + 10, node.y + 13)

      // Summary
      context.fillStyle = '#888'
      context.font = '10px system-ui'
      context.fillText(summarizeEvent(node.event), node.x + 10, node.y + 25, nodeWidth - 16)
    }

    // Tooltip on hover
    canvas.addEventListener('mousemove', (mouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const mouseX = mouseEvent.clientX - rect.left
      const mouseY = mouseEvent.clientY - rect.top

      const hovered = nodes.find(node =>
        mouseX >= node.x && mouseX <= node.x + nodeWidth &&
        mouseY >= node.y && mouseY <= node.y + nodeHeight
      )

      if (hovered) {
        tooltip.textContent = `${hovered.event.type} @ ${hovered.event.timestamp}ms — ${JSON.stringify(hovered.event.metadata ?? {})}`
        tooltip.style.display = 'block'
        tooltip.style.left = `${mouseEvent.clientX - rect.left + 12}px`
        tooltip.style.top = `${mouseEvent.clientY - rect.top - 30}px`
      } else {
        tooltip.style.display = 'none'
      }
    })
  }

  #layout(events: TraceEvent[]): GraphNode[] {
    const nodes: GraphNode[] = []
    const nodeWidth = 160
    const horizontalGap = 40
    const nodeHeight = 32
    const verticalGap = 16
    const paddingX = 40
    const paddingY = 30

    // Assign columns: roots get column 0, children get parent.column + 1
    const columnMap = new Map<string, number>()

    for (const event of events) {
      const parentColumn = event.initiator ? (columnMap.get(event.initiator) ?? 0) : 0
      const column = event.initiator ? parentColumn + 1 : 0
      columnMap.set(event.id, column)
    }

    // Place nodes vertically in event order, horizontally by column
    for (let index = 0; index < events.length; index++) {
      const event = events[index]
      const column = columnMap.get(event.id) ?? 0
      nodes.push({
        event,
        column,
        x: paddingX + column * (nodeWidth + horizontalGap),
        y: paddingY + index * (nodeHeight + verticalGap),
      })
    }

    return nodes
  }
}

customElements.define('event-graph', EventGraph)
