import { connectToSocket } from '../socket-client.js'
import { join } from 'path'

export async function evalExpression(expression: string, outDir: string): Promise<string> {
  const socketPath = join(outDir, '.socket')
  const client = await connectToSocket(socketPath)
  try {
    const result = await client.eval(expression)
    return JSON.stringify(result, null, 2)
  } finally {
    client.close()
  }
}
