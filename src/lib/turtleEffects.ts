/**
 * Auras and trails exactly as the TurtleClient draws them: a port of the client's
 * `turtle_auras.rs` and `turtle_trails.rs` (horizon-client-render), with the same sprite
 * atlases, patterns, colours and timing. Camera-facing quads are rebuilt every frame.
 *
 * Units are blocks (the client's) inside a group scaled by 16, so the effect sits in
 * Minecraft pixels with the player's feet at y = 0.
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, NearestFilter, Quaternion, SRGBColorSpace, Texture, Vector3 } from 'three'
import type { Camera } from 'three'

export interface TurtleEffect {
  object: Group
  /** Seconds since the effect started; without calls the effect keeps its own clock. */
  update(t: number): void
  dispose(): void
}

/* ---------- Catalogue, as in horizon-cosmetics::turtle_catalog ---------- */

const AURAS = ['rain_aura', 'money_aura', 'plus_aurora', 'plus_stardust', 'demon_aura', 'angel_aura', 'husky_aura']
const TRAILS = ['demon_trail', 'angel_trail', 'husky_trail']
const INFERNO = 4
const CELESTIAL = 5
const SNOW_TRAIL = 6
const TRAIL_LIFE = 2.2

/** Monthly Plus rewards keep their base style: `plus_aurora_2026_11`. */
export function auraStyle(id: string): number | null {
  const index = AURAS.findIndex(base => id === base || (base.startsWith('plus_') && id.startsWith(base) && /^_[0-9_]{7}$/.test(id.slice(base.length))))
  return index < 0 ? null : index
}
export const trailStyle = (id: string): number | null => (TRAILS.includes(id) ? TRAILS.indexOf(id) : null)

/* ---------- Atlases ---------- */

const loaded = new Map<string, Promise<HTMLCanvasElement>>()
function image(url: string): Promise<HTMLCanvasElement> {
  let pending = loaded.get(url)
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        c.getContext('2d')?.drawImage(img, 0, 0)
        resolve(c)
      }
      img.onerror = reject
      img.src = url
    })
    loaded.set(url, pending)
  }
  return pending
}
function texture(canvas: HTMLCanvasElement): Texture {
  const t = new Texture(canvas)
  t.flipY = false
  t.magFilter = NearestFilter
  t.minFilter = NearestFilter
  t.generateMipmaps = false
  t.colorSpace = SRGBColorSpace
  t.needsUpdate = true
  return t
}
const AURA_ATLAS = '/turtle/aura-sprites.png'
const BUNDLE_ATLAS = '/turtle/bundle-aura-sprites.png'
const INFERNO_ATLAS = '/turtle/inferno-sprites.png'

/** Trails draw plain quads and neutral flames tinted by their colour: one 80x28 sheet. */
async function trailSheet(): Promise<HTMLCanvasElement> {
  const inferno = await image(INFERNO_ATLAS)
  const c = document.createElement('canvas')
  c.width = 80
  c.height = 28
  const x = c.getContext('2d')
  if (!x) return c
  x.drawImage(inferno, 0, 0)
  // Neutral copy, as the client's dye sprites: brightness only, so the tint gives the colour.
  const data = x.getImageData(0, 0, 80, 24)
  for (let i = 0; i < data.data.length; i += 4) {
    const peak = Math.max(data.data[i], data.data[i + 1], data.data[i + 2])
    data.data[i] = data.data[i + 1] = data.data[i + 2] = peak
  }
  x.putImageData(data, 0, 0)
  x.fillStyle = '#ffffff'
  x.fillRect(0, 24, 4, 4)
  return c
}

/* ---------- Dynamic quad mesh ---------- */

type Rgb = [number, number, number]
interface QuadSink {
  quad(center: Vector3, x: Vector3, y: Vector3, uv: [number, number, number, number], rgb: Rgb, opacity: number): void
}

