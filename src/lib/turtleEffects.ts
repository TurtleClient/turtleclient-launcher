/**
 * Auras and trails, drawn the way the Turtle website previews them (same shapes, colours
 * and motion), for the shop cards, the wardrobe tiles and the character in Home and the
 * wardrobe. Units are Minecraft pixels with the player's feet at y = 0.
 */
import { AdditiveBlending, BoxGeometry, CanvasTexture, CircleGeometry, Color, DoubleSide, Group, InstancedMesh, MeshBasicMaterial, NearestFilter, Object3D, OctahedronGeometry, PlaneGeometry, SRGBColorSpace, Sprite, SpriteMaterial } from 'three'
import type { Texture } from 'three'

export interface TurtleEffect {
  object: Group
  /** Seconds since the effect started. */
  update(t: number): void
  dispose(): void
}

function canvasTexture(canvas: HTMLCanvasElement): Texture {
  const map = new CanvasTexture(canvas)
  map.magFilter = NearestFilter
  map.minFilter = NearestFilter
  map.colorSpace = SRGBColorSpace
  return map
}

function particleTexture(kind: string): Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')
  if (!x) return canvasTexture(c)
  if (kind === 'money') {
    x.fillStyle = '#89dc87'
    x.fillRect(3, 16, 58, 32)
    x.strokeStyle = '#254f31'
    x.lineWidth = 3
    x.strokeRect(8, 21, 48, 22)
    x.fillStyle = '#254f31'
    x.font = 'bold 25px monospace'
    x.textAlign = 'center'
    x.fillText('$', 32, 40)
  } else if (kind === 'coin') {
    x.fillStyle = '#ffd36e'
    x.beginPath()
    x.arc(32, 32, 24, 0, Math.PI * 2)
    x.fill()
    x.strokeStyle = '#a47724'
    x.lineWidth = 3
    x.beginPath()
    x.arc(32, 32, 17, 0, Math.PI * 2)
    x.stroke()
  } else if (kind === 'fire') {
    const gradient = x.createLinearGradient(32, 60, 32, 3)
    gradient.addColorStop(0, '#ea321a00')
    gradient.addColorStop(0.25, '#ff6b16')
    gradient.addColorStop(0.6, '#ffe19b')
    gradient.addColorStop(1, '#ff451700')
    x.fillStyle = gradient
    x.beginPath()
    x.moveTo(32, 3)
    x.bezierCurveTo(39, 22, 54, 29, 50, 45)
    x.bezierCurveTo(46, 64, 14, 65, 12, 45)
    x.bezierCurveTo(9, 32, 24, 23, 32, 3)
    x.fill()
  } else {
    x.fillStyle = '#d7faff'
    x.font = '50px sans-serif'
    x.textAlign = 'center'
    x.fillText(kind === 'snow' ? '✦' : kind === 'rain' ? '╱' : '✧', 32, 50)
  }
  return canvasTexture(c)
}

/** Aura: eighteen particles circling and rising around the player. */
export function turtleAura(id: string, color?: [number, number, number]): TurtleEffect {
  const money = id.includes('money')
  const fire = id.includes('demon')
  const snow = id.includes('husky')
  const rain = id.includes('rain')
  const kinds = money ? ['money', 'coin'] : [fire ? 'fire' : snow ? 'snow' : rain ? 'rain' : 'star']
  const maps = kinds.map(particleTexture)
  const group = new Group()
  const tint = color ? new Color(color[0] / 255, color[1] / 255, color[2] / 255) : new Color(id.includes('angel') ? 0xffe7a3 : 0xffffff)
  const sprites: Sprite[] = []
  for (let i = 0; i < 18; i++) {
    const material = new SpriteMaterial({ map: maps[i % maps.length], transparent: true, depthWrite: false, color: fire ? new Color(0xffffff) : tint })
    const s = new Sprite(material)
    s.scale.set(money || fire ? 3.5 : 2.5, money ? 3 : fire ? 6 : 2.5, 1)
    group.add(s)
    sprites.push(s)
  }
  return {
    object: group,
    update(t) {
      sprites.forEach((s, i) => {
        const phase = (t * (rain ? 0.7 : 0.2) + i * 0.137) % 1
        const angle = t * 0.3 + i * 2.4
        const radius = 9 + Math.sin(i * 8.1) * 4
        s.position.set(Math.cos(angle) * radius, 1 + (rain ? 1 - phase : phase) * (fire ? 17 : 33), Math.sin(angle) * radius)
        s.material.opacity = Math.min(1, phase * 8, (1 - phase) * 6)
        s.material.rotation = Math.sin(t + i) * 0.35
      })
    },
    dispose() {
      sprites.forEach(s => s.material.dispose())
      maps.forEach(m => m.dispose())
    },
  }
}

