export type IntrospectErrorSource = 'cdp' | 'write' | 'parse' | 'plugin'

export class IntrospectError extends Error {
  source: IntrospectErrorSource
  override cause?: unknown

  constructor(source: IntrospectErrorSource, message: string, cause?: unknown) {
    super(message)
    this.source = source
    this.cause = cause
    this.name = this.constructor.name
  }
}

export class CdpError extends IntrospectError {
  method: string

  constructor(method: string, message: string, cause?: unknown) {
    super('cdp', `CDP ${method}: ${message}`, cause)
    this.method = method
  }
}

export class WriteError extends IntrospectError {
  operation: 'append' | 'write-asset' | 'init' | 'finalize'

  constructor(operation: 'append' | 'write-asset' | 'init' | 'finalize', message: string, cause?: unknown) {
    super('write', `write.${operation}: ${message}`, cause)
    this.operation = operation
  }
}

export class ParseError extends IntrospectError {
  context: string

  constructor(context: string, message: string, cause?: unknown) {
    super('parse', `parse.${context}: ${message}`, cause)
    this.context = context
  }
}

export class PluginError extends IntrospectError {
  pluginName: string

  constructor(pluginName: string, message: string, cause?: unknown) {
    super('plugin', `[${pluginName}] ${message}`, cause)
    this.pluginName = pluginName
  }
}
