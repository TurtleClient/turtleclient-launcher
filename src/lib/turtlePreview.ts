/**
 * Animated previews for every Turtle cosmetic kind: models, capes, name tags, auras,
 * trails, emotes and the MiniMe pet. The figure, poses, emote clips and framing follow
 * the Turtle website's preview renderer, so the launcher shows items as the website
 * and the client do. Models use the launcher's Turtle format renderer (turtleGeometry).
 *
 * One WebGL renderer draws every visible preview in turn and copies the frame into
 * the preview's own canvas: a context per tile would exceed the browser's limit.
 */
import { AmbientLight, BoxGeometry, CircleGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshLambertMaterial, NearestFilter, OrthographicCamera, Scene, SRGBColorSpace, Sprite, SpriteMaterial, Texture, WebGLRenderer, CanvasTexture, DoubleSide } from 'three'
import type { Object3D } from 'three'
import { buildTurtleCosmetic } from './turtleGeometry'
import type { TurtleModel } from './turtleModelTypes'
import { turtleTagColor } from './turtleTag'
import { turtleAura, turtleTrail } from './turtleEffects'
import type { TurtleEffect } from './turtleEffects'
import { turtle } from './turtleclient'

export interface PreviewItem {
  kind: string
  id: string
  hash: string
  slot: string
  owner?: string
}

type Vec = number[]
interface ClipPose { r?: (Vec | null)[]; p?: (Vec | null)[]; s?: (Vec | null)[] }
interface ClipActor { feet: Vec; pose: ClipPose; yaw: number }
export interface TurtleClip { duration: number; fps: number; frames: ClipActor[][] }

const BONES = ['head', 'body', 'right_arm', 'left_arm', 'right_leg', 'left_leg', 'root', 'right_forearm', 'left_forearm', 'right_shin', 'left_shin', 'right_hand', 'left_hand', 'right_foot', 'left_foot']
const ZERO = [0, 0, 0]
const ONE = [1, 1, 1]
const ANCHOR_NODE: Record<string, string> = { head: 'head', body: 'body', cape: 'body', root: 'root', leftArm: 'left_arm', rightArm: 'right_arm', leftLeg: 'left_leg', rightLeg: 'right_leg' }

/* ---------- Data: through the native bridge, cached per launcher session ---------- */

const models = new Map<string, Promise<TurtleModel>>()
const clips = new Map<string, Promise<TurtleClip>>()
const assets = new Map<string, Promise<{ image?: string; json?: unknown }>>()
const remember = <T,>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>, limit = 48): Promise<T> => {
  let pending = map.get(key)
  if (!pending) {
    pending = load()
    pending.catch(() => map.delete(key))
    map.set(key, pending)
    while (map.size > limit) map.delete(map.keys().next().value!)
  }
  return pending
}
export const previewAsset = (hash: string) => remember(assets, hash, () => turtle<{ image?: string; json?: unknown }>('turtle_preview_data', { asset: hash }), 32)
export const previewClip = (id: string) => remember(clips, id, () => turtle<TurtleClip>('turtle_preview_data', { clip: id }), 24)
/** Catalog models come from the cosmetics route; shop-only models from their published file. */
export const previewModel = (item: Pick<PreviewItem, 'id' | 'hash'>) =>
  remember(models, item.id + ':' + item.hash, () =>
    turtle<TurtleModel>('turtle_model', { id: item.id, hash: item.hash }).catch(async () => {
      const asset = await previewAsset(item.hash)
      if (!asset.json || typeof asset.json !== 'object') throw new Error('turtle_model_missing')
      return asset.json as TurtleModel
    }),
  )

/* ---------- The player figure (bendy limbs, as the website and the client pose it) ---------- */

