import * as THREE from 'three'

/**
 * 夜曲色板：条形完全统一（无冠军特化）；
 * 墓地场景由背景图 bg.webp 提供，这里只保留条形与对位月光的主光色。
 */
export const ENTRY_EMISSIVE = '#1c2a3c'
/** 冷月光主光颜色（对位背景图右上月轮） */
export const MOON_COLOR = '#aebbd4'

const ENTRY_COLOR = '#728dab'

/** 每次新建避免 three 对材质 color 的原地改写外溢到共享常量 */
export function entryColor(): THREE.Color {
  return new THREE.Color(ENTRY_COLOR)
}
