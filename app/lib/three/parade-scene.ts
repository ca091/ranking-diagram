/**
 * Parade 场景（参考 threejs.org webgl_lights_sunlight 的第一人称驾驶感）：
 * 相机沿道路直线行进，视线恒定斜向左前方（~38°），柱子按名次倒序排在道路左侧
 * （#n 最先掠过、#1 最远压轴）。
 *
 * 单一 travel 标量（世界单位，沿道路弧长）贯穿全部运动：
 *   auto   —— 匀速推进：走完路径后继续 focus dolly（同速，衔接零突变），
 *             到全程末尾自动解锁；
 *   manual —— 按住 W 前进 / S 后退，同一条 travel 连续可逆，
 *             S 能一路退回开场构图，W 能重新推回冠军特写。
 * 路线几何纯函数在 ./parade-route.ts（可单测）。输入控件聚焦时不响应按键。
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { RankingEntry, RankingResult } from '#shared/ranking'
import { drawBillboard, drawRankPlate } from './avatar'
import { loadBillboardAvatars } from './avatar-loader'
import { entryColor, MOON_COLOR } from './colors'
import { PointerTracker } from './input-tracker'
import { cruiseEndZ, focusDolly, ROUTE } from './parade-route'

// ─── 类型 ────────────────────────────────────────────────

export interface HoverInfo {
  entry: RankingEntry
  /** 屏幕像素坐标（以容器左上角为原点） */
  x: number
  y: number
}

export interface ParadeCallbacks {
  onHover: (info: HoverInfo | null) => void
  /** auto（巡航 + focus dolly）全程走完、W/S 手动接管解锁 */
  onManualUnlocked?: () => void
}

interface ParadeSlot {
  entry: RankingEntry
  position: THREE.Vector3
  bar: THREE.Mesh
  billboard: THREE.Sprite
  rankSprite: THREE.Sprite
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  rankCanvas: HTMLCanvasElement
  rankTexture: THREE.CanvasTexture
}

// ─── 常量 ────────────────────────────────────────────────

const CONFIG = {
  fov: 50,
  clearColor: '#05070c',
  fogNear: 30,
  fogFar: 100,

  // 柱子与灯光
  barWidth: 1.6,
  barHeightBase: 0.5,
  barHeightScale: 7.5,
  barEmissive: '#1c2a3c',
  groundColor: '#0a0d14',
  laneMarkColor: '#1a2030',
  roadOffsetX: -6, // 柱子在道路中线左侧
  cameraOffsetX: 4, // 相机车道在中线右侧（右移让公路整体入画，呈左下→右上对角线）

  // 视线：lookAt = 相机位置 + (-lookLeft, -lookDown, -lookAhead)，全程恒定（~38° 左偏）
  // dolly 沿道路 -z 轴推进；冠军越近，其方位角 atan(横向距离/dz) 越接近视线角 → 自动居中
  lookLeft: 22,
  lookAhead: 28,
  lookDown: 0.5,
  cameraHeight: 6,

  // 运动：moveSpeedPerSec 为「路径弧长比例/秒」（0.03 ≈ 33s 全程），auto/manual 共用
  moveSpeedPerSec: 0.03,
  frameDtCapSec: 0.1, // 掉帧钳制，防止后台恢复时跳变

  // 场景装饰
  groundWidth: 60,
  groundDepth: 200,
  groundCenterZ: -60,
  laneMarkCount: 40,
  laneMarkStep: 5,
  moonLightPos: [15, 13, -30] as const,
  fillLightPos: [-4, 9, 16] as const,

  // 后处理
  bloomStrength: 0.35,
  bloomRadius: 0.4,
  bloomThreshold: 0.2,

  // billboard / 名次牌尺寸
  billboardW: 512,
  billboardH: 416,
  billboardScaleX: 3.2,
  billboardScaleY: 2.6,
  billboardClearance: 1.8, // 柱顶之上的悬浮高度
  rankPlateY: 0.6,

  // hover 投影锚点
  hoverAnchorRatio: 0.6,
  hoverAnchorLift: 2,
} as const

