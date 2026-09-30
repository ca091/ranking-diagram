/**
 * Billboard 贴图绘制：圆形头像 + 首字母占位 + 名称 + 名次徽章。
 * 全部条目同一套样式（无冠军特化），仅靠徽章数字与条形高度传递名次。
 */

export const BILLBOARD_W = 512
export const BILLBOARD_H = 416

const FONT_STACK = 'ui-sans-serif, system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const RING_COLOR = '#8298b6'
/** 柱脚名次：无背景、无描边的纯灰数字 */
const RANK_GRAY = '#8b93a1'

export interface BillboardInput {
  name: string
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
  const { name, image } = input
  const centerX = BILLBOARD_W / 2
  const avatarR = 132

  ctx.clearRect(0, 0, BILLBOARD_W, BILLBOARD_H)

  // 底盘圆（占位底色）
  ctx.beginPath()
  ctx.arc(centerX, 170, avatarR + 8, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(8, 11, 18, 0.92)'
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = RING_COLOR
  ctx.stroke()

  if (image) {
    clipCover(ctx, image, centerX, 170, avatarR)
  } else {
    const initial = name.trim().charAt(0) || '?'
    const grad = ctx.createLinearGradient(centerX - avatarR, 38, centerX + avatarR, 302)
    grad.addColorStop(0, 'rgba(52, 68, 90, 0.95)')
    grad.addColorStop(1, 'rgba(13, 18, 28, 0.95)')
    ctx.beginPath()
    ctx.arc(centerX, 170, avatarR, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.fillStyle = '#c9d6e8'
    ctx.font = `600 130px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initial, centerX, 186)
  }

  // 名称
  ctx.font = `600 44px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#d7dfec'
  ctx.fillText(ellipsize(name), centerX, 330)
}

/** 柱脚名次：透明背景，仅一个灰色数字（无任何样式） */
const RANK_PLATE_W = 160
const RANK_PLATE_H = 120
/** 精灵缩放只关心高宽比，原始画布尺寸不外泄 */
export const RANK_PLATE_ASPECT = RANK_PLATE_H / RANK_PLATE_W

export function drawRankPlate(canvas: HTMLCanvasElement, rank: number): void {
  canvas.width = RANK_PLATE_W
  canvas.height = RANK_PLATE_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, RANK_PLATE_W, RANK_PLATE_H)

  ctx.fillStyle = RANK_GRAY
  ctx.font = `500 ${rank > 99 ? 62 : 78}px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(rank), RANK_PLATE_W / 2, RANK_PLATE_H / 2)
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