/** Trail: flames, feathers or paw prints drifting away behind the player's feet. */
export function turtleTrail(id: string): TurtleEffect {
  const style = id.startsWith('demon') ? 0 : id.startsWith('angel') ? 1 : 2
  const material = (color: number) => new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })
  const maps: Texture[] = []
  const first = new InstancedMesh(style === 0 ? new PlaneGeometry(3, 5) : style === 1 ? new OctahedronGeometry(1.3, 0) : new CircleGeometry(0.8, 6), material([0xff641c, 0xffdb75, 0xbcefff][style]), style === 2 ? 64 : 16)
  if (style === 0) {
    const map = particleTexture('fire')
    maps.push(map)
    first.material.map = map
    first.material.color.set(0xffffff)
  }
  const second = new InstancedMesh(style === 1 ? new BoxGeometry(0.7, 3, 0.2) : new OctahedronGeometry(0.5, 0), material([0xffbe49, 0xf2fbff, 0x74cfff][style]), 16)
  first.frustumCulled = second.frustumCulled = false
  const group = new Group()
  group.add(first, second)
  const m = new Object3D()
  const color = new Color()
  const instance = (mesh: InstancedMesh, index: number, x: number, y: number, z: number, s: number, rotation = 0, flat = false) => {
    m.position.set(x, y, z)
    m.rotation.set(flat ? -Math.PI / 2 : 0, style === 0 ? 0.44 : 0, rotation)
    m.scale.setScalar(Math.max(0.0001, s))
    m.updateMatrix()
    mesh.setMatrixAt(index, m.matrix)
    color.setScalar(s)
    mesh.setColorAt(index, color)
  }
  return {
    object: group,
    update(t) {
      for (let i = 0; i < 16; i++) {
        const age = (t * 1.4 + i * 0.13) % 2.2
        const fade = Math.max(0, 1 - age / 2.2)
        const x = Math.sin(age * 1.7) * 3.52
        const z = -4 - age * 19.2
        if (style === 2) {
          const side = i % 2 ? 2.1 : -2.1
          instance(first, i * 4, x + side, 0.4, z, fade, 0, true)
          for (let n = 0; n < 3; n++) instance(first, i * 4 + n + 1, x + side + (n - 1) * 0.65, 0.4, z + 1.1, fade * 0.36, 0, true)
        } else instance(first, i, x, 1.4 + age * 3, z, fade * (style === 0 ? 1.1 : 0.8), style === 0 ? Math.sin(t * 6 + i) * 0.12 : t + i)
        instance(second, i, x + Math.sin(i * 2.4) * 1.7, style === 1 ? 3 + age * 4 : 2 + age * 5, z, fade * 0.8, t * 0.5 + i)
      }
      for (const mesh of [first, second]) {
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    },
    dispose() {
      for (const mesh of [first, second]) {
        mesh.geometry.dispose()
        mesh.material.dispose()
        mesh.dispose()
      }
      maps.forEach(map => map.dispose())
    },
  }
}
