import { useEffect, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"

interface IDragPreviewState {
  itemId: string
  pointerX: number
  pointerY: number
  offsetX: number
  offsetY: number
}

interface IUseSortableTabDndOptions {
  itemIds: string[]
  onReorder: (sourceItemId: string, targetItemId: string) => void
  dataAttribute: string
  canStartDrag?: (event: ReactPointerEvent<HTMLElement>, itemId: string) => boolean
}

export function useSortableTabDnd({
  itemIds,
  onReorder,
  dataAttribute,
  canStartDrag,
}: IUseSortableTabDndOptions) {
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<IDragPreviewState | null>(null)

  useEffect(() => {
    const stopDrag = () => {
      setDraggingItemId(null)
      setDragPreview(null)
    }
    window.addEventListener("pointerup", stopDrag)
    return () => {
      window.removeEventListener("pointerup", stopDrag)
    }
  }, [])

  useEffect(() => {
    if (!draggingItemId || !dragPreview) return

    const handlePointerMove = (event: PointerEvent) => {
      if ((event.buttons & 1) !== 1) return
      setDragPreview((currentDragPreview) =>
        currentDragPreview
          ? {
              ...currentDragPreview,
              pointerX: event.clientX,
              pointerY: event.clientY,
            }
          : currentDragPreview,
      )

      const hoveredElement = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest(`[${dataAttribute}]`)
      const targetItemId = hoveredElement?.getAttribute(dataAttribute)
      if (!targetItemId || targetItemId === draggingItemId) return

      const draggedItemIndex = itemIds.findIndex((itemId) => itemId === draggingItemId)
      const targetItemIndex = itemIds.findIndex((itemId) => itemId === targetItemId)
      if (draggedItemIndex < 0 || targetItemIndex < 0) return

      const hoveredRect = (hoveredElement as HTMLElement).getBoundingClientRect()
      const hoveredMidpointX = hoveredRect.left + hoveredRect.width / 2
      const isMovingRight = draggedItemIndex < targetItemIndex
      const isMovingLeft = draggedItemIndex > targetItemIndex
      if (isMovingRight && event.clientX < hoveredMidpointX) return
      if (isMovingLeft && event.clientX > hoveredMidpointX) return

      onReorder(draggingItemId, targetItemId)
    }

    window.addEventListener("pointermove", handlePointerMove)
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
    }
  }, [dataAttribute, dragPreview, draggingItemId, itemIds, onReorder])

  const onItemPointerDown = (event: ReactPointerEvent<HTMLElement>, itemId: string) => {
    if (event.button !== 0) return
    if (canStartDrag && !canStartDrag(event, itemId)) return
    const targetRect = event.currentTarget.getBoundingClientRect()
    setDraggingItemId(itemId)
    setDragPreview({
      itemId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: event.clientX - targetRect.left,
      offsetY: event.clientY - targetRect.top,
    })
  }

  const onItemPointerUp = () => {
    setDraggingItemId(null)
    setDragPreview(null)
  }

  return {
    draggingItemId,
    dragPreview,
    onItemPointerDown,
    onItemPointerUp,
  }
}