function quadMesh(capacity: number) {
  const positions = new Float32Array(capacity * 4 * 3)
  const uvs = new Float32Array(capacity * 4 * 2)
  const colors = new Float32Array(capacity * 4 * 4)
  const index = new Uint16Array(capacity * 6)
  for (let q = 0; q < capacity; q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new BufferAttribute(colors, 4))
  geometry.setIndex(new BufferAttribute(index, 1))
  const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, alphaTest: 0.01 })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.visible = false
  let count = 0
  const linear = new Color()
  const corner = new Vector3()
  const sink: QuadSink = {
    quad(center, x, y, [u0, v0, u1, v1], rgb, opacity) {
      if (count >= capacity) return
      linear.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, SRGBColorSpace)
      const a = Math.max(0, Math.min(1, opacity))
      const corners: [number, number, number, number][] = [[1, -1, u1, v1], [1, 1, u1, v0], [-1, 1, u0, v0], [-1, -1, u0, v1]]
      corners.forEach(([sx, sy, u, v], k) => {
        const i = count * 4 + k
        corner.copy(center).addScaledVector(x, sx).addScaledVector(y, sy)
        positions.set([corner.x, corner.y, corner.z], i * 3)
        uvs.set([u, v], i * 2)
        colors.set([linear.r, linear.g, linear.b, a], i * 4)
      })
      count++
    },
  }
  return {
    mesh,
    sink,
    begin() {
      count = 0
    },
    end() {
      geometry.setDrawRange(0, count * 6)
      for (const name of ['position', 'uv', 'color']) geometry.getAttribute(name).needsUpdate = true
    },
    dispose() {
      geometry.dispose()
      material.map?.dispose()
      material.dispose()
    },
  }
}

/** Camera right and up in the mesh's own space, as the client's billboard axes. */
const worldQ = new Quaternion()
function billboard(mesh: Mesh, camera: Camera, right: Vector3, up: Vector3) {
  mesh.getWorldQuaternion(worldQ).invert()
  right.setFromMatrixColumn(camera.matrixWorld, 0).applyQuaternion(worldQ).normalize()
  up.setFromMatrixColumn(camera.matrixWorld, 1).applyQuaternion(worldQ).normalize()
}

function effect(build: (time: number, right: Vector3, up: Vector3, sink: QuadSink) => void, capacity: number, sheet: () => Promise<HTMLCanvasElement>): TurtleEffect {
  const group = new Group()
  group.scale.setScalar(16)
  const quads = quadMesh(capacity)
  group.add(quads.mesh)
  let dead = false
  void sheet().then(canvas => {
    if (dead) return
    quads.mesh.material.map = texture(canvas)
    quads.mesh.material.needsUpdate = true
    quads.mesh.visible = true
  }, () => {})
  const started = performance.now() / 1000
  let manual: number | null = null
  const right = new Vector3()
  const up = new Vector3()
  quads.mesh.onBeforeRender = (_renderer, _scene, camera) => {
    billboard(quads.mesh, camera, right, up)
    quads.begin()
    build(manual ?? performance.now() / 1000 - started, right, up, quads.sink)
    quads.end()
  }
  return {
    object: group,
    update(t) {
      manual = t
    },
    dispose() {
      dead = true
      quads.dispose()
    },
  }
}

/* ---------- Aura: turtle_auras::geometry ---------- */

const fract = (n: number) => n - Math.floor(n)
const TAU = Math.PI * 2