// ─── 主类 ────────────────────────────────────────────────

export class ParadeStage {
  private disposed = false
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer
  private container: HTMLElement
  private callbacks: ParadeCallbacks

  private barGroup: THREE.Group
  private slots: ParadeSlot[] = []

  // 路线：travel ∈ [0, routeLen + extraLen]，弧长单位
  private cameraPath: THREE.CatmullRomCurve3 | null = null
  private routeLen = 1
  private extraLen = 0
  private travel = 0

  // auto：巡航 + focus 连续推进；manual：W/S 接管
  private mode: 'idle' | 'auto' | 'manual' = 'idle'
  private keys = { forward: false, backward: false }
  private lastFrameTime = 0
  private loadToken = 0

  private tracker: PointerTracker
  private raycaster = new THREE.Raycaster()
  private mouseNdc = new THREE.Vector2()
  private hoverSlot: ParadeSlot | null = null
  private resizeObserver: ResizeObserver | null = null

  constructor(container: HTMLElement, callbacks: ParadeCallbacks) {
    this.container = container
    this.callbacks = callbacks

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(new THREE.Color(CONFIG.clearColor))
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    this.renderer.setSize(w, h)
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(CONFIG.clearColor)
    this.scene.fog = new THREE.Fog(CONFIG.clearColor, CONFIG.fogNear, CONFIG.fogFar)
    this.camera = new THREE.PerspectiveCamera(CONFIG.fov, w / h, 0.1, 200)

    this.addSceneDressing()
    this.composer = this.createComposer(w, h)

    this.tracker = new PointerTracker(
      this.renderer.domElement,
      () => this.renderer.domElement.getBoundingClientRect(),
      () => { this.hoverSlot = null; this.callbacks.onHover(null) },
    )
    window.addEventListener('keydown', this.handleKey)
    window.addEventListener('keyup', this.handleKey)

    this.barGroup = new THREE.Group()
    this.scene.add(this.barGroup)

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(container)

    // 初始机位（还没数据时也保持正确的朝左前方视角）
    this.rebuildRoute(2)
    this.lastFrameTime = performance.now()
    this.animate()
  }

  // ─── 公开 API ──────────────────────────────────────────

  setResult(result: RankingResult): void {
    this.clearSlots()
    const entries = result.entries
    if (!entries || entries.length === 0) return

    this.rebuildRoute(entries.length)
    this.buildColumns(entries)

    const token = this.loadToken
    void loadBillboardAvatars(
      this.slots.map((s) => ({ entry: s.entry, canvas: s.canvas, texture: s.texture })),
      () => this.disposed || token !== this.loadToken,
    )
  }

  /** 回起点重播：travel 归零，重新进入 auto（巡航 + focus 全程再来一次） */
  replay(): void {
    this.travel = 0
    this.mode = 'auto'
    this.updateCamera()
  }