function texture(image: HTMLCanvasElement | HTMLImageElement): Texture {
  const t = image instanceof HTMLCanvasElement ? new CanvasTexture(image) : new Texture(image)
  t.magFilter = NearestFilter
  t.minFilter = NearestFilter
  t.colorSpace = SRGBColorSpace
  t.needsUpdate = true
  return t
}
function loadImage(url: string, cors = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (cors) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}
/** Turtle's neutral figure while the player's own skin loads or is unavailable. */
function defaultSkin(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')
  if (!x) return c
  x.fillStyle = '#293b35'
  x.fillRect(0, 0, 64, 64)
  x.fillStyle = '#c5dec5'
  x.fillRect(0, 0, 32, 16)
  x.fillStyle = '#26352d'
  x.fillRect(0, 0, 32, 7)
  x.fillStyle = '#8edb67'
  x.fillRect(9, 10, 2, 2)
  x.fillRect(13, 10, 2, 2)
  x.fillStyle = '#64d1ae'
  x.fillRect(22, 22, 4, 5)
  x.fillRect(45, 25, 2, 4)
  x.fillRect(37, 55, 2, 4)
  for (const [left, top, width, height] of [[32, 0, 32, 16], [0, 32, 56, 16], [0, 48, 16, 16], [48, 48, 16, 16]]) x.clearRect(left, top, width, height)
  return c
}

const skinState = { map: texture(defaultSkin()), slim: false, legacy: false, url: '' }
/** The active player's skin for every preview figure (falls back to the Turtle figure). */
export async function setPreviewSkin(url: string | null, slim = false) {
  if ((url || '') === skinState.url) return
  skinState.url = url || ''
  if (!url) {
    skinState.map.image = defaultSkin()
    skinState.slim = false
    skinState.legacy = false
    skinState.map.needsUpdate = true
    return
  }
  try {
    const image = await loadImage(url, !url.startsWith('data:'))
    if (skinState.url !== url) return
    skinState.legacy = image.width === image.height * 2
    if (skinState.legacy) {
      const expanded = document.createElement('canvas')
      expanded.width = expanded.height = image.width
      expanded.getContext('2d')?.drawImage(image, 0, 0)
      skinState.map.image = expanded
    } else skinState.map.image = image
    skinState.slim = slim && !skinState.legacy
    skinState.map.needsUpdate = true
  } catch {
    // A skin host without CORS keeps the Turtle figure rather than a blank one.
  }
}
let playerName = 'Turtle'
export const setPreviewName = (name: string) => void (playerName = name || 'Turtle')

function boxUV(geometry: BoxGeometry, rects: number[][]) {
  const a = geometry.attributes.uv
  for (let face = 0; face < 6; face++) {
    const [x, y, rw, rh] = rects[face]
    const uv = [[x, y], [x + rw, y], [x, y + rh], [x + rw, y + rh]]
    for (let i = 0; i < 4; i++) a.setXY(face * 4 + i, uv[i][0] / 64, 1 - uv[i][1] / 64)
  }
  a.needsUpdate = true
}
const limbRects = (u: number, v: number, len: number, offset = 0, width = 4) => [
  [u, v + offset, 4, len],
  [u + 4 + width, v + offset, 4, len],
  [u + 4, v - 4, width, 4],
  [u + 4 + width, v - 4, width, 4],
  [u + 4, v + offset, width, len],
  [u + 8 + width, v + offset, width, len],
]

