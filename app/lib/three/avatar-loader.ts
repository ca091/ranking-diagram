/** 头像异步装载（评审 Divergent Change 拆分件）：经 /api/img 代理取图，重绘 billboard 画布。 */
import type { CanvasTexture } from 'three'
import type { RankingEntry } from '#shared/ranking'
import { drawBillboard, loadProxyImage } from './avatar'

export interface AvatarLoadTarget {
  entry: RankingEntry
  canvas: HTMLCanvasElement
  texture: CanvasTexture
}

/**
 * 串行加载（并发≤30 张，代理侧另有缓存）；isStale 在每次 await 后检查，
 * 场景重建/销毁时立即放弃回写，避免向已 dispose 的 texture 涂数据。
 */
export async function loadBillboardAvatars(
  targets: AvatarLoadTarget[],
  isStale: () => boolean,
): Promise<void> {
  for (const target of targets) {
    const url = target.entry.avatarUrl
    if (!url) continue
    const image = await loadProxyImage(url)
    if (isStale() || !image) continue
    drawBillboard(target.canvas, {
      name: target.entry.name,
      image,
    })
    target.texture.needsUpdate = true
  }
}