  dispose(): void {
    this.disposed = true
    window.removeEventListener('keydown', this.handleKey)
    window.removeEventListener('keyup', this.handleKey)
    this.tracker.destroy()
    this.resizeObserver?.disconnect()
    this.clearSlots()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ─── 路线与相机 ────────────────────────────────────────

  /** 按柱数重建巡航路径并复位 travel；路线数学全部来自 parade-route 纯函数 */
  private rebuildRoute(count: number): void {
    const x = CONFIG.cameraOffsetX
    const y = CONFIG.cameraHeight
    const endZ = cruiseEndZ(count)
    const span = ROUTE.startZ - endZ
    this.cameraPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, y, ROUTE.startZ),
      new THREE.Vector3(x, y, ROUTE.startZ - span * 0.25),
      new THREE.Vector3(x, y, ROUTE.startZ - span * 0.5),
      new THREE.Vector3(x, y, ROUTE.startZ - span * 0.75),
      new THREE.Vector3(x, y, endZ),
    ], false, 'catmullrom', 0.5)
    this.routeLen = this.cameraPath.getLength()
    this.extraLen = focusDolly(count)
    this.travel = 0
    this.mode = 'auto'
    this.updateCamera()
  }

  /** 按当前 travel 摆放相机：路径弧长 + 超出部分沿道路 -z 续推（focus dolly） */
  private updateCamera(): void {
    if (!this.cameraPath) return
    const onPath = Math.min(this.travel / this.routeLen, 1)
    const point = this.cameraPath.getPointAt(onPath)
    const over = Math.max(0, this.travel - this.routeLen)
    this.camera.position.set(point.x, point.y, point.z - over)
    // lookAt 偏移相对相机恒定 → 视线方向全程不变（~38° 左偏）
    this.camera.lookAt(
      point.x - CONFIG.lookLeft,
      point.y - CONFIG.lookDown,
      point.z - over - CONFIG.lookAhead,
    )
  }

  // ─── 场景搭建 ──────────────────────────────────────────

  private addSceneDressing(): void {
    this.scene.add(new THREE.HemisphereLight('#3b465e', '#05070c', 0.6))
    const moon = new THREE.DirectionalLight(MOON_COLOR, 0.9)
    moon.position.set(...CONFIG.moonLightPos)
    this.scene.add(moon)
    const fill = new THREE.DirectionalLight('#93a8c8', 0.5)
    fill.position.set(...CONFIG.fillLightPos)
    this.scene.add(fill)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CONFIG.groundWidth, CONFIG.groundDepth),
      new THREE.MeshStandardMaterial({ color: CONFIG.groundColor, roughness: 0.95, metalness: 0.1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.set(0, -0.01, CONFIG.groundCenterZ)
    this.scene.add(ground)

    const lineMat = new THREE.MeshBasicMaterial({ color: CONFIG.laneMarkColor })
    const lineGeo = new THREE.PlaneGeometry(0.15, 2)
    for (let i = 0; i < CONFIG.laneMarkCount; i++) {
      const line = new THREE.Mesh(lineGeo, lineMat)
      line.rotation.x = -Math.PI / 2
      line.position.set(0, 0.01, -i * CONFIG.laneMarkStep)
      this.scene.add(line)
    }
  }

  private createComposer(w: number, h: number): EffectComposer {
    const composer = new EffectComposer(this.renderer)
    composer.addPass(new RenderPass(this.scene, this.camera))
    composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(w, h),
        CONFIG.bloomStrength,
        CONFIG.bloomRadius,
        CONFIG.bloomThreshold,
      ),
    )
    composer.addPass(new OutputPass())
    return composer
  }

  /** 柱子按名次倒序：rank 越大离相机越近（先掠过），#1 最远压轴 */
  private buildColumns(entries: readonly RankingEntry[]): void {
    for (const entry of entries) {
      const z = ROUTE.columnStartZ - (entries.length - entry.rank) * ROUTE.spacing
      this.slots.push(this.createSlot(entry, CONFIG.roadOffsetX, z))
    }
  }

  private createSlot(entry: RankingEntry, x: number, z: number): ParadeSlot {
    const barHeight = CONFIG.barHeightBase + (entry.score / 100) * CONFIG.barHeightScale
    const position = new THREE.Vector3(x, barHeight / 2, z)

    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(CONFIG.barWidth, barHeight, CONFIG.barWidth),
      new THREE.MeshStandardMaterial({
        color: entryColor(),
        emissive: new THREE.Color(CONFIG.barEmissive),
        roughness: 0.4,
        metalness: 0.3,
      }),
    )
    bar.position.copy(position)

    const canvas = document.createElement('canvas')
    canvas.width = CONFIG.billboardW
    canvas.height = CONFIG.billboardH
    drawBillboard(canvas, { name: entry.name, image: null })
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const billboard = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    )
    billboard.scale.set(CONFIG.billboardScaleX, CONFIG.billboardScaleY, 1)
    billboard.position.set(x, barHeight + CONFIG.billboardClearance, z)

    // drawRankPlate 自带画布尺寸与样式
    const rankCanvas = document.createElement('canvas')
    drawRankPlate(rankCanvas, entry.rank)
    const rankTexture = new THREE.CanvasTexture(rankCanvas)
    rankTexture.colorSpace = THREE.SRGBColorSpace
    const rankSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: rankTexture, transparent: true, depthTest: false }),
    )
    rankSprite.scale.set(1.2, 0.9, 1)
    rankSprite.position.set(x, CONFIG.rankPlateY, z)

    this.barGroup.add(bar, billboard, rankSprite)
    return { entry, position, bar, billboard, rankSprite, canvas, texture, rankCanvas, rankTexture }
  }

  private clearSlots(): void {
    this.loadToken += 1
    for (const slot of this.slots) {
      this.barGroup.remove(slot.bar, slot.billboard, slot.rankSprite)
      slot.bar.geometry.dispose()
      ;(slot.bar.material as THREE.Material).dispose()
      slot.texture.dispose()
      ;(slot.billboard.material as THREE.SpriteMaterial).dispose()
      slot.rankTexture.dispose()
      ;(slot.rankSprite.material as THREE.SpriteMaterial).dispose()
    }
    this.slots = []
    this.hoverSlot = null
    this.callbacks.onHover(null)
  }

  // ─── 输入与循环 ────────────────────────────────────────

  /** W/S 按键：跳过输入控件里的打字，避免输 prompt 时误触发移动 */
  private handleKey = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const key = event.key.toLowerCase()
    if (key !== 'w' && key !== 's') return
    const pressed = event.type === 'keydown'
    if (key === 'w') this.keys.forward = pressed
    else this.keys.backward = pressed
    if (pressed) event.preventDefault()
  }

  private animate = (): void => {
    if (this.disposed) return
    requestAnimationFrame(this.animate)

    const now = performance.now()
    const dt = Math.min((now - this.lastFrameTime) / 1000, CONFIG.frameDtCapSec)
    this.lastFrameTime = now

    const unitsPerSec = this.routeLen * CONFIG.moveSpeedPerSec
    const totalLen = this.routeLen + this.extraLen
    if (this.mode === 'auto') {
      // 巡航 + focus dolly 以同一线速度连续推进 → 衔接处无速度差（评审 (c)1 平滑性）
      this.travel = Math.min(this.travel + unitsPerSec * dt, totalLen)
      if (this.travel >= totalLen) {
        this.mode = 'manual'
        this.callbacks.onManualUnlocked?.()
      }
      this.updateCamera()
    } else if (this.mode === 'manual') {
      const drive = (this.keys.forward ? 1 : 0) - (this.keys.backward ? 1 : 0)
      if (drive !== 0) {
        this.travel = Math.min(Math.max(this.travel + drive * unitsPerSec * dt, 0), totalLen)
        this.updateCamera()
      }
    }

    this.updateHover()
    this.composer.render()
  }

  private handleResize(): void {
    if (this.disposed) return
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // ─── hover ────────────────────────────────────────────

  private updateHover(): void {
    if (this.slots.length === 0) return
    this.mouseNdc.set(this.tracker.ndcX, this.tracker.ndcY)
    this.raycaster.setFromCamera(this.mouseNdc, this.camera)

    const intersects = this.raycaster.intersectObjects(this.slots.map((s) => s.bar))
    if (intersects.length > 0) {
      const hit = intersects[0]!.object as THREE.Mesh
      const slot = this.slots.find((s) => s.bar === hit)
      if (slot && slot !== this.hoverSlot) {
        this.hoverSlot = slot
        const projected = this.projectBarTop(slot)
        this.callbacks.onHover({ entry: slot.entry, x: projected.x, y: projected.y })
      }
    } else if (this.hoverSlot) {
      this.hoverSlot = null
      this.callbacks.onHover(null)
    }
  }

  private projectBarTop(slot: ParadeSlot): { x: number; y: number } {
    const top = slot.position.clone()
    top.y += CONFIG.barHeightScale * CONFIG.hoverAnchorRatio + CONFIG.hoverAnchorLift
    top.project(this.camera)
    const rect = this.renderer.domElement.getBoundingClientRect()
    return {
      x: ((top.x + 1) / 2) * rect.width,
      y: ((-top.y + 1) / 2) * rect.height,
    }
  }
}