class Avatar {
  group = new Group()
  root = new Group()
  nodes = new Map<string, Group>()
  rest = new Map<string, Group['position']>()
  constructor(scale = 1) {
    const { map, slim, legacy } = skinState
    const box = (size: [number, number, number], rects: number[][], overlay = false) => {
      const g = new BoxGeometry(...size)
      boxUV(g, rects)
      return new Mesh(g, new MeshLambertMaterial({ map, alphaTest: 0.05, transparent: overlay }))
    }
    this.root.position.y = 24
    this.group.add(this.root)
    this.group.scale.setScalar(scale)
    this.nodes.set('root', this.root)
    this.rest.set('root', this.root.position.clone())
    const add = (name: string, parent: Group, pos: [number, number, number]) => {
      const g = new Group()
      g.position.fromArray(pos)
      parent.add(g)
      this.nodes.set(name, g)
      this.rest.set(name, g.position.clone())
      return g
    }
    const head = add('head', this.root, [0, 0, 0])
    const body = add('body', this.root, [0, 0, 0])
    const h = box([8, 8, 8], [[0, 8, 8, 8], [16, 8, 8, 8], [8, 0, 8, 8], [16, 0, 8, 8], [8, 8, 8, 8], [24, 8, 8, 8]])
    h.position.y = 4
    head.add(h)
    const hat = box([9, 9, 9], [[32, 8, 8, 8], [48, 8, 8, 8], [40, 0, 8, 8], [48, 0, 8, 8], [40, 8, 8, 8], [56, 8, 8, 8]], true)
    hat.position.y = 4
    head.add(hat)
    const torso = box([8, 12, 4], [[16, 20, 4, 12], [28, 20, 4, 12], [20, 16, 8, 4], [28, 16, 8, 4], [20, 20, 8, 12], [32, 20, 8, 12]])
    torso.position.y = -6
    body.add(torso)
    if (!legacy) {
      const jacket = box([8.5, 12.5, 4.5], [[16, 36, 4, 12], [28, 36, 4, 12], [20, 32, 8, 4], [28, 32, 8, 4], [20, 36, 8, 12], [32, 36, 8, 12]], true)
      jacket.position.y = -6
      body.add(jacket)
    }
    for (const [side, x, u, v] of [['right', -5, 40, 20], ['left', 5, legacy ? 40 : 32, legacy ? 20 : 52]] as const) {
      const upper = add(side + '_arm', this.root, [x, slim ? -2.5 : -2, 0])
      const fore = add(side + '_forearm', upper, [0, -4, 0])
      const hand = add(side + '_hand', fore, [0, -4, 0])
      for (const [part, len, y, offset] of [[upper, 6, -1, 0], [fore, 4, -2, 6], [hand, 2, -1, 10]] as const) {
        const width = slim ? 3 : 4
        const centre = (side === 'right' ? -1 : 1) * (slim ? 0.5 : 1)
        const mesh = box([width, len, 4], limbRects(u, v, len, offset, width))
        mesh.position.set(centre, y, 0)
        part.add(mesh)
        if (!legacy) {
          const expand = part === fore ? 0 : 0.25
          const sleeve = box([width + 0.5, len + expand, 4.5], limbRects(side === 'right' ? 40 : 48, side === 'right' ? 36 : 52, len, offset, width), true)
          sleeve.position.set(centre, y + (part === upper ? expand / 2 : -expand / 2), 0)
          part.add(sleeve)
        }
      }
    }
    for (const [side, x, u, v] of [['right', -1.9, 0, 20], ['left', 1.9, legacy ? 0 : 16, legacy ? 20 : 52]] as const) {
      const upper = add(side + '_leg', this.root, [x, -12, 0])
      const shin = add(side + '_shin', upper, [0, -6, 0])
      const foot = add(side + '_foot', shin, [0, -4, 0])
      for (const [part, len, offset] of [[upper, 6, 0], [shin, 4, 6], [foot, 2, 10]] as const) {
        const mesh = box([4, len, 4], limbRects(u, v, len, offset))
        mesh.position.y = -len / 2
        part.add(mesh)
        if (!legacy) {
          const expand = part === upper || part === foot ? 0.25 : 0
          const pants = box([4.5, len + expand, 4.5], limbRects(0, side === 'right' ? 36 : 52, len, offset), true)
          pants.position.y = -len / 2 + (part === upper ? expand / 2 : -expand / 2)
          part.add(pants)
        }
      }
    }
  }
  pose(a: ClipPose | null, b: ClipPose | null, t: number) {
    BONES.forEach((name, i) => {
      const node = this.nodes.get(name)
      const rest = this.rest.get(name)
      if (!node || !rest) return
      const ar = a?.r?.[i] || ZERO
      const br = b?.r?.[i] || ar
      const ap = a?.p?.[i] || ZERO
      const bp = b?.p?.[i] || ap
      const as = a?.s?.[i] || ONE
      const bs = b?.s?.[i] || as
      node.position.set(rest.x + ap[0] + (bp[0] - ap[0]) * t, rest.y - ap[1] - (bp[1] - ap[1]) * t, rest.z - ap[2] - (bp[2] - ap[2]) * t)
      node.rotation.set(ar[0] + (br[0] - ar[0]) * t, -ar[1] - (br[1] - ar[1]) * t, -ar[2] - (br[2] - ar[2]) * t, 'ZYX')
      const clamp = (n: number) => Math.max(0.001, Math.min(16, n))
      node.scale.set(clamp(as[0] + (bs[0] - as[0]) * t), clamp(as[1] + (bs[1] - as[1]) * t), clamp(as[2] + (bs[2] - as[2]) * t))
    })
  }
}