function auraBuild(style: number) {
  const inferno = style === INFERNO
  const [columns, rows, tileHeight] = inferno ? [5, 1, 24] : [3, 2, 16]
  const offset = new Vector3()
  const x = new Vector3()
  const y = new Vector3()
  return (time: number, right: Vector3, up: Vector3, sink: QuadSink) => {
    const sprite = (tile: number, at: [number, number, number], [w, h]: [number, number], roll: number, tint: number) => {
      const a = ((tint >>> 24) & 255) / 255
      const rgb: Rgb = [(tint >>> 16) & 255, (tint >>> 8) & 255, tint & 255]
      const du = 1 / columns
      const dv = 1 / rows
      const u = (tile % columns) * du
      const v = Math.floor(tile / columns) * dv
      const uv: [number, number, number, number] = [u + du / 32, v + dv * (0.5 / tileHeight), u + (du * 31) / 32, v + dv * (1 - 0.5 / tileHeight)]
      const sin = Math.sin(roll)
      const cos = Math.cos(roll)
      x.copy(right).multiplyScalar(cos).addScaledVector(up, sin).multiplyScalar(w * 0.5)
      y.copy(up).multiplyScalar(cos).addScaledVector(right, -sin).multiplyScalar(h * 0.5)
      sink.quad(offset.set(...at), x, y, uv, rgb, a)
    }
    const faded = (opacity: number, color: number) => ((Math.round(Math.max(0, Math.min(1, opacity)) * 255) << 24) >>> 0) | color
    if (style === 0) {
      ;([[-0.43, 0.17, 0.6], [0.0, -0.15, 0.77], [0.46, 0.13, 0.62]] as const).forEach(([cx, cz, size], i) => {
        const bob = Math.sin(time * 1.5 + i) * 0.065
        sprite(0, [cx, 2.25 + bob, cz], [size, size * 0.68], 0, 0xfff0f5ff)
      })
      for (let i = 0; i < 19; i++) {
        const age = fract(time * (0.64 + fract(i * 0.283) * 0.28) + i * 0.619)
        const radial = 0.55 + fract(i * 0.353) * 0.42
        const angle = i * 2.39996
        const px = Math.cos(angle) * radial + age * 0.12
        const pz = Math.sin(angle) * radial
        sprite(1, [px, 2.2 - age * 2.07, pz], [0.135, 0.195], -0.16, faded((1 - age) * 0.36 + 0.56, 0xa6dfff))
        if (age > 0.84) {
          const bloom = (age - 0.84) / 0.16
          sprite(5, [px, 0.09, pz], [0.11 + bloom * 0.14, 0.055 + bloom * 0.05], 0, faded((1 - bloom) * 0.65, 0x9edcff))
        }
      }
    } else if (style === 1) {
      for (let i = 0; i < 14; i++) {
        const age = fract(time * 0.57 + i * (1 / Math.PI))
        const angle = i * 2.39996 + time * 1.09 + age * 1.2
        const radius = 0.84 + 0.16 * Math.sin(angle + i)
        const flip = Math.abs(Math.cos(time * 5.4 + i * 1.41)) * 0.82 + 0.18
        const roll = Math.sin(time * 2.7 + i * 1.3) * 0.75
        const opacity = Math.min(age * 12, (1 - age) * 7, 1)
        const at: [number, number, number] = [Math.cos(angle) * radius, 2.15 - 1.96 * age, Math.sin(angle) * radius]
        const coin = i % 4 === 0
        const [tile, size, tint] = coin ? [3, 0.237, 0xffeb9d] : [2, 0.335, 0xffffff]
        sprite(tile, at, [size * flip, size], roll, faded(opacity, tint))
        if (coin) sprite(4, [at[0] + 0.08, at[1] + 0.14, at[2]], [0.13, 0.13], 0, faded(opacity, 0xffd079))
      }
    } else if (style === INFERNO) {
      const count = 9
      for (let i = 0; i < count; i++) {
        const phase = i * 1.77
        const angle = (i * TAU) / count + 0.11 * Math.sin(time + phase)
        const radius = 0.55 + 0.13 * Math.sin(phase)
        const flicker = Math.sin(time * 7.6 + phase) * 0.5 + 0.5
        const height = 0.37 + 0.34 * flicker + 0.13 * Math.sin(phase * 1.13)
        const frame = Math.floor(time * 12 + phase * 1.8) % 4
        sprite(frame, [Math.cos(angle) * radius, 0.025 + height * 0.47, Math.sin(angle) * radius], [0.29 + flicker * 0.12, height], 0.12 * Math.sin(time * 5 + phase), faded(0.78 + 0.17 * flicker, 0xffffff))
      }
      for (let i = 0; i < 14; i++) {
        const age = fract(time * (0.63 + fract(i * 0.28) * 0.28) + i * 0.618)
        const angle = i * 2.39996 + age * (1.2 + Math.sin(i * 0.72))
        const radius = 0.42 + age * 0.58 + Math.sin(i * 1.7) * 0.14
        const size = 0.17 - age * 0.085
        const fade = Math.min(age * 12, (1 - age) * 3.5, 1)
        sprite(4, [Math.cos(angle) * radius, 0.33 + age * 1.78, Math.sin(angle) * radius], [size, size * 1.4], 0.35 * Math.sin(angle), faded(fade, 0xffffff))
      }
    } else if (style === CELESTIAL) {
      const count = 15
      for (let i = 0; i < count; i++) {
        const phase = i * 2.39996
        const age = fract(time * 0.52 + i * 0.173)
        const angle = phase + time * 1.08 + age * 1.55
        const radius = 0.55 + 0.25 * Math.abs(Math.sin(age * TAU))
        const fade = Math.min(age * 7, (1 - age) * 5, 1)
        const star = i % 3 === 0
        const [tile, size, spin] = star ? [1, 0.15 + age * 0.12, phase + time * 0.7] : [0, 0.22, Math.sin(phase + time * 1.8) * 0.6]
        sprite(tile, [Math.cos(angle) * radius, 0.25 + 2.15 * age, Math.sin(angle) * radius], [size, size], spin, faded(fade, 0xffffff))
      }
      for (let i = 0; i < 3; i++) {
        const angle = (i * TAU) / 3 + time * 0.54
        sprite(2, [Math.cos(angle) * 0.63, 0.18 + 0.06 * Math.sin(angle), Math.sin(angle) * 0.63], [0.49, 0.29], 0, 0xa9ffffff)
      }
    } else if (style === SNOW_TRAIL) {
      const count = 12
      for (let i = 0; i < count; i++) {
        const phase = i * 2.39996
        const age = fract(time * 0.8 + i * 0.29)
        const angle = phase + time * 0.95
        const radius = 0.5 + age * 0.48
        const fade = Math.min(age * 11, (1 - age) * 4, 1)
        const [tile, height, size] = i % 4 === 0 ? [3, 0.3 + age * 0.66, 0.23] : i % 4 === 1 ? [5, 0.13 + age * 0.2, 0.35] : [4, 0.24 + fract(i * 0.623) * 0.83 + age * 0.27, 0.14]
        sprite(tile, [Math.cos(angle) * radius, height, Math.sin(angle) * radius], [size, size], phase + time * 0.6, faded(fade, 0xffffff))
      }
    } else {
      const tint = style === 2 ? 0x6affd3 : 0xd9a2ff
      const count = 18
      for (let i = 0; i < count; i++) {
        const age = fract(time * 0.37 + i * 0.382)
        const angle = (i * TAU) / count + time * 1.75
        const radius = 0.75 + Math.sin(age * TAU) * 0.16
        const scale = 0.065 + age * 0.145
        const opacity = Math.min(age * 9, (1 - age) * 8, 1)
        sprite(4, [Math.cos(angle) * radius, 0.22 + age * 1.9, Math.sin(angle) * radius], [scale, scale], angle * 0.28, faded(opacity, tint))
      }
    }
  }
}

