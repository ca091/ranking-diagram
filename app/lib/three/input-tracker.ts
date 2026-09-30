/** canvas 指针交互追踪：NDC 坐标、hover 内/拖拽状态；与场景逻辑解耦（评审 Divergent Change）。 */

export class PointerTracker {
  inside = false
  dragging = false
  ndcX = 0
  ndcY = 0

  constructor(
    private readonly element: HTMLElement,
    private readonly rectProvider: () => DOMRect,
    private readonly onLeave?: () => void,
  ) {
    element.addEventListener('pointermove', this.handleMove)
    element.addEventListener('pointerleave', this.handleLeave)
    element.addEventListener('pointerdown', this.handleDown)
    element.addEventListener('pointerup', this.handleUp)
  }

  private readonly handleMove = (event: PointerEvent): void => {
    const rect = this.rectProvider()
    this.inside = true
    this.ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  private readonly handleLeave = (): void => {
    this.inside = false
    this.onLeave?.()
  }

  private readonly handleDown = (): void => {
    this.dragging = true
  }

  private readonly handleUp = (): void => {
    this.dragging = false
  }

  destroy(): void {
    this.element.removeEventListener('pointermove', this.handleMove)
    this.element.removeEventListener('pointerleave', this.handleLeave)
    this.element.removeEventListener('pointerdown', this.handleDown)
    this.element.removeEventListener('pointerup', this.handleUp)
  }
}