/* ---------- Custom (website) emotes: Blockbench keyframes ---------- */

type Keyframes = Record<string, unknown> | Vec | undefined
function channel(v: Keyframes, t: number, base: Vec): Vec {
  if (!v) return base
  if (Array.isArray(v)) return v
  const keys = Object.entries(v)
    .map(([time, value]) => ({ time: Number(time), value: value as Record<string, unknown> | Vec }))
    .filter(key => Number.isFinite(key.time))
    .sort((a, b) => a.time - b.time)
  if (!keys.length) return base
  const vector = (key: { value: Record<string, unknown> | Vec }, pre = false): Vec => {
    const x = key.value
    if (Array.isArray(x)) return x
    return ((pre ? x.pre || x.post : x.post || x.pre) || x.vector || base) as Vec
  }
  const next = keys.findIndex(n => n.time >= t)
  if (next < 0) return vector(keys[keys.length - 1])
  if (keys[next].time === t) return vector(keys[next])
  if (next === 0) return vector(keys[0], true)
  const a = keys[next - 1]
  const b = keys[next]
  const x = vector(a)
  const y = vector(b, true)
  const u = (t - a.time) / (b.time - a.time)
  const lerp = (k: { value: unknown }) => (k.value as Record<string, unknown>)?.lerp_mode === 'catmullrom'
  if (lerp(a) || lerp(b)) {
    const p0 = vector(keys[Math.max(0, next - 2)])
    const p3 = vector(keys[Math.min(keys.length - 1, next + 1)], true)
    return x.map((n, i) => 0.5 * (2 * n + (-p0[i] + y[i]) * u + (2 * p0[i] - 5 * n + 4 * y[i] - p3[i]) * u * u + (-p0[i] + 3 * n - 3 * y[i] + p3[i]) * u * u * u))
  }
  return x.map((n, i) => n + (y[i] - n) * u)
}
interface CustomEmote { animations?: Record<string, { animation_length?: number; bones?: Record<string, { rotation?: Keyframes; position?: Keyframes; scale?: Keyframes }> }> }
function customPose(raw: CustomEmote, t: number): ClipPose | null {
  const animation = Object.values(raw.animations || {})[0]
  if (!animation) return null
  const pose: Required<ClipPose> = { r: [], p: [], s: [] }
  for (const name of BONES) {
    const c = animation.bones?.[name] || {}
    pose.r.push(channel(c.rotation, t, ZERO).map(n => (n * Math.PI) / 180))
    const p = channel(c.position, t, ZERO)
    pose.p.push([p[0], -p[1], p[2]])
    pose.s.push(channel(c.scale, t, ONE))
  }
  return pose
}

/* ---------- One preview scene ---------- */

interface PreviewState {
  scene: Scene
  camera: OrthographicCamera
  actors: Avatar[]
  items: PreviewItem[]
  effects: TurtleEffect[]
  disposers: (() => void)[]
  capes: Group[]
  clip: TurtleClip | null
  custom: CustomEmote | null
  emote: string | null
  tag: TurtleModel['tag'] | null
  tagCanvas: HTMLCanvasElement | null
  tagMap: Texture | null
  trails: boolean
  back: boolean
  loaded: boolean
  dead: boolean
  started: number
  canvas: HTMLCanvasElement
  output: CanvasRenderingContext2D | null
}

