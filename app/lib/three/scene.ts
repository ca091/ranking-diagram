/**
 * 3D 排行舞台（设计共识 Q2/Q7/Q8/Q15/Q18/Q23）。
 * 裸 three.js + rAF 命令式时间线；Vue 只负责挂载与 tooltip 呈现。
 * slot 0 = 最弱（最左）… slot count-1 = 冠军（最右、最后压轴）。
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { RankingEntry, RankingResult } from '#shared/ranking'
import {
  DEFAULT_CHOREO,
  buildTimeline,
  easeOutBack,
  easeOutCubic,
  slotProgress,
  type ChoreoConfig,
} from './choreography'
import { BILLBOARD_H, BILLBOARD_W, drawBillboard } from './avatar'
import { loadBillboardAvatars } from './avatar-loader'
import { PointerTracker } from './input-tracker'
import { CHAMPION_HEX, rankAccent } from './colors'

export interface HoverInfo {
  entry: RankingEntry
  /** 相对容器左上角的像素坐标 */
  x: number
  y: number
}

export interface StageCallbacks {
  onHover: (hover: HoverInfo | null) => void
  onEnded?: () => void
}

interface Slot {
  index: number
  entry: RankingEntry
  bar: THREE.Mesh
  billboard: THREE.Sprite
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  accent: THREE.Color
  targetX: number
  finalHeight: number
  glow?: THREE.Sprite
  light?: THREE.PointLight
}

const CONFIG = {
  stageWidth: 16.5,
  /** 条间基准间距；条目少时舞台按 count*spacing 收窄，相机拉近（fitCamera 用） */
  slotSpacing: 0.62,
  barDepthRatio: 0.62,
  slideFromSpacing: 2.6,
  minBarHeight: 0.5,
  maxBarHeight: 6.0,
  fov: 42,
  cameraHeight: 3.4,
  clearColor: '#070a12',
  bloom: { strength: 0.5, radius: 0.6, threshold: 0.78 },
} as const

