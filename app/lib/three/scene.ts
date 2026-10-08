/**
 * 3D 排行舞台（夜曲版 v2）。
 * - 条形：正方体立柱，间距 = 一个柱宽；样式完全统一（无冠军特化）
 * - 布局：相机按视口高度适配；柱宽撑满屏幕，直到触及最小柱宽（默认 30px），
 *   再放不下时内容横向滚动（背景固定，滚动带视差），通过 getScrollRangePx/setScrollPx 驱动
 * - 出场：从远处（背景方向）向镜头推拉落位，间隔可配置（默认 1s），冠军蓄力压轴
 * - 背景：用户提供的墓园夜景图 bg.webp（cover 裁切），初始化即渲染
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
import { BILLBOARD_H, BILLBOARD_W, RANK_PLATE_ASPECT, drawBillboard, drawRankPlate } from './avatar'
import { loadBillboardAvatars } from './avatar-loader'
import { PointerTracker } from './input-tracker'
import { ENTRY_EMISSIVE, MOON_COLOR, entryColor } from './colors'
import bgUrl from '../../assets/images/bg.webp'

export interface HoverInfo {
  entry: RankingEntry
  x: number
  y: number
}

export interface StageCallbacks {
  onHover: (hover: HoverInfo | null) => void
  /** 一次入场播放的开始（含重播）——宿主借此进入"纯 3D"模式 */
  onPlayStart?: () => void
  /** 全部柱子落位 */
  onEnded?: () => void
  /** 布局变化（结果替换 / resize / 相机适配）后触发，宿主借此同步滚动容器 */
  onLayout?: () => void
  /** 入场自动跟拍期间，把等效滚动位置回写给宿主滚动条 */
  onAutoScroll?: (px: number) => void
}

interface Slot {
  index: number
  entry: RankingEntry
  bar: THREE.Mesh
  billboard: THREE.Sprite
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  rankSprite: THREE.Sprite
  rankCanvas: HTMLCanvasElement
  rankTexture: THREE.CanvasTexture
  targetX: number
  finalHeight: number
}

interface StageLayout {
  barWidth: number
  spacing: number
  worldPerPx: number
  halfRangeWorld: number
  visibleWidth: number
  dollyDepth: number
}

const CONFIG = {
  /** 柱子最小宽度（CSS 像素）；触底后改为横向滚动 */
  minBarPx: 30,
  /** 单柱最大世界宽度（条目很少时不至于胖成墙；1.75 保证 3 根也基本撑满） */
  maxBarWidth: 1.75,
  /** 间距 = 柱宽 × spacingFactor（2 = 留一根柱子的空隙） */
  spacingFactor: 2,
  /** 无滚动时内容占满视口宽度的比例 */
  widthFill: 0.98,
  minBarHeight: 0.45,
  maxBarHeight: 5.0,
  /** 出场推拉近点与相机的保留距离 */
  dollyKeepDistance: 6,
  fov: 42,
  cameraHeight: 3.2,
  /** 柱群整体下移量：给高柱的 billboard 让出页面顶部，构图垂直居中 */
  groupOffsetY: -0.6,
  /** 名次数字高度：柱底（y=0）之下，不压在柱体上 */
  rankPlateY: -0.16,
  /** 名次数字置于柱脚靠前（观者侧）多少个柱宽，避免与柱体重叠遮挡 */
  rankPlateDepth: 1.6,
  clearColor: '#05070c',
  bloom: { strength: 0.26, radius: 0.5, threshold: 0.72 },
} as const

export class RankingStage {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly composer: EffectComposer
  private readonly tracker: PointerTracker
  private readonly bgTexture: THREE.Texture

  private slots: Slot[] = []
  private readonly barGroup = new THREE.Group()
  private timeline: { starts: number[]; totalMs: number } = { starts: [], totalMs: 0 }
  private playing = false
  private playStart = 0
  private rafId = 0
  private disposed = false
  private loadToken = 0
  private hoverSlot: Slot | null = null
  private layout: StageLayout = { barWidth: 0.6, spacing: 1.2, worldPerPx: 0.02, halfRangeWorld: 0, visibleWidth: 12, dollyDepth: 18 }
  private scrollPx = 0
  /** 入场自动跟拍：每根柱子落位时刻的等效滚动位置（px），与 dolly 同步插值 */
  private panScrolls: number[] = []
  private autoPan = false

