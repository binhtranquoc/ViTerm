export const TERMINAL_XTERM_QUERY_KEYS = {
  modules: ["terminal-xterm", "modules"] as const,
  openPty: (tabId: string) => ["terminal-xterm", "open-pty", tabId] as const,
  writePty: (tabId: string) => ["terminal-xterm", "write-pty", tabId] as const,
  resizePty: (tabId: string) => ["terminal-xterm", "resize-pty", tabId] as const,
  closePty: (tabId: string) => ["terminal-xterm", "close-pty", tabId] as const,
}

export const TERMINAL_REFIT_DELAY_MS = 10