async function addCape(actor: Avatar, item: PreviewItem, state: PreviewState) {
  const asset = await previewAsset(item.hash)
  if (!asset.image) throw new Error('cape')
  const image = await loadImage(asset.image)
  const c = document.createElement('canvas')
  c.width = 160
  c.height = 256
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  if (image.width / image.height > 1.7) {
    const sx = image.width / 64
    const sy = image.height / 32
    ctx.drawImage(image, sx, sy, sx * 10, sy * 16, 0, 0, 160, 256)
  } else ctx.drawImage(image, 0, 0, 160, 256)
  const map = texture(c)
  const geometry = new BoxGeometry(10, 16, 0.6)
  const material = new MeshLambertMaterial({ map, side: DoubleSide })
  const group = new Group()
  group.position.set(0, -1, -2.5)
  const mesh = new Mesh(geometry, material)
  mesh.position.y = -8
  group.add(mesh)
  actor.nodes.get('body')?.add(group)
  state.capes.push(group)
  state.disposers.push(() => {
    geometry.dispose()
    material.dispose()
    map.dispose()
  })
}

async function addModel(actor: Avatar, item: PreviewItem, state: PreviewState) {
  const model = await previewModel(item)
  if (model.slot === 'name_tag' || model.tag) {
    state.tag = model.tag || { line: '#ffffff' }
    return
  }
  const built = await buildTurtleCosmetic(model)
  state.disposers.push(built.dispose)
  for (const piece of built.pieces) {
    // The website figure's limbs sit at the bone pivots, so no extra shift is needed.
    piece.object.position.y = 0
    ;(actor.nodes.get(ANCHOR_NODE[piece.anchor] || 'body') || actor.root).add(piece.object)
  }
}

function frame(state: PreviewState, t: number, aspect: number) {
  const id = state.emote
  let focus = state.trails ? 9 : 16
  if (id === 'turtle') focus = 7
  else if (id === 'sit') focus = 12
  if (id === 'angel_ascension' || id === 'levitate') focus = 24
  const lift = id === 'angel_ascension' || id === 'levitate' ? 62 : 44
  const wide = id === 'wide' ? 56 / aspect : 0
  const span = state.trails ? 74 : state.actors.length > 1 ? Math.max(44, 65 / aspect) : Math.max(lift, wide)
  const cam = state.camera
  cam.left = (-span * aspect) / 2
  cam.right = (span * aspect) / 2
  cam.top = span / 2
  cam.bottom = -span / 2
  cam.position.set(id === 'dap' ? 8 : 34, focus + (state.trails ? 36 : 9), 72)
  cam.lookAt(0, focus, 0)
  cam.updateProjectionMatrix()
  const actor = state.actors[0]
  if (state.clip) {
    const c = state.clip
    const time = Math.min(t % (c.duration + 0.5), c.duration)
    const f = Math.min(c.frames.length - 1, Math.floor(time * c.fps))
    const next = Math.min(c.frames.length - 1, f + 1)
    const mix = time * c.fps - f
    state.actors.forEach((a, i) => {
      const from = c.frames[f]?.[i]
      const to = c.frames[next]?.[i] || from
      if (!from) return
      a.pose(from.pose, to.pose, mix)
      a.group.position.fromArray(from.feet)
      a.group.rotation.y = (-from.yaw * Math.PI) / 180
    })
  } else if (state.custom) {
    const animation = Object.values(state.custom.animations || {})[0]
    const pose = customPose(state.custom, t % Math.max(0.1, animation?.animation_length || 1))
    actor.pose(pose, pose, 0)
  } else {
    actor.group.rotation.y = Math.sin(t * 0.2) * 0.18 + (state.back ? Math.PI : 0)
    actor.nodes.get('head')!.rotation.y = Math.sin(t * 0.35) * 0.08
    if (state.trails) {
      for (const [name, sign] of [['right_leg', 1], ['left_leg', -1], ['right_arm', -1], ['left_arm', 1]] as const) actor.nodes.get(name)!.rotation.x = Math.sin(t * 6) * 0.5 * sign
    }
  }
  for (const cape of state.capes) {
    cape.rotation.x = -(0.13 + Math.sin(t * 2) * 0.045)
    cape.rotation.z = Math.sin(t * 1.2) * 0.025
  }
  for (const effect of state.effects) effect.update(t)
  if (state.tag && state.tagCanvas && state.tagMap) {
    const x = state.tagCanvas.getContext('2d')
    if (x) {
      x.clearRect(0, 0, 512, 180)
      x.font = 'bold 68px monospace'
      x.textAlign = 'center'
      const word = playerName
      let width = x.measureText(word).width
      if (width > 440) {
        x.font = `bold ${(68 * 440) / width}px monospace`
        width = x.measureText(word).width
      }
      const ms = t * 1000
      for (let i = 0; i < word.length; i++) {
        x.fillStyle = turtleTagColor(state.tag.animation, state.tag.line, ms, i, word.length)
        x.fillText(word[i], -width / 2 + 256 + ((i + 0.5) * width) / word.length, 100)
      }
      x.fillStyle = turtleTagColor(state.tag.animation, state.tag.line, ms, 0, 1)
      x.fillRect(256 - width / 2, 114, width, 4)
      state.tagMap.needsUpdate = true
    }
  }
}

