import { useMutation, useQuery } from "@tanstack/react-query"
import { TERMINAL_XTERM_QUERY_KEYS } from "@/features/terminal-xterm/constants/terminal-xterm.const"

export const invokeTauri = async <T,>(command: string, payload?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, payload)
}

export const isTauriRuntime = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

export const useTerminalXtermModules = () =>
  useQuery({
    queryKey: TERMINAL_XTERM_QUERY_KEYS.modules,
    queryFn: async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ])
      return { Terminal, FitAddon }
    },
    staleTime: Infinity,
    gcTime: Infinity,
  })

export const useTerminalSessionMutations = (tabId: string) => {
  const openTerminalSessionMutation = useMutation({
    mutationKey: TERMINAL_XTERM_QUERY_KEYS.openPty(tabId),
    mutationFn: async (payload: {
      tabId: string
      cwd: string
      program?: string
      args?: string[]
      cols: number
      rows: number
    }) => {
      return invokeTauri("open_pty", payload)
    },
  })

  const writeToTerminalSessionMutation = useMutation({
    mutationKey: TERMINAL_XTERM_QUERY_KEYS.writePty(tabId),
    mutationFn: async (payload: { tabId: string; data: string }) => {
      return invokeTauri("write_pty", payload)
    },
  })

  const resizeTerminalSessionMutation = useMutation({
    mutationKey: TERMINAL_XTERM_QUERY_KEYS.resizePty(tabId),
    mutationFn: async (payload: { tabId: string; cols: number; rows: number }) => {
      return invokeTauri("resize_pty", payload)
    },
  })

  const closeTerminalSessionMutation = useMutation({
    mutationKey: TERMINAL_XTERM_QUERY_KEYS.closePty(tabId),
    mutationFn: async (payload: { tabId: string }) => {
      return invokeTauri("close_pty", payload)
    },
  })

  return {
    openTerminalSessionMutation,
    writeToTerminalSessionMutation,
    resizeTerminalSessionMutation,
    closeTerminalSessionMutation,
  }
}
