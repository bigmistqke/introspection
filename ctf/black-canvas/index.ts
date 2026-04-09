const canvas = document.getElementById('canvas') as HTMLCanvasElement
const gl = canvas.getContext('webgl')!

const vsSource = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`
const fsSource = `
  precision mediump float;
  void main() {
    gl_FragColor = vec4(0.2, 0.6, 1.0, 1.0);
  }
`

function compileShader(type: number, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

const program = gl.createProgram()!
gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vsSource))
gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fsSource))
gl.linkProgram(program)
gl.useProgram(program)

const positionBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)

const positionAttr = gl.getAttribLocation(program, 'position')
gl.enableVertexAttribArray(positionAttr)
gl.vertexAttribPointer(positionAttr, 2, gl.FLOAT, false, 0, 0)

let vertexCount = 0

function render() {
  gl.clearColor(0.0, 0.0, 0.0, 1.0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, vertexCount)
  requestAnimationFrame(render)
}
render()

class SceneLoader {
  async load(url: string) {
    const response = await fetch(url)
    const scene = await response.json()
    const { meshes = [] } = scene
    const mesh = meshes.find((m: { name: string }) => m.name === 'main') || null
    this.buildGeometry(mesh)
  }

  buildGeometry(mesh: { position: number[] } | null) {
    const positions = new Float32Array(mesh!.position)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    vertexCount = positions.length / 2
  }
}

const loader = new SceneLoader()
loader.load('/api/scene/1')
