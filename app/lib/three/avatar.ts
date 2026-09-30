/**
 * Billboard 贴图绘制（设计共识 Q15）：圆形头像 + 首字母占位 + 名称，
 * 合成为一张 canvas 交给 THREE.Sprite（始终面向相机）。
 */
import { CHAMPION_HEX } from './colors'

export const BILLBOARD_W = 512
export const BILLBOARD_H = 416

const FONT_STACK = 'ui-sans-serif, system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'

export interface BillboardInput {
  name: string
  rank: number
  accentHex: string
  /** 经 /api/img 代理后成功解码的图像；缺省为首字母占位。 */
  image: HTMLImageElement | null
}

function clipCover(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement,
  cx: number,
  cy: number,
  radius: number,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.clip()
  const sw = source.naturalWidth || source.width
  const sh = source.naturalHeight || source.height
  if (sw > 0 && sh > 0) {
    const scale = Math.max((radius * 2) / sw, (radius * 2) / sh)
    const dw = sw * scale
    const dh = sh * scale
    ctx.drawImage(source, cx - dw / 2, cy - dh / 2, dw, dh)
  }
  ctx.restore()
}

function ellipsize(name: string, max = 12): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

export function drawBillboard(canvas: HTMLCanvasElement, input: BillboardInput): void {
  canvas.width = BILLBOARD_W
  canvas.height = BILLBOARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { name, rank, accentHex, image } = input
  const isChampion = rank === 1
  const centerX = BILLBOARD_W / 2
  const avatarR = 132

  ctx.clearRect(0, 0, BILLBOARD_W, BILLBOARD_H)

  // 底盘圆（占位底色）
  ctx.save()
  ctx.beginPath()
  ctx.arc(centerX, 170, avatarR + 8, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(10, 14, 24, 0.9)'
  ctx.fill()
  ctx.lineWidth = isChampion ? 10 : 6
  ctx.strokeStyle = accentHex
  ctx.stroke()
  if (isChampion) {
    ctx.shadowColor = CHAMPION_HEX
    ctx.shadowBlur = 28
    ctx.stroke()
    ctx.shadowBlur = 0
  }
  ctx.restore()

  if (image) {
    clipCover(ctx, image, centerX, 170, avatarR)
  } else {
    const initial = name.trim().charAt(0) || '?'
    ctx.save()
    const grad = ctx.createLinearGradient(centerX - avatarR, 38, centerX + avatarR, 302)
    grad.addColorStop(0, `${accentHex}dd`)
    grad.addColorStop(1, 'rgba(15, 23, 42, 0.92)')
    ctx.beginPath()
    ctx.arc(centerX, 170, avatarR, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.fillStyle = '#f8fafc'
    ctx.font = `600 130px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initial, centerX, 186)
    ctx.restore()
  }

  // 名次徽章
  ctx.save()
  ctx.beginPath()
  ctx.arc(112, 92, 44, 0, Math.PI * 2)
  ctx.fillStyle = isChampion ? CHAMPION_HEX : 'rgba(15, 23, 42, 0.92)'
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = isChampion ? '#fff7d6' : accentHex
  ctx.stroke()
  ctx.fillStyle = isChampion ? '#1a1505' : '#e2e8f0'
  ctx.font = `700 ${rank > 99 ? 34 : 42}px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(rank), 112, 96)
  ctx.restore()

  // 名称
  ctx.save()
  ctx.font = `600 44px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  if (isChampion) {
    ctx.shadowColor = CHAMPION_HEX
    ctx.shadowBlur = 18
  }
  ctx.fillStyle = '#f1f5f9'
  ctx.fillText(ellipsize(name), centerX, 330)
  ctx.restore()
}

/** 通过 /api/img 代理加载头像；任何失败返回 null（触发首字母占位）。 */
export function loadProxyImage(avatarUrl: string, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    let settled = false
    const finish = (value: HTMLImageElement | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    img.onload = () => finish(img)
    img.onerror = () => finish(null)
    img.src = `/api/img?url=${encodeURIComponent(avatarUrl)}`
  })
}