/** The aura the player wears, as in the client (unknown ids fall back to Plus Stardust). */
export function turtleAura(id: string): TurtleEffect {
  const style = auraStyle(id) ?? 3
  const url = style === INFERNO ? INFERNO_ATLAS : style === CELESTIAL || style === SNOW_TRAIL ? BUNDLE_ATLAS : AURA_ATLAS
  return effect(auraBuild(style), 64, () => image(url))
}

/* ---------- Trail: turtle_trails::geometry with the shop's preview path ---------- */

function trailBuild(style: number) {
  const palette: [Rgb, Rgb] = style === 0 ? [[255, 90, 28], [255, 191, 78]] : style === 1 ? [[239, 249, 255], [255, 221, 118]] : [[206, 239, 255], [116, 205, 255]]
  // The white texel and the neutral flames on the 80x28 trail sheet.
  const white: [number, number, number, number] = [1 / 80, 25 / 28, 3 / 80, 27 / 28]
  const forward = new Vector3(0, 0, 1)
  const side = new Vector3().crossVectors(forward, new Vector3(0, 1, 0))
  const at = new Vector3()
  const center = new Vector3()
  const a = new Vector3()
  const b = new Vector3()
  return (now: number, right: Vector3, up: Vector3, sink: QuadSink) => {
    // turtle_trails::preview, mirrored so the path runs behind a figure facing the camera.
    for (let step = 0; step < 16; step++) {
      const age = ((now * 1.4 + step * 0.13) % TRAIL_LIFE + TRAIL_LIFE) % TRAIL_LIFE
      const fade = (1 - age / TRAIL_LIFE) ** 2
      at.set(Math.sin(age * 1.7) * 0.22, 0.025, -(0.25 + age * 1.2))
      const phase = step * 2.39996
      if (style === 2) {
        center.copy(at).addScaledVector(side, step % 2 === 0 ? 0.13 : -0.13)
        sink.quad(center, a.copy(side).multiplyScalar(0.045), b.copy(forward).multiplyScalar(0.04), white, palette[0], fade * 0.72)
        for (let toe = -1; toe <= 1; toe++) {
          const toeAt = new Vector3().copy(center).addScaledVector(forward, 0.075).addScaledVector(side, toe * 0.04)
          sink.quad(toeAt, a.copy(side).multiplyScalar(0.014), b.copy(forward).multiplyScalar(0.022), white, palette[0], fade * 0.85)
        }
        const snow = new Vector3().copy(at).add(new Vector3(0, 0.08 + age * 0.21, 0)).addScaledVector(side, Math.sin(phase) * 0.13)
        const size = 0.022 + fade * 0.014
        sink.quad(snow, a.copy(right).multiplyScalar(size), b.copy(up).multiplyScalar(size * 0.18), white, palette[1], fade * 0.8)
        sink.quad(snow, a.copy(right).multiplyScalar(size * 0.18), b.copy(up).multiplyScalar(size), white, palette[1], fade * 0.8)
      } else if (style === 1) {
        center.copy(at).add(new Vector3(0, 0.09 + age * 0.22, 0)).addScaledVector(side, Math.sin(phase) * 0.12)
        const size = 0.065 * fade + 0.015
        sink.quad(center, a.copy(right).multiplyScalar(size), b.copy(up).multiplyScalar(size * 0.16), white, palette[1], fade * 0.85)
        sink.quad(center, a.copy(right).multiplyScalar(size * 0.16), b.copy(up).multiplyScalar(size), white, palette[1], fade * 0.85)
        const feather = new Vector3().copy(center).addScaledVector(side, 0.1).add(new Vector3(0, 0.09, 0))
        sink.quad(feather, a.copy(right).multiplyScalar(0.025), b.copy(up).multiplyScalar(0.8).addScaledVector(right, 0.6).multiplyScalar(0.08), white, palette[0], fade * 0.55)
      } else {
        center.copy(at).add(new Vector3(0, 0.1 + age * 0.2, 0)).addScaledVector(side, Math.sin(phase) * 0.08)
        const tile = Math.floor(now * 12 + phase) % 4
        const uv: [number, number, number, number] = [((tile + 0.03) * 16) / 80, (24 * 0.02) / 28, ((tile + 0.97) * 16) / 80, (24 * 0.98) / 28]
        sink.quad(center, a.copy(right).multiplyScalar(0.085 * fade + 0.02), b.copy(up).multiplyScalar(0.16 * fade + 0.025), uv, palette[0], fade * 0.72)
        const ember = new Vector3().copy(center).add(new Vector3(0, 0.12 + age * 0.14, 0)).addScaledVector(side, Math.cos(phase) * 0.16)
        sink.quad(ember, a.copy(right).multiplyScalar(0.018), b.copy(up).multiplyScalar(0.026), white, palette[1], fade * 0.9)
      }
    }
  }
}

/** The trail the player wears, drawn on the client's shop preview path behind the figure. */
export function turtleTrail(id: string): TurtleEffect {
  return effect(trailBuild(trailStyle(id) ?? 0), 128, trailSheet)
}