function disposeState(state: PreviewState) {
  state.dead = true
  state.effects.forEach(e => e.dispose())
  state.disposers.forEach(d => d())
  state.tagMap?.dispose()
  state.scene.traverse((o: Object3D) => {
    const mesh = o as Mesh
    if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose()
    const material = (o as Mesh).material
    if (material) for (const m of Array.isArray(material) ? material : [material]) m.dispose()
  })
}

/* ---------- The shared renderer ---------- */

class PreviewManager {
  private renderer: WebGLRenderer
  private surface: HTMLCanvasElement
  private scenes = new Map<HTMLElement, PreviewState>()
  private visible = new Set<HTMLElement>()
  private observer: IntersectionObserver
  private last = 0
  private running = false
  constructor() {
    this.surface = document.createElement('canvas')
    this.renderer = new WebGLRenderer({ canvas: this.surface, alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(1)
    this.renderer.autoClear = false
    this.renderer.outputColorSpace = SRGBColorSpace
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        if (entry.isIntersecting) {
          this.visible.add(el)
          this.ensure(el)
        } else this.visible.delete(el)
      }
      this.wake()
    }, { rootMargin: '80px' })
  }
  private wake() {
    if (this.running || !this.scenes.size) return
    this.running = true
    requestAnimationFrame(this.tick)
  }
  /**
   * Registers a tile; its scene is built only once it scrolls into view, and only scenes
   * out of view are dropped when there are too many. Building every tile at once used
   * to drop the first rows of a long shop before they were ever drawn.
   */
  attach(el: HTMLElement, items: PreviewItem[]): () => void {
    this.detach(el)
    this.wanted.set(el, items)
    this.observer.observe(el)
    return () => this.detach(el)
  }
  private wanted = new Map<HTMLElement, PreviewItem[]>()
  private ensure(el: HTMLElement) {
    const items = this.wanted.get(el)
    if (!items || this.scenes.has(el)) return
    while (this.scenes.size >= 48) {
      const old = [...this.scenes.keys()].find(e => !this.visible.has(e))
      if (!old) break
      this.drop(old)
    }
    this.build(el, items)
  }
  private drop(el: HTMLElement) {
    const state = this.scenes.get(el)
    if (!state) return
    this.scenes.delete(el)
    el.classList.remove('tp-ready', 'tp-failed')
    disposeState(state)
  }
  private build(el: HTMLElement, items: PreviewItem[]) {
    const canvas = el.querySelector('canvas') || document.createElement('canvas')
    if (!canvas.isConnected) el.append(canvas)
    const scene = new Scene()
    scene.add(new HemisphereLight(0xe4f5eb, 0x3a473b, 2))
    scene.add(new AmbientLight(0xffffff, 0.15))
    const light = new DirectionalLight(0xffffff, 2.2)
    light.position.set(20, 40, 40)
    scene.add(light)
    const actor = new Avatar()
    scene.add(actor.group)
    const shadow = new Mesh(new CircleGeometry(9, 32), new MeshBasicMaterial({ color: 0x233a27, transparent: true, opacity: 0.4, depthWrite: false }))
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = -0.08
    scene.add(shadow)
    const state: PreviewState = {
      scene,
      camera: new OrthographicCamera(-28, 28, 28, -28, 0.1, 800),
      actors: [actor],
      items,
      effects: [],
      disposers: [],
      capes: [],
      clip: null,
      custom: null,
      emote: null,
      tag: null,
      tagCanvas: null,
      tagMap: null,
      trails: items.some(i => i.kind === 'trail'),
      back: items.some(i => i.slot === 'back' || i.kind === 'cape') && !items.some(i => i.kind === 'emote' || i.kind === 'pet'),
      loaded: false,
      dead: false,
      started: performance.now() / 1000,
      canvas,
      output: canvas.getContext('2d'),
    }
    this.scenes.set(el, state)
    void this.load(el, state, actor, shadow)
  }
  private async load(el: HTMLElement, state: PreviewState, actor: Avatar, shadow: Mesh) {
    try {
      for (const item of state.items) {
        if (state.dead) return
        if (item.kind === 'model') await addModel(actor, item, state)
        else if (item.kind === 'cape') await addCape(actor, item, state)
        else if (item.kind === 'aura') {
          const effect = turtleAura(item.id)
          actor.group.add(effect.object)
          state.effects.push(effect)
        } else if (item.kind === 'trail') {
          const effect = turtleTrail(item.id)
          state.scene.add(effect.object)
          state.effects.push(effect)
        } else if (item.kind === 'emote') {
          state.emote = item.id
          if (item.id.startsWith('web_')) state.custom = ((await previewAsset(item.hash)).json as CustomEmote) || null
          else state.clip = await previewClip(item.id)
        } else if (item.kind === 'pet') {
          state.emote = 'minime'
          state.clip = await previewClip('minime')
        }
      }
      if (state.dead) return
      const actors = state.clip?.frames[0]?.length || 1
      for (let i = 1; i < actors; i++) {
        const other = new Avatar()
        state.scene.add(other.group)
        state.actors.push(other)
      }
      if (state.tag) {
        const c = document.createElement('canvas')
        c.width = 512
        c.height = 180
        state.tagCanvas = c
        state.tagMap = texture(c)
        actor.group.visible = false
        shadow.visible = false
        const sprite = new Sprite(new SpriteMaterial({ map: state.tagMap, depthTest: false }))
        sprite.position.y = 16
        sprite.scale.set(42, 15, 1)
        state.scene.add(sprite)
      }
      state.loaded = true
      el.classList.add('tp-ready')
      this.wake()
    } catch {
      el.classList.add('tp-failed')
    }
  }
  detach(el: HTMLElement) {
    this.wanted.delete(el)
    this.visible.delete(el)
    this.observer.unobserve(el)
    this.drop(el)
  }
  private tick = (now: number) => {
    if (!this.scenes.size) {
      this.running = false
      return
    }
    requestAnimationFrame(this.tick)
    if (document.hidden || now - this.last < 1000 / 30) return
    this.last = now
    const time = now / 1000
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const el of this.visible) {
      const state = this.scenes.get(el)
      if (!state || !state.loaded || !el.isConnected) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      frame(state, calm ? 1 : time - state.started, r.width / r.height)
      const ratio = Math.min(devicePixelRatio || 1, 1.5, 1024 / Math.max(r.width, r.height))
      const width = Math.max(1, Math.round(r.width * ratio))
      const height = Math.max(1, Math.round(r.height * ratio))
      if (this.surface.width !== width || this.surface.height !== height) this.renderer.setSize(width, height, false)
      this.renderer.setViewport(0, 0, width, height)
      this.renderer.clear()
      this.renderer.render(state.scene, state.camera)
      if (state.canvas.width !== width) state.canvas.width = width
      if (state.canvas.height !== height) state.canvas.height = height
      state.output?.clearRect(0, 0, width, height)
      state.output?.drawImage(this.surface, 0, 0)
    }
  }
}

let manager: PreviewManager | null = null
/** Shows the items on a figure inside `el` until the returned function is called. */
export function attachPreview(el: HTMLElement, items: PreviewItem[]): () => void {
  manager ??= new PreviewManager()
  return manager.attach(el, items)
}