function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 8, 128, 128, 128)
    grad.addColorStop(0, 'rgba(255, 222, 130, 0.85)')
    grad.addColorStop(0.45, 'rgba(255, 209, 102, 0.30)')
    grad.addColorStop(1, 'rgba(255, 209, 102, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 256, 256)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export class RankingStage {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly glowTexture = createGlowTexture()
  private readonly composer: EffectComposer
  private readonly tracker: PointerTracker

  private slots: Slot[] = []
  private barGroup = new THREE.Group()
  private timeline: { starts: number[]; totalMs: number } = { starts: [], totalMs: 0 }
  private playing = false
  private playStart = 0
  private rafId = 0
  private disposed = false
  private loadToken = 0
  private hoverSlot: Slot | null = null

  private readonly resizeObserver: ResizeObserver
  private spacing = 1
  private readonly containerRect = () => this.container.getBoundingClientRect()

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: StageCallbacks,
    private readonly choreo: ChoreoConfig = DEFAULT_CHOREO,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth || 1, container.clientHeight || 1)
    this.renderer.setClearColor(new THREE.Color(CONFIG.clearColor))
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(CONFIG.clearColor)

    const aspect = (container.clientWidth || 1) / (container.clientHeight || 1)
    this.camera = new THREE.PerspectiveCamera(CONFIG.fov, aspect, 0.1, 200)
    this.camera.position.set(0, CONFIG.cameraHeight, 20)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = 1.48
    this.controls.target.set(0, 1.9, 0)

    this.scene.add(new THREE.HemisphereLight('#9db8ff', '#0a0f1c', 0.55))
    const key = new THREE.DirectionalLight('#ffffff', 1.05)
    key.position.set(6, 12, 8)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight('#58a6ff', 0.3)
    fill.position.set(-8, 6, -6)
    this.scene.add(fill)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 60),
      new THREE.MeshStandardMaterial({ color: '#0a0f1c', roughness: 0.5, metalness: 0.45 }),
    )
    floor.rotation.x = -Math.PI / 2
    this.scene.add(floor)

    const grid = new THREE.GridHelper(90, 90, '#1d2b4a', '#111a2e')
    grid.position.y = 0.02
    const gridMaterial = grid.material as THREE.Material
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.42
    this.scene.add(grid)

    this.scene.add(this.barGroup)

    this.composer = new EffectComposer(this.renderer)
    this.composer.setSize(container.clientWidth || 1, container.clientHeight || 1)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(container.clientWidth || 1, container.clientHeight || 1),
        CONFIG.bloom.strength,
        CONFIG.bloom.radius,
        CONFIG.bloom.threshold,
      ),
    )
    this.composer.addPass(new OutputPass())

    this.domElement = this.renderer.domElement
    this.tracker = new PointerTracker(this.domElement, this.containerRect, () => this.setHover(null))

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(container)

    this.tick()
  }

  private readonly domElement: HTMLCanvasElement

  setResult(result: RankingResult): void {
    this.clearSlots()
    // 入画顺序 = 弱→强：slot 0（最左、最先入场）是最后一名，冠军 rank 1 压轴落位最右（设计共识 Q7）
    const ordered = [...result.entries].reverse()
    const count = ordered.length
    if (count === 0) return

    this.spacing = Math.min(CONFIG.slotSpacing, CONFIG.stageWidth / count)
    const barWidth = Math.min(0.62, this.spacing * 0.68)
    const depth = barWidth * CONFIG.barDepthRatio
    const geometry = new THREE.BoxGeometry(barWidth, 1, depth)
    geometry.translate(0, 0.5, 0) // pivot 在底面，scale.y 从地面生长
    this.slotGeometry = geometry

    ordered.forEach((entry, index) => {
      const accent = rankAccent(entry.rank, count)
      const finalHeight = CONFIG.minBarHeight + (entry.score / 100) * (CONFIG.maxBarHeight - CONFIG.minBarHeight)
      const targetX = (index - (count - 1) / 2) * this.spacing

      const material = new THREE.MeshStandardMaterial({
        color: accent,
        roughness: 0.38,
        metalness: 0.32,
        emissive: accent,
        emissiveIntensity: entry.rank === 1 ? 0.75 : 0.12,
      })
      const bar = new THREE.Mesh(geometry, material)
      bar.position.set(targetX - this.spacing * CONFIG.slideFromSpacing, 0, 0)
      bar.scale.y = 0.0001
      bar.userData.slotIndex = index
      this.barGroup.add(bar)

      const canvas = document.createElement('canvas')
      drawBillboard(canvas, { name: entry.name, rank: entry.rank, accentHex: `#${accent.getHexString()}`, image: null })
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const billboard = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
      )
      const billboardW = Math.min(Math.max(this.spacing * 2.2, 0.9), 1.55)
      billboard.scale.set(billboardW, billboardW * (BILLBOARD_H / BILLBOARD_W), 1)
      billboard.position.set(bar.position.x, 0.001, 0)
      billboard.material.opacity = 0
      billboard.userData.slotIndex = index
      this.barGroup.add(billboard)

      const slot: Slot = { index, entry, bar, billboard, canvas, texture, accent, targetX, finalHeight }

      if (entry.rank === 1) {
        const glow = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.glowTexture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0,
          }),
        )
        glow.scale.set(finalHeight * 1.5, finalHeight * 1.5, 1)
        glow.position.set(targetX, finalHeight * 0.52, -depth * 1.4)
        this.barGroup.add(glow)
        slot.glow = glow

        const championLight = new THREE.PointLight(CHAMPION_HEX, 0, 14, 2)
        championLight.position.set(targetX, finalHeight + 1.2, 1)
        this.barGroup.add(championLight)
        slot.light = championLight
      }
      this.slots.push(slot)
    })

    this.fitCamera(count)
    this.timeline = buildTimeline(count, this.choreo)
    this.loadAvatars()
    this.play()
  }

  private slotGeometry: THREE.BufferGeometry | null = null

  play(): void {
    if (this.slots.length === 0) return
    this.playing = true
    this.playStart = performance.now()
  }

  replay(): void {
    this.play()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()
    this.tracker.destroy()
    this.controls.dispose()
    this.clearSlots()
    this.glowTexture.dispose()
    this.composer.dispose()
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite || object instanceof THREE.LineSegments) {
        object.geometry?.dispose?.()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((m) => m.dispose())
      }
    })
    this.renderer.dispose()
    this.domElement.remove()
  }

  // ── 内部 ────────────────────────────────────────────────

  private clearSlots(): void {
    this.loadToken += 1
    for (const slot of this.slots) {
      this.barGroup.remove(slot.bar, slot.billboard)
      if (slot.glow) this.barGroup.remove(slot.glow)
      slot.texture.dispose()
      ;(slot.bar.material as THREE.Material).dispose()
      ;(slot.billboard.material as THREE.SpriteMaterial).dispose()
      if (slot.glow) (slot.glow.material as THREE.SpriteMaterial).dispose()
    }
    this.slots = []
    this.barGroup.children
      .filter((child) => child instanceof THREE.PointLight)
      .forEach((light) => this.barGroup.remove(light))
    this.slotGeometry?.dispose()
    this.slotGeometry = null
    this.hoverSlot = null
    this.callbacks.onHover(null)
    this.playing = false
  }

  private fitCamera(count: number): void {
    // 条目少时舞台收窄到 count*spacing，相机随之拉近（评审：count 死参数）
    const fieldWidth = Math.min(CONFIG.stageWidth, Math.max(count, 1) * CONFIG.slotSpacing)
    const halfWidth = (fieldWidth / 2) * 1.06 + 1.4
    const tanHalf = Math.tan((CONFIG.fov / 2) * (Math.PI / 180))
    const aspect = this.camera.aspect
    const distByWidth = halfWidth / (tanHalf * Math.min(aspect, 1.8))
    const distByHeight = (CONFIG.maxBarHeight + 3.2) / (2 * tanHalf)
    const dist = Math.max(distByWidth, distByHeight) + 1.5
    this.camera.position.set(0, CONFIG.cameraHeight, dist)
    this.controls.minDistance = dist * 0.4
    this.controls.maxDistance = dist * 2.4
    this.controls.update()
  }

  private handleResize(): void {
    if (this.disposed) return
    const width = this.container.clientWidth || 1
    const height = this.container.clientHeight || 1
    this.renderer.setSize(width, height)
    this.composer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    if (this.slots.length > 0 && !this.playing) {
      this.fitCamera(this.slots.length)
    }
  }

  private loadAvatars(): void {
    const token = this.loadToken
    void loadBillboardAvatars(
      this.slots.map((slot) => ({
        entry: slot.entry,
        canvas: slot.canvas,
        texture: slot.texture,
        accentHex: `#${slot.accent.getHexString()}`,
      })),
      () => this.disposed || token !== this.loadToken,
    )
  }

  private updateHover(): void {
    if (this.playing || !this.tracker.inside || this.tracker.dragging || this.slots.length === 0) {
      this.setHover(null)
      return
    }
    this.pointer.set(this.tracker.ndcX, this.tracker.ndcY)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const targets: THREE.Object3D[] = []
    for (const slot of this.slots) {
      targets.push(slot.bar, slot.billboard)
    }
    const hits = this.raycaster.intersectObjects(targets, false)
    const first = hits[0]?.object
    const index = typeof first?.userData?.slotIndex === 'number' ? first.userData.slotIndex : null
    this.setHover(index === null ? null : this.slots[index] ?? null)
  }

  private setHover(slot: Slot | null): void {
    if (slot === this.hoverSlot) return
    this.hoverSlot = slot
    if (!slot) {
      this.callbacks.onHover(null)
      return
    }
    const rect = this.containerRect()
    const world = new THREE.Vector3()
    slot.bar.getWorldPosition(world)
    world.y = slot.finalHeight + 1.2
    const projected = world.project(this.camera)
    this.callbacks.onHover({
      entry: slot.entry,
      x: (projected.x * 0.5 + 0.5) * rect.width,
      y: (-projected.y * 0.5 + 0.5) * rect.height,
    })
  }

  private readonly tick = (): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.tick)

    if (this.playing) this.updatePlay()
    this.updateHover()
    this.controls.update()
    this.composer.render()
  }

  private updatePlay(): void {
    const elapsed = performance.now() - this.playStart
    const { starts } = this.timeline
    let allDone = true

    this.slots.forEach((slot) => {
      const start = starts[slot.index] ?? 0
      const p = slotProgress(elapsed, start, this.choreo.growMs)
      if (p < 1) allDone = false
      const grow = easeOutBack(p)
      const slide = easeOutCubic(Math.min(p * 1.5, 1))

      slot.bar.scale.y = Math.max(slot.finalHeight * grow, 0.0001)
      slot.bar.position.x = slot.targetX - this.spacing * CONFIG.slideFromSpacing * (1 - slide)

      const material = slot.billboard.material as THREE.SpriteMaterial
      material.opacity = Math.min(p * 2.4, 1)
      const currentTop = Math.max(slot.finalHeight * grow, 0.001)
      slot.billboard.position.set(slot.bar.position.x, currentTop + 0.85, 0)

      if (slot.glow) {
        ;(slot.glow.material as THREE.SpriteMaterial).opacity = slide * 0.9
      }
      if (slot.light) {
        slot.light.intensity = slide * 5.5
      }
    })

    if (allDone) {
      this.playing = false
      this.callbacks.onEnded?.()
    }
  }
}
