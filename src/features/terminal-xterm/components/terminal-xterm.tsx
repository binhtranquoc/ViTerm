import "@xterm/xterm/css/xterm.css"

import { useEffect, useState, useRef } from "react"

import type { FitAddon } from "@xterm/addon-fit"
import type { Terminal } from "@xterm/xterm"
import { DEFAULT_STARTUP_ARGS } from "@/features/terminal-xterm/constants/terminal-input.const"
import { TERMINAL_REFIT_DELAY_MS } from "@/features/terminal-xterm/constants/terminal-xterm.const"
import { useTerminalInput } from "@/features/terminal-xterm/hooks/use-terminal-input"
import {
  invokeTauri,
  isTauriRuntime,
  useTerminalXtermModules,
} from "@/features/terminal-xterm/hooks/use-terminal-pty"
import { decodeBase64ToBytes } from "@/shared/lib/base64"

interface Props {
  tabId: string
  isActive: boolean
  cwd?: string
  hostId?: string
  startupProgram?: string
  startupArgs?: string[]
  reconnectNonce?: number
  onRequestEditHost?: (hostId: string, tabId: string) => void
  contentPadding?: number
  keepSessionOnUnmount?: boolean
}

interface ITerminalSessionSnapshot {
  hostId?: string
  instanceId?: string
}

const terminalSessionRegistry = new Map<string, ITerminalSessionSnapshot>()
const terminalOutputSnapshot = new Map<string, string>()
const TERMINAL_OUTPUT_SNAPSHOT_MAX_CHARS = 200_000

