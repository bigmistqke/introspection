export type IntrospectErrorSource = 'cdp' | 'write' | 'parse' | 'plugin'

export class IntrospectError extends Error {
  constructor(public source: IntrospectErrorSource, message: string, public cause?: unknown) {
    super(message)
    this.name = this.constructor.name
  }
}

export class CdpError extends IntrospectError {
  constructor(public method: string, message: string, cause?: unknown) {
    super('cdp', `CDP ${method}: ${message}`, cause)
  }
}

export class WriteError extends IntrospectError {
  constructor(public operation: 'append' | 'write-asset' | 'init' | 'finalize', message: string, cause?: unknown) {
    super('write', `write.${operation}: ${message}`, cause)
  }
}

export class ParseError extends IntrospectError {
  constructor(public context: string, message: string, cause?: unknown) {
    super('parse', `parse.${context}: ${message}`, cause)
  }
}

export class PluginError extends IntrospectError {
  constructor(public pluginName: string, message: string, cause?: unknown) {
    super('plugin', `[${pluginName}] ${message}`, cause)
  }
}
