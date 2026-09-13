import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card } from '../types/card'

/**
 * Pointer-driven drag and drop for the board.
 *
 * Deliberately not the HTML5 drag-and-drop API: that gives you a browser-drawn
 * drag image you cannot style, fires no events over the source element, and is
 * effectively unusable on touch. Pointer events cost a little more code and let
 * the card actually follow the finger.
 *
 * The existing click-to-select flow stays intact — a drag only begins once the
 * pointer has travelled past `THRESHOLD`, so a plain click is still a click.
 */

export type DragPayload =
  | { kind: 'card'; card: Card }
  | { kind: 'unit'; instanceId: string; card: Card }

/** Where a drag can land. Mirrors the engine's own location shape. */
export type DropLocation = { kind: 'base' } | { kind: 'battlefield'; index: number }

/**
 * Zone ids travel through the DOM as `data-drop-zone` strings, so the writer
 * and the reader are separated by markup and cannot be type-checked against
 * each other. Keeping both halves here — and round-tripping them in a test —
 * is what stops a rename on one side from silently disabling every drop.
 */
export function zoneId(to: DropLocation): string {
  return to.kind === 'base' ? 'base' : `bf${to.index}`
}

export function parseZoneId(id: string): DropLocation | null {
  if (id === 'base') return { kind: 'base' }
  const m = /^bf(\d+)$/.exec(id)
  return m ? { kind: 'battlefield', index: Number(m[1]) } : null
}

/** Units are drop targets too — dropping a spell or gear on one casts it there. */
export function unitZoneId(instanceId: string): string {
  return `unit:${instanceId}`
}

export function parseUnitZoneId(id: string): string | null {
  return id.startsWith('unit:') && id.length > 5 ? id.slice(5) : null
}

/** Pixels of travel before a press becomes a drag rather than a click. */
const THRESHOLD = 6

interface DragState {
  payload: DragPayload
  x: number
  y: number
  /** `data-drop-zone` id currently under the pointer, if it accepts this drag. */
  over: string | null
}

export interface DragApi {
  drag: DragState | null
  /** Spread onto anything draggable. `enabled` false makes it inert. */
  handleProps(payload: DragPayload, enabled: boolean): Record<string, unknown>
  /** Spread onto a drop target. `id` is what `onDrop` receives. */
  zoneProps(id: string, enabled: boolean): Record<string, unknown>
  /** True if the click now firing is the tail of a drag and should be ignored. */
  consumeClick(): boolean
}

function zoneAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)
  const zone = (el as HTMLElement | null)?.closest('[data-drop-zone]') as HTMLElement | null
  if (!zone || zone.dataset.dropEnabled !== '1') return null
  return zone.dataset.dropZone ?? null
}

export function useDragDrop(onDrop: (payload: DragPayload, zoneId: string) => void): DragApi {
  const [drag, setDrag] = useState<DragState | null>(null)
  // Refs, not state: these are read inside window listeners that must not be
  // torn down and rebuilt on every pointermove.
  const startRef = useRef<{ x: number; y: number; payload: DragPayload } | null>(null)
  const activeRef = useRef(false)
  const justDraggedRef = useRef(false)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  const cancel = useCallback(() => {
    startRef.current = null
    activeRef.current = false
    setDrag(null)
  }, [])

  useEffect(() => {
    function move(e: PointerEvent) {
      const start = startRef.current
      if (!start) return
      if (!activeRef.current) {
        const far = Math.hypot(e.clientX - start.x, e.clientY - start.y) >= THRESHOLD
        if (!far) return
        activeRef.current = true
      }
      // Once dragging, stop the press from also selecting text or scrolling.
      e.preventDefault()
      setDrag({
        payload: start.payload,
        x: e.clientX,
        y: e.clientY,
        over: zoneAt(e.clientX, e.clientY),
      })
    }

    function up(e: PointerEvent) {
      const start = startRef.current
      if (!start) return
      if (activeRef.current) {
        const zone = zoneAt(e.clientX, e.clientY)
        // Swallow the click that the browser fires after this pointerup, so the
        // card underneath does not also get "selected" by the same gesture.
        justDraggedRef.current = true
        if (zone) onDropRef.current(start.payload, zone)
      }
      cancel()
    }

    function key(e: KeyboardEvent) {
      if (e.key === 'Escape' && startRef.current) cancel()
    }

    // Any new press starts a fresh gesture, so a suppression left over from the
    // last one is stale. This has to be on the window, not just the drag
    // handles: after dragging a unit you might click a spell card, which has no
    // handle of its own and would otherwise eat the stale flag.
    function down() {
      justDraggedRef.current = false
    }

    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [cancel])

  const handleProps = useCallback((payload: DragPayload, enabled: boolean) => {
    if (!enabled) return {}
    return {
      // `touch-action: none` (without it a touch drag scrolls the page instead
      // of moving the card) is applied via CSS on this attribute rather than an
      // inline `style`. A call site that also passes `style` would replace ours
      // wholesale and silently break touch — and it did, on the first one.
      'data-draggable': '1',
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return // left button / touch / pen only
        // Clear here rather than waiting for a click to consume it. A drag that
        // ends over a different element fires no click at all, so the flag would
        // survive the gesture and swallow the next real click instead — drag a
        // card, then click another, and nothing happens.
        justDraggedRef.current = false
        startRef.current = { x: e.clientX, y: e.clientY, payload }
        activeRef.current = false
      },
    }
  }, [])

  const zoneProps = useCallback(
    (id: string, enabled: boolean) => ({
      'data-drop-zone': id,
      'data-drop-enabled': enabled ? '1' : '0',
    }),
    [],
  )

  const consumeClick = useCallback(() => {
    if (!justDraggedRef.current) return false
    justDraggedRef.current = false
    return true
  }, [])

  return { drag, handleProps, zoneProps, consumeClick }
}