  private readonly resizeObserver: ResizeObserver
  private slotGeometry: THREE.BufferGeometry | null = null
  private sharedBarMaterial: THREE.MeshStandardMaterial | null = null
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

    // 背景 = 夜曲墓地图（cover 裁切）；页面初始化即渲染，不等待排行结果
    this.scene.background = new THREE.Color(CONFIG.clearColor)
    this.bgTexture = new THREE.TextureLoader().load(bgUrl, () => {
      // 图片解码可能晚于组件卸载：别往已 dispose 的纹理里写状态
      if (this.disposed) return
      this.applyBackgroundCover()
    })
    this.bgTexture.colorSpace = THREE.SRGBColorSpace
    this.scene.background = this.bgTexture

    const aspect = (container.clientWidth || 1) / (container.clientHeight || 1)
    this.camera = new THREE.PerspectiveCamera(CONFIG.fov, aspect, 0.1, 200)
    this.camera.position.set(0, CONFIG.cameraHeight, 20)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = 1.48
    this.controls.target.set(0, 1.9, 0)

    // 灯光方向对位图中的月轮（右上）：逆光勾边 + 正面补光
    this.scene.add(new THREE.HemisphereLight('#3b465e', '#05070c', 0.5))
    const moonKey = new THREE.DirectionalLight(MOON_COLOR, 0.8)
    moonKey.position.set(15, 13, -30)
    this.scene.add(moonKey)
    const frontal = new THREE.DirectionalLight('#93a8c8', 0.8)
    frontal.position.set(-4, 9, 16)
    this.scene.add(frontal)
    const side = new THREE.DirectionalLight('#4c5c76', 0.2)
    side.position.set(-12, 4, 6)
    this.scene.add(side)

    this.barGroup.position.y = CONFIG.groupOffsetY
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

