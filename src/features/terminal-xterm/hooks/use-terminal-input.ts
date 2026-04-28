import { useCallback, useRef } from "react"

import type { Terminal } from "@xterm/xterm"
import {
  PLAIN_SYMBOL_BY_CODE,
  SHIFTED_DIGIT_BY_CODE,
  SHIFTED_SYMBOL_BY_CODE,
} from "@/features/terminal-xterm/constants/terminal-input.const"
import { invokeTauri } from "@/features/terminal-xterm/hooks/use-terminal-pty"
import { encodeStringToBase64 } from "@/shared/lib/base64"

function mapRawEnglishKey(event: KeyboardEvent): string | null {
  const keyToSendMap: Record<string, string> = {
    Enter: "\r",
    Backspace: "\u007f",
    Tab: "\t",
    Escape: "\u001b",
    ArrowUp: "\u001b[A",
    ArrowDown: "\u001b[B",
    ArrowRight: "\u001b[C",
    ArrowLeft: "\u001b[D",
    Space: " ",
  }

  const mappedSpecial = keyToSendMap[event.key] ?? keyToSendMap[event.code]
  if (mappedSpecial) return mappedSpecial

  if (event.code.startsWith("Key") && event.code.length === 4) {
    const letter = event.code.slice(3).toLowerCase()
    const shouldUpperCase = event.shiftKey !== event.getModifierState("CapsLock")
    return shouldUpperCase ? letter.toUpperCase() : letter
  }

  if (event.code.startsWith("Digit") && event.code.length === 6) {
    if (event.shiftKey) return SHIFTED_DIGIT_BY_CODE[event.code] ?? null
    return event.code.slice(5)
  }

  if (event.shiftKey) {
    return SHIFTED_SYMBOL_BY_CODE[event.code] ?? null
  }
  return PLAIN_SYMBOL_BY_CODE[event.code] ?? null
}

export function useTerminalInput(tabId: string) {
  const pendingBatchRef = useRef("")
  const batchScheduledRef = useRef(false)

  const flushBatch = useCallback(() => {
    batchScheduledRef.current = false
    if (!pendingBatchRef.current) return
    const data = pendingBatchRef.current
    pendingBatchRef.current = ""
    void invokeTauri("write_pty", { tabId, data: encodeStringToBase64(data) })
  }, [tabId])

  const sendToPty = useCallback(
    (text: string) => {
      if (!text) return
      pendingBatchRef.current += text
      if (!batchScheduledRef.current) {
        batchScheduledRef.current = true
        queueMicrotask(flushBatch)
      }
    },
    [flushBatch],
  )

  const clearPendingInputBatch = useCallback(() => {
    pendingBatchRef.current = ""
    batchScheduledRef.current = false
  }, [])

  const attachTextareaImeGuards = useCallback(
    (term: Terminal): (() => void) | undefined => {
      const textarea = (term as Terminal & { textarea?: HTMLTextAreaElement }).textarea
      if (!textarea) return undefined

      textarea.setAttribute("inputmode", "none")
      textarea.setAttribute("autocapitalize", "off")
      textarea.setAttribute("autocomplete", "off")
      textarea.setAttribute("autocorrect", "off")
      textarea.spellcheck = false

      let isComposing = false

      const clearTextarea = () => {
        if (textarea.value) textarea.value = ""
      }

      const handleKeydown = (e: KeyboardEvent) => {
        // Raw keyboard fallback for IME-held key events on macOS Vietnamese layout.
        if (e.keyCode !== 229) return
        const rawText = mapRawEnglishKey(e) ?? ""
        if (rawText) sendToPty(rawText)
        e.preventDefault()
        e.stopImmediatePropagation()
        clearTextarea()
      }

      const handleCompositionStart = () => {
        isComposing = true
        clearTextarea()
      }

      const handleCompositionUpdate = () => {
        clearTextarea()
      }

      const handleCompositionEnd = () => {
        isComposing = false
        queueMicrotask(clearTextarea)
      }

      const handleInput = (e: Event) => {
        if (isComposing || (e as InputEvent).isComposing) {
          e.stopImmediatePropagation()
          clearTextarea()
        }
      }

      textarea.addEventListener("keydown", handleKeydown, true)
      textarea.addEventListener("compositionstart", handleCompositionStart, true)
      textarea.addEventListener("compositionupdate", handleCompositionUpdate, true)
      textarea.addEventListener("compositionend", handleCompositionEnd, true)
      textarea.addEventListener("input", handleInput, true)

      return () => {
        textarea.removeEventListener("keydown", handleKeydown, true)
        textarea.removeEventListener("compositionstart", handleCompositionStart, true)
        textarea.removeEventListener("compositionupdate", handleCompositionUpdate, true)
        textarea.removeEventListener("compositionend", handleCompositionEnd, true)
        textarea.removeEventListener("input", handleInput, true)
      }
    },
    [sendToPty],
  )

  return {
    sendToPty,
    clearPendingInputBatch,
    attachTextareaImeGuards,
  }
}