export function TerminalXterm({
  tabId,
  isActive,
  cwd = "~",
  hostId,
  startupProgram,
  startupArgs = DEFAULT_STARTUP_ARGS,
  reconnectNonce = 0,
  onRequestEditHost,
  contentPadding = 0,
  keepSessionOnUnmount = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "failed">(
    hostId ? "connecting" : "connected",
  )
  const [connectError, setConnectError] = useState("")

  const xtermModulesResource = useTerminalXtermModules()
  const { sendToPty, clearPendingInputBatch, attachTextareaImeGuards } = useTerminalInput(tabId)

  // Re-fit + focus whenever this tab becomes active
  useEffect(() => {
    if (isActive) {
      const t = setTimeout(() => {
        fitRef.current?.fit()
        termRef.current?.focus()
      }, TERMINAL_REFIT_DELAY_MS)
      return () => clearTimeout(t)
    }
  }, [isActive])

  useEffect(() => {
    setConnectionState(hostId ? "connecting" : "connected")
    setConnectError("")
  }, [hostId, tabId, reconnectNonce])

  useEffect(() => {
    if (!containerRef.current) return
    if (!xtermModulesResource.data) return
    let cancelled = false
    let unlistenEvent: (() => void) | undefined
    let hasUnlistened = false
    let instanceId: string | null = null
    let hasReportedSshFailure = false

    const markFailed = (reason: string) => {
      hasReportedSshFailure = true
      setConnectionState("failed")
      setConnectError(reason.trim() || "SSH connection failed")
    }

    const safeUnlisten = (fn?: () => void) => {
      if (!fn || hasUnlistened) return
      hasUnlistened = true
      try {
        Promise.resolve(fn()).catch((error) => {
          void error
        })
      } catch (error) {
        void error
      }
    }

    const init = async () => {
      const { Terminal, FitAddon } = xtermModulesResource.data

      if (cancelled || !containerRef.current) return

      const term = new Terminal({
        fontFamily: '"Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: true,
        scrollback: 5000,
        theme: {
          background: "#09090b",
          foreground: "#f4f4f5",
          cursor: "#f4f4f5",
          cursorAccent: "#09090b",
          selectionBackground: "#3f3f46",
          black: "#18181b",
          brightBlack: "#3f3f46",
          red: "#ef4444",
          brightRed: "#f87171",
          green: "#22c55e",
          brightGreen: "#4ade80",
          yellow: "#eab308",
          brightYellow: "#facc15",
          blue: "#3b82f6",
          brightBlue: "#60a5fa",
          magenta: "#a855f7",
          brightMagenta: "#c084fc",
          cyan: "#06b6d4",
          brightCyan: "#22d3ee",
          white: "#f4f4f5",
          brightWhite: "#ffffff",
        },
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()

      termRef.current = term
      fitRef.current = fitAddon

      const existingOutput = terminalOutputSnapshot.get(tabId)
      if (existingOutput) {
        term.write(existingOutput)
      }

      if (!isTauriRuntime()) {
        term.write(
          "\x1b[33m[dev mode]\x1b[0m Terminal requires Tauri runtime.\r\n" +
            "Run: \x1b[32mpnpm tauri dev\x1b[0m\r\n",
        )
        return
      }

      // Open the PTY session — receive instanceId for safe cleanup
      try {
        const existing = terminalSessionRegistry.get(tabId)
        const canReuseSession = !!existing && (existing.hostId ?? "") === (hostId ?? "")
        if (existing && canReuseSession) {
          instanceId = existing.instanceId ?? null
          if (hostId) {
            setConnectionState("connected")
            setConnectError("")
          }
        } else {
          if (hostId) {
            instanceId = await invokeTauri<string>("open_ssh_host_terminal", {
              hostId,
              tabId,
              cols: term.cols,
              rows: term.rows,
            })
          } else {
            instanceId = await invokeTauri<string>("open_pty", {
              tabId,
              cwd,
              program: startupProgram,
              args: startupArgs,
              cols: term.cols,
              rows: term.rows,
            })
          }
          if (cancelled) {
            if (instanceId) {
              if (hostId) {
                void invokeTauri("stop_ssh_host_terminal", { tabId }).catch(() => {})
              }
              void invokeTauri("close_pty", { tabId, instanceId }).catch(() => {})
            }
            return
          }
          terminalSessionRegistry.set(tabId, {
            hostId,
            instanceId: instanceId ?? undefined,
          })
        }
      } catch (err) {
        if (cancelled) return
        const reason = String(err)
        term.write(`\x1b[31m[PTY error: ${reason}]\x1b[0m\r\n`)
        if (hostId && !hasReportedSshFailure) markFailed(reason)
        return
      }

      // If StrictMode already unmounted us, close immediately
      if (cancelled) {
        if (!keepSessionOnUnmount && instanceId) {
          void invokeTauri("close_pty", { tabId, instanceId })
        }
        return
      }

      // Stream PTY output → xterm
      const { listen } = await import("@tauri-apps/api/event")
      const utf8Decoder = new TextDecoder()
      const unlisten = await listen<{ tab_id: string; data: string }>(
        "pty-output",
        (event) => {
          if (event.payload.tab_id !== tabId) return
          const bytes = decodeBase64ToBytes(event.payload.data)
          term.write(bytes)
          const chunkText = utf8Decoder.decode(bytes)
          const previous = terminalOutputSnapshot.get(tabId) ?? ""
          const merged = `${previous}${chunkText}`
          terminalOutputSnapshot.set(
            tabId,
            merged.length > TERMINAL_OUTPUT_SNAPSHOT_MAX_CHARS
              ? merged.slice(merged.length - TERMINAL_OUTPUT_SNAPSHOT_MAX_CHARS)
              : merged,
          )

          if (!hostId) return
          const output = chunkText.toLowerCase()
          const hasFailureHint =
            output.includes("permission denied") ||
            output.includes("host key verification failed") ||
            output.includes("connection refused") ||
            output.includes("connection timed out") ||
            output.includes("no route to host") ||
            output.includes("could not resolve hostname")
          if (hasFailureHint && !hasReportedSshFailure) {
            markFailed(output.trim() || "ssh connection failed")
            return
          }

          if (!hasReportedSshFailure && output.trim().length > 0) {
            setConnectionState("connected")
          }
        },
      )

      if (cancelled) {
        safeUnlisten(unlisten)
        if (!keepSessionOnUnmount && instanceId) {
          void invokeTauri("close_pty", { tabId, instanceId })
        }
        return
      }

      unlistenEvent = unlisten

      const imeCleanup = attachTextareaImeGuards(term)
      if (imeCleanup) {
        const prevUnlistenIme = unlistenEvent
        unlistenEvent = () => {
          prevUnlistenIme?.()
          imeCleanup()
        }
      }

      const dataDisposable = term.onData(sendToPty)

      // Resize → PTY ioctl
      term.onResize(({ cols, rows }) => {
        void invokeTauri("resize_pty", { tabId, cols, rows })
      })

      term.focus()

      const prevUnlisten = unlistenEvent
      unlistenEvent = () => {
        prevUnlisten?.()
        dataDisposable.dispose()
      }
    }

    void init()

    // ResizeObserver: debounce via rAF to avoid "loop completed" warnings
    let rafId: number | undefined
    let observer: ResizeObserver | undefined
    if (containerRef.current) {
      observer = new ResizeObserver(() => {
        if (rafId !== undefined) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          fitRef.current?.fit()
          rafId = undefined
        })
      })
      observer.observe(containerRef.current)
    }

    return () => {
      cancelled = true
      if (rafId !== undefined) cancelAnimationFrame(rafId)
      observer?.disconnect()
      safeUnlisten(unlistenEvent)
      clearPendingInputBatch()
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current = null
      // Important: open_ssh_host_terminal registers a reconnect session in
      // ssh_session_manager keyed by tabId. If we only close_pty, that
      // reconnect loop can still revive and attach SSH unexpectedly.
      if (!keepSessionOnUnmount) {
        terminalSessionRegistry.delete(tabId)
        terminalOutputSnapshot.delete(tabId)
        if (isTauriRuntime() && hostId) {
          void invokeTauri("stop_ssh_host_terminal", { tabId })
        }
        // Only close the PTY if we actually opened it (instanceId is set).
        // Passing instanceId prevents stale cleanups from killing a newer session.
        if (isTauriRuntime() && instanceId) {
          void invokeTauri("close_pty", { tabId, instanceId })
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, hostId, cwd, startupProgram, startupArgs, reconnectNonce, xtermModulesResource.data, sendToPty, clearPendingInputBatch, attachTextareaImeGuards, keepSessionOnUnmount])

  return (
    <div className="relative h-full w-full" style={{ padding: contentPadding }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {hostId && connectionState !== "connected" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#09090b]/90 p-4">
          <div className="w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-900/95 p-5">
            {connectionState === "connecting" ? (
              <div className="flex items-center gap-3 text-zinc-100">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-100" />
                <div>
                  <p className="text-sm font-semibold">Connecting to SSH...</p>
                  <p className="text-xs text-zinc-400">Please wait a moment.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-red-300">SSH connection failed</p>
                  <p className="mt-1 text-xs text-zinc-300">{connectError || "Unable to connect to this host."}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-700"
                    onClick={() => hostId && onRequestEditHost?.(hostId, tabId)}
                  >
                    Edit host
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
