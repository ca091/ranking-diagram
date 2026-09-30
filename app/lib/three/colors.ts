import * as THREE from 'three'

/** 名次配色（设计共识 Q23）：冷色渐变，冠军金色。纯函数。 */
const WEAK = new THREE.Color('#1f3a5f')
const STRONG = new THREE.Color('#58a6ff')
const CHAMPION = new THREE.Color('#ffd166')

export const CHAMPION_HEX = '#ffd166'

export function rankAccent(rank: number, count: number): THREE.Color {
  if (rank === 1) return CHAMPION.clone()
  const span = Math.max(count - 2, 1)
  const t = Math.min(Math.max((count - rank) / span, 0), 1)
  return WEAK.clone().lerp(STRONG, t)
}

export function rankAccentHex(rank: number, count: number): string {
  return `#${rankAccent(rank, count).getHexString()}`
}