    this.fitCamera(Math.max(this.countInView(), 1))
    this.tick()
  }

  private readonly domElement: HTMLCanvasElement

  setResult(result: RankingResult): void {
    this.clearSlots()
    // 入画顺序 = 弱→强：slot 0（最左、最先入场）是最后一名，冠军最右压轴
    const ordered = [...result.entries].reverse()
    const count = ordered.length
    if (count === 0) return

    this.fitCamera(count)
    const { barWidth } = this.layout
    const geometry = new THREE.BoxGeometry(barWidth, 1, barWidth) // 正方体立柱：宽 = 深
    geometry.translate(0, 0.5, 0)
    this.slotGeometry = geometry

    // 全部条目共用一套材质与配色 —— 无冠军特效
    const sharedMaterial = new THREE.MeshStandardMaterial({
      color: entryColor(),
      roughness: 0.68,
      metalness: 0.12,
      emissive: ENTRY_EMISSIVE,
      emissiveIntensity: 0.32,
    })
    this.sharedBarMaterial = sharedMaterial

    ordered.forEach((entry, index) => {
      this.slots.push(this.createSlot(entry, index, count, geometry, sharedMaterial))
    })

    this.timeline = buildTimeline(count, this.choreo)
    this.computePanScrolls()
    this.scrollPx = 0
    this.applyScroll()
    this.loadAvatars()
    this.callbacks.onLayout?.()
    this.play()
  }

  /** 单根柱的全部可视元素：柱体 + 顶部 billboard + 柱脚名次数字，均置于最远出场位 */
  private createSlot(
    entry: RankingEntry,
    index: number,
    count: number,
    geometry: THREE.BufferGeometry,
    material: THREE.MeshStandardMaterial,
  ): Slot {
    const { barWidth, spacing, dollyDepth } = this.layout
    const finalHeight = CONFIG.minBarHeight + (entry.score / 100) * (CONFIG.maxBarHeight - CONFIG.minBarHeight)
    const targetX = (index - (count - 1) / 2) * spacing

    const bar = new THREE.Mesh(geometry, material)
    bar.position.set(targetX, 0, -dollyDepth)
    bar.scale.y = 0.0001
    // 未入场时整列薄板会在远景投影成"地平虚线"，起跳前直接隐藏
    bar.visible = false
    bar.userData.slotIndex = index
    this.barGroup.add(bar)

    const canvas = document.createElement('canvas')
    drawBillboard(canvas, { name: entry.name, image: null })
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const billboard = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
    )
    const billboardW = Math.min(Math.max(spacing * 1.9, 0.8), 1.35)
    billboard.scale.set(billboardW, billboardW * (BILLBOARD_H / BILLBOARD_W), 1)
    billboard.position.set(targetX, 0.001, -dollyDepth)
    billboard.material.opacity = 0
    billboard.userData.slotIndex = index
    this.barGroup.add(billboard)

    // 柱脚名次（倒序布局天然成立：slot 从左到右 = rank 从低名次到高名次）
    const rankCanvas = document.createElement('canvas')
    drawRankPlate(rankCanvas, entry.rank)
    const rankTexture = new THREE.CanvasTexture(rankCanvas)
    rankTexture.colorSpace = THREE.SRGBColorSpace
    const rankSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: rankTexture, transparent: true, depthWrite: false }),
    )
    const plateW = Math.min(Math.max(barWidth * 1.6, 0.55), 1.1)
    rankSprite.scale.set(plateW, plateW * RANK_PLATE_ASPECT, 1)
    rankSprite.position.set(targetX, CONFIG.rankPlateY, -dollyDepth + barWidth * CONFIG.rankPlateDepth)
    rankSprite.material.opacity = 0
    this.barGroup.add(rankSprite)

    return { index, entry, bar, billboard, canvas, texture, rankSprite, rankCanvas, rankTexture, targetX, finalHeight }
  }

  play(): void {
    if (this.slots.length === 0) return
    this.playing = true
    this.autoPan = this.layout.halfRangeWorld > 0
    this.playStart = performance.now()
    this.callbacks.onPlayStart?.()
  }

  /**
   * 入场跟拍目标：第 k 根柱子落位时，视口右缘刚好让出它 + 一点余量；
   * updatePlay 在每根柱子的 dolly 窗口内于 [target(k-1), target(k)] 插值，
   * 间隔期保持静止，最后一根落位即平移结束。无需滚动（放不下前）时全 0。
   */
  private computePanScrolls(): void {
    const { halfRangeWorld, visibleWidth, worldPerPx } = this.layout
    if (halfRangeWorld <= 0 || worldPerPx <= 0) {
      this.panScrolls = []
      return
    }
    const rightMarginWorld = visibleWidth * 0.12
    const rangePx = (halfRangeWorld * 2) / worldPerPx
    this.panScrolls = this.slots.map((slot) => {
      // 目标：第 k 根落位时其屏幕位置 = 视口右缘 − 余量
      const desired = (slot.targetX + halfRangeWorld - visibleWidth / 2 + rightMarginWorld) / worldPerPx
      return Math.min(Math.max(desired, 0), rangePx)
    })
  }

  replay(): void {
    // 从已滚动位置重播：先把镜头与滚动条归零，否则跟拍插值起点错误
    this.scrollPx = 0
    this.applyScroll()
    this.callbacks.onAutoScroll?.(0)
    this.play()
  }

  /** F 键：相机复位并按当前条目数重新适配视口。 */
  refitView(): void {
    this.fitCamera(Math.max(this.countInView(), 1))
    this.callbacks.onLayout?.()
  }

  /** 内容宽于视口时的横向滚动范围（CSS px）；0 = 无需滚动。 */
  getScrollRangePx(): number {
    return Math.round((this.layout.halfRangeWorld * 2) / this.layout.worldPerPx)
  }

  /** 当前等效滚动位置（入场跟拍 / 用户滚动共同维护，scene 为事实源） */
  getScrollPx(): number {
    return this.scrollPx
  }

  /** 宿主滚动容器驱动的位移（CSS px）；背景固定不动，形成视差。 */
  setScrollPx(px: number): void {
    this.scrollPx = Math.max(0, px)
    this.applyScroll()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()
    this.tracker.destroy()
    this.controls.dispose()
    this.clearSlots()
    this.bgTexture.dispose()
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite || object instanceof THREE.LineSegments) {
        object.geometry?.dispose?.()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((m) => m.dispose())
      }
    })
    this.composer.dispose()
    this.renderer.dispose()
    this.domElement.remove()
  }

  // ── 内部 ────────────────────────────────────────────────

  private countInView(): number {
    return this.slots.length
  }

  private applyScroll(): void {
    const offset = this.scrollPx * this.layout.worldPerPx
    const x = Math.min(this.layout.halfRangeWorld - offset, this.layout.halfRangeWorld)
    this.barGroup.position.x = Math.max(x, -this.layout.halfRangeWorld)
  }

  /**
   * 布局解算：相机距离只由高度决定（条形+billboard 完整可见，透视不压扁名次高差）；
   * 柱宽 = 视口世界宽 / (count × 2)（一柱一空，撑满屏幕），受 [最小柱宽 30px, maxBarWidth] 约束；
   * 触到最小柱宽仍放不下 → halfRangeWorld > 0，交给横向滚动。
   */
  private fitCamera(count: number): void {
    const width = this.container.clientWidth || 1
    const height = this.container.clientHeight || 1
    const tanHalf = Math.tan((CONFIG.fov / 2) * (Math.PI / 180))
    const n = Math.max(count, 1)
    const aspect = width / height

    // 相机距离只由高度决定；宽度靠柱宽 + 横向滚动消化
    const dist = (CONFIG.maxBarHeight + 3.8) / (2 * tanHalf)

    const visibleWidth = 2 * tanHalf * dist * aspect
    const worldPerPx = visibleWidth / width

    const ideal = (visibleWidth * CONFIG.widthFill) / (n * CONFIG.spacingFactor)
    const minWorld = CONFIG.minBarPx * worldPerPx
    const barWidth = Math.max(Math.min(ideal, CONFIG.maxBarWidth), minWorld)
    const fieldWidth = barWidth * n * CONFIG.spacingFactor
    const halfRangeWorld = Math.max((fieldWidth - visibleWidth) / 2, 0)

    this.layout = {
      barWidth,
      spacing: barWidth * CONFIG.spacingFactor,
      worldPerPx,
      halfRangeWorld,
      visibleWidth,
      dollyDepth: Math.max(dist - CONFIG.dollyKeepDistance, 12),
    }

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.camera.position.set(0, CONFIG.cameraHeight, dist)
    this.controls.minDistance = dist * 0.4
    this.controls.maxDistance = dist * 2.4
    this.controls.update()
    this.applyScroll()
  }

  private clearSlots(): void {
    this.loadToken += 1
    for (const slot of this.slots) {
      this.barGroup.remove(slot.bar, slot.billboard, slot.rankSprite)
      slot.texture.dispose()
      slot.rankTexture.dispose()
      ;(slot.billboard.material as THREE.SpriteMaterial).dispose()
      ;(slot.rankSprite.material as THREE.SpriteMaterial).dispose()
    }
    this.slots = []
    this.panScrolls = []
    this.autoPan = false
    this.slotGeometry?.dispose()
    this.slotGeometry = null
    this.sharedBarMaterial?.dispose()
    this.sharedBarMaterial = null
    this.hoverSlot = null
    this.callbacks.onHover(null)
    this.playing = false
  }

  private handleResize(): void {
    if (this.disposed) return
    const width = this.container.clientWidth || 1
    const height = this.container.clientHeight || 1
    this.renderer.setSize(width, height)
    this.composer.setSize(width, height)
    this.applyBackgroundCover()
    this.fitCamera(Math.max(this.countInView(), 1))
    if (this.playing) {
      // layout 已变，跟拍目标必须跟着重算，否则插值打向过期位置
      this.computePanScrolls()
    }
    this.scrollPx = Math.min(this.scrollPx, this.getScrollRangePx())
    this.callbacks.onLayout?.()
  }

  /**
   * 背景图 cover 裁切（等效 CSS background-size: cover）：
   * 宽屏时按高度裁切、偏上锚定保住月轮；窄屏时按宽度裁切、水平居中。
   * 宽高比直接读容器而非 camera.aspect——camera.aspect 要到 fitCamera 才更新，
   * 依赖它会让背景永远按上一帧视口计算（resize 时画面被非等比拉扁的根因）。
   */
  private applyBackgroundCover(): void {
    const image = this.bgTexture.image as { width?: number; height?: number } | undefined
    if (!image?.width || !image.height) return
    const imageAspect = image.width / image.height
    const viewportAspect = (this.container.clientWidth || 1) / (this.container.clientHeight || 1)
    if (viewportAspect > imageAspect) {
      const visible = imageAspect / viewportAspect
      this.bgTexture.repeat.set(1, visible)
      this.bgTexture.offset.set(0, (1 - visible) * 0.42)
    } else {
      const visible = viewportAspect / imageAspect
      this.bgTexture.repeat.set(visible, 1)
      this.bgTexture.offset.set((1 - visible) / 2, 0)
    }
    this.bgTexture.updateMatrix()
  }

  private loadAvatars(): void {
    const token = this.loadToken
    void loadBillboardAvatars(
      this.slots.map((slot) => ({
        entry: slot.entry,
        canvas: slot.canvas,
        texture: slot.texture,
      })),
      () => this.disposed || token !== this.loadToken,
    )
  }

  /** 附加精灵的入场统一表达：起跳前隐藏、随进度淡入、跟随柱体 z */
  private animateSprite(sprite: THREE.Sprite, p: number, x: number, y: number, z: number): void {
    sprite.visible = p > 0
    ;(sprite.material as THREE.SpriteMaterial).opacity = Math.min(p * 2.4, 1)
    sprite.position.set(x, y, z)
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
    const { dollyDepth } = this.layout
    let allDone = true
    let autoScrollPx = this.scrollPx

    this.slots.forEach((slot, k) => {
      const start = starts[slot.index] ?? 0
      const p = slotProgress(elapsed, start, this.choreo.growMs)
      if (p < 1) allDone = false
      slot.bar.visible = p > 0
      const grow = easeOutBack(p)
      // 出场 = 从远处（背景方向）向镜头推近；z 用单调缓动，不回弹穿帮
      const dolly = easeOutCubic(Math.min(p * 1.35, 1))

      slot.bar.scale.y = Math.max(slot.finalHeight * grow, 0.0001)
      slot.bar.position.z = -dollyDepth * (1 - dolly)

      const currentTop = Math.max(slot.finalHeight * grow, 0.001)
      this.animateSprite(slot.billboard, p, slot.targetX, currentTop + 0.85, slot.bar.position.z)
      this.animateSprite(
        slot.rankSprite,
        p,
        slot.targetX,
        CONFIG.rankPlateY,
        slot.bar.position.z + this.layout.barWidth * CONFIG.rankPlateDepth,
      )

      // 自动跟拍：与柱子 dolly 同步插值；未起跳/落位后保持不变 → 间隔期静止
      if (this.autoPan && p > 0 && this.panScrolls.length > 0) {
        const prev = k === 0 ? 0 : this.panScrolls[k - 1] ?? 0
        autoScrollPx = prev + ((this.panScrolls[k] ?? prev) - prev) * dolly
      }
    })

    if (this.autoPan && Math.abs(autoScrollPx - this.scrollPx) > 0.01) {
      this.scrollPx = autoScrollPx
      this.applyScroll()
      this.callbacks.onAutoScroll?.(Math.round(autoScrollPx))
    }

    if (allDone) {
      this.playing = false
      this.autoPan = false
      this.callbacks.onEnded?.()
    }
  }
}
