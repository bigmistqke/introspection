export interface PluginSubscription {
  pluginName: string
  spec: unknown
  browserId: string
}

export class PluginRegistry {
  private entries = new Map<string, PluginSubscription>()
  private counter = 0

  add(pluginName: string, spec: unknown, browserId: string): string {
    const id = String(this.counter++)
    this.entries.set(id, { pluginName, spec, browserId })
    return id
  }

  get(id: string): PluginSubscription | undefined {
    return this.entries.get(id)
  }

  remove(id: string): PluginSubscription | undefined {
    const entry = this.entries.get(id)
    this.entries.delete(id)
    return entry
  }

  updateBrowserId(id: string, browserId: string): void {
    const entry = this.entries.get(id)
    if (entry) entry.browserId = browserId
  }

  all(): IterableIterator<[string, PluginSubscription]> {
    return this.entries.entries()
  }
}
