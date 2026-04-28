import { useEffect, useMemo, useRef, useState } from "react"
import { LOG_VIEWER_DEFAULT_FILTERS } from "@/features/log-viewer/constants/log-viewer.const"
import { useSshHosts } from "@/features/terminal-xterm/hooks/use-ssh-hosts"
import { decodeBase64ToBytes } from "@/shared/lib/base64"
import type {
  ILogPaneState,
  ILogPaneFilters,
  ILogRecord,
  ILogService,
  IProjectLogSource,
  IProjectSetupState,
  IProjectRunCommand,
} from "@/features/log-viewer/interfaces/log-viewer.interfaces"

interface IAddPaneDraft {
  runtimeTarget: "local" | "ssh"
  projectPath: string
  sshHostId: string
}

const DEFAULT_ADD_PANE_DRAFT: IAddPaneDraft = {
  runtimeTarget: "local",
  projectPath: "",
  sshHostId: "",
}

const MAX_RECORDS_FRONTEND = 2000
const appendLatestRecords = <T,>(current: T[], incoming: T[], maxRecords: number): T[] => {
  if (incoming.length === 0) return current
  if (incoming.length >= maxRecords) {
    return incoming.slice(incoming.length - maxRecords)
  }
  const overflow = current.length + incoming.length - maxRecords
  if (overflow <= 0) {
    return [...current, ...incoming]
  }
  return [...current.slice(overflow), ...incoming]
}

interface ITauriLogEntry {
  id: string
  source_id: string
  timestamp: string
  level: "error" | "warn" | "info" | "debug" | "unknown"
  parser_type?: "json" | "text" | "nginx"
  message: string
  raw: string
}

interface ILogBatchPayload {
  source_id: string
  entries: ITauriLogEntry[]
}

interface ISourceStatusPayload {
  source_id: string
  status: "running" | "paused" | "stopped" | "error"
}

interface IPtyOutputPayload {
  tab_id: string
  data: string
}

interface ICreatedPaneResult {
  paneId: string
  paneTitle: string
  projectPath: string
}

const invokeTauri = async <T,>(command: string, payload?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, payload)
}

const isTauriRuntime = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

const getProjectFolderName = (projectPath: string) => {
  const normalized = projectPath.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  if (!normalized) return ""
  const segments = normalized.split("/").filter(Boolean)
  return segments[segments.length - 1] ?? ""
}

const getDefaultFileLogPath = (
  projectPath: string,
  stack: IProjectSetupState["stack"],
): string => {
  const normalized = projectPath.trim().replace(/\/+$/, "")
  if (!normalized) return "app.log"
  if (stack === "laravel") return `${normalized}/storage/logs/laravel.log`
  return `${normalized}/logs/app.log`
}

const LOG_VIEWER_DEBUG = false

// ── PTY JSON-only extraction ─────────────────────────────────────────────────
// Listens to pty-output from the terminal panel and extracts only valid JSON
// log objects. Any line that is not parseable JSON (ANSI control sequences,
// Docker/PM2 prefix noise, blank lines, startup text) is silently dropped.
const ANSI_ESCAPE_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|][^\x07]*(?:\x07|\x1b\\))/g
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g

const sanitizeTerminalLine = (raw: string) => raw.replace(ANSI_ESCAPE_RE, "").replace(CONTROL_CHAR_RE, "")

const extractJsonOnly = (rawLine: string): { parsed: Record<string, unknown>; cleanedLine: string } | null => {
  const cleanedLine = sanitizeTerminalLine(rawLine).trim()
  const start = cleanedLine.indexOf("{")
  if (start === -1) return null
  const slice = cleanedLine.slice(start)
  try {
    const parsed = JSON.parse(slice)
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { parsed: parsed as Record<string, unknown>, cleanedLine: slice }
    }
  } catch {
    const end = slice.lastIndexOf("}")
    if (end > 0) {
      try {
        const parsed = JSON.parse(slice.slice(0, end + 1))
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          return { parsed: parsed as Record<string, unknown>, cleanedLine: slice.slice(0, end + 1) }
        }
      } catch { /* not valid JSON */ }
    }
  }
  return null
}

const buildJsonRecordFromPty = (
  serviceId: string,
  sourceType: ILogRecord["sourceType"],
  parsed: Record<string, unknown>,
  raw: string,
): ILogRecord => {
  const levelRaw = String(parsed.level ?? parsed.severity ?? parsed.lvl ?? "").toLowerCase()
  const level: ILogRecord["level"] =
    levelRaw === "error" || levelRaw === "fatal" || levelRaw === "critical" ? "error"
    : levelRaw === "warn" || levelRaw === "warning" ? "warn"
    : levelRaw === "debug" || levelRaw === "trace" || levelRaw === "verbose" ? "debug"
    : levelRaw === "info" || levelRaw === "notice" ? "info"
    : "unknown"

  const msgCandidate = parsed.message ?? parsed.msg ?? parsed.log ?? parsed.text
  const message =
    typeof msgCandidate === "string" && msgCandidate.trim()
      ? sanitizeTerminalLine(msgCandidate).trim()
      : raw

  const tsCandidate = parsed.timestamp ?? parsed.time ?? parsed["@timestamp"]
  const timestamp = typeof tsCandidate === "string" && tsCandidate ? tsCandidate : new Date().toISOString()

  return {
    id: `pty-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    serviceId,
    timestamp,
    level,
    parserType: "json",
    sourceType,
    message,
    raw,
  }
}

const NGINX_COMBINED_RE =
  /^(?:[\w][\w.-]*\s*\|\s*)?(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^\s"]+)[^"]*"\s+(\d{3})\s+(\d+|-)\s+"([^"]*)"\s+"([^"]*)"(?:\s+"([^"]*)")?/

const parseNginxDate = (raw: string) => {
  const match = raw.match(
    /(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{4})/,
  )
  if (!match) return new Date().toISOString()
  const [, day, mon, year, hms, offset] = match
  const date = new Date(`${mon} ${day} ${year} ${hms} ${offset}`)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

const buildNginxRecordFromPty = (
  serviceId: string,
  sourceType: ILogRecord["sourceType"],
  rawLine: string,
): ILogRecord | null => {
  const line = sanitizeTerminalLine(rawLine).trim()
  const matched = line.match(NGINX_COMBINED_RE)
  if (!matched) return null

  const [, ip, , timeStr, method, path, status, bytes, referer, ua, realIp] = matched
  const statusNum = Number.parseInt(status, 10)
  const bytesNum = bytes === "-" ? 0 : Number.parseInt(bytes, 10)
  const level: ILogRecord["level"] = statusNum >= 500 ? "error" : statusNum >= 400 ? "warn" : "info"

  const structured = {
    ip: realIp && realIp !== "-" ? realIp : ip,
    method,
    path,
    status: statusNum,
    bytes: Number.isNaN(bytesNum) ? 0 : bytesNum,
    referer,
    ua,
    timestamp: parseNginxDate(timeStr),
    source: "nginx-access",
  }

  return {
    id: `nginx-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    serviceId,
    timestamp: structured.timestamp,
    level,
    parserType: "nginx",
    sourceType,
    message: `${method} ${path} -> ${status} (${structured.bytes}b)`,
    raw: JSON.stringify(structured),
  }
}

export function useLogViewerWorkspace() {
  const sshHostsQuery = useSshHosts()
  const sshHosts = sshHostsQuery.data ?? []
  const [services, setServices] = useState<ILogService[]>([])
  const [panes, setPanes] = useState<ILogPaneState[]>([])
  const [activePaneId, setActivePaneId] = useState("")
  const [showRestorePrompt, setShowRestorePrompt] = useState(false)
  const [runCommands, setRunCommands] = useState<IProjectRunCommand[]>([])
  const [logSources, setLogSources] = useState<IProjectLogSource[]>([])
  const [projectSetup, setProjectSetup] = useState<IProjectSetupState>({
    projectName: "",
    stack: "custom",
    logOutput: "stdout",
    combineFileLogs: false,
  })
  const [isAddPaneOpen, setIsAddPaneOpen] = useState(false)
  const [addPaneDraft, setAddPaneDraft] = useState<IAddPaneDraft>(DEFAULT_ADD_PANE_DRAFT)
  const [paneFilterDrafts, setPaneFilterDrafts] = useState<Record<string, ILogPaneFilters>>({})
  const [paneLiveStates, setPaneLiveStates] = useState<Record<string, boolean>>({})
  const [recordsByServiceId, setRecordsByServiceId] = useState<Record<string, ILogRecord[]>>({})
  const ptyChunkBufferRef = useRef<Record<string, string>>({})
  const panesRef = useRef<ILogPaneState[]>([])
  const paneLiveStatesRef = useRef<Record<string, boolean>>({})

  const servicesById = useMemo(
    () => Object.fromEntries(services.map((service) => [service.id, service])),
    [services],
  )

  const activePane = panes.find((pane) => pane.id === activePaneId) ?? panes[0] ?? null
  const paneByTerminalTabId = useMemo(
    () => Object.fromEntries(panes.map((pane) => [pane.terminalTabId, pane])),
    [panes],
  )
  const servicesByIdRef = useRef(servicesById)
  const paneByTerminalTabIdRef = useRef(paneByTerminalTabId)

  useEffect(() => {
    panesRef.current = panes
  }, [panes])

  useEffect(() => {
    paneLiveStatesRef.current = paneLiveStates
  }, [paneLiveStates])

  useEffect(() => {
    servicesByIdRef.current = servicesById
  }, [servicesById])

  useEffect(() => {
    paneByTerminalTabIdRef.current = paneByTerminalTabId
  }, [paneByTerminalTabId])

  const isServiceLive = (serviceId: string) =>
    panesRef.current.some(
      (pane) => pane.serviceId === serviceId && (paneLiveStatesRef.current[pane.id] ?? false),
    )

  useEffect(() => {
    if (!isTauriRuntime()) return

    let unlistenBatch: (() => void) | undefined
    let unlistenStatus: (() => void) | undefined
    let disposed = false

    const attachListeners = async () => {
      const { listen } = await import("@tauri-apps/api/event")
      const batchUnlisten = await listen<ILogBatchPayload>("log:batch", (event) => {
        const payload = event.payload
        const service = servicesById[payload.source_id]
        if (LOG_VIEWER_DEBUG) {
          console.log("[log-viewer] incoming batch", {
            sourceId: payload.source_id,
            entries: payload.entries.length,
            hasService: Boolean(service),
            isLive: isServiceLive(payload.source_id),
            firstEntry: payload.entries[0],
          })
        }
        if (!service) return
        if (!isServiceLive(payload.source_id)) return

        setRecordsByServiceId((prev) => {
          const current = prev[payload.source_id] ?? []
          const appended = payload.entries.map((entry) => ({
            id: entry.id,
            serviceId: payload.source_id,
            timestamp: entry.timestamp,
            level: entry.level,
            parserType: entry.parser_type ?? service.parserType,
            sourceType: service.sourceType,
            message: entry.message,
            raw: entry.raw,
          }))
          const nextRecords = appendLatestRecords(current, appended, MAX_RECORDS_FRONTEND)
          if (LOG_VIEWER_DEBUG) {
            console.log("[log-viewer] records appended", {
              sourceId: payload.source_id,
              currentCount: current.length,
              appendedCount: appended.length,
              nextCount: nextRecords.length,
            })
          }
          return {
            ...prev,
            [payload.source_id]: nextRecords,
          }
        })
      })

      const statusUnlisten = await listen<ISourceStatusPayload>("source-status", (event) => {
        const payload = event.payload
        if (LOG_VIEWER_DEBUG) {
          console.log("[log-viewer] source status", payload)
        }
        setPanes((prev) =>
          prev.map((pane) =>
            pane.serviceId === payload.source_id ? { ...pane, status: payload.status } : pane,
          ),
        )
        setRunCommands((prev) =>
          prev.map((item) => {
            if (item.id !== payload.source_id) return item
            if (payload.status === "running") return { ...item, status: "running" }
            if (payload.status === "paused") return { ...item, status: "paused" }
            if (payload.status === "error") return { ...item, status: "error" }
            return { ...item, status: "idle" }
          }),
        )
      })

      if (disposed) {
        batchUnlisten()
        statusUnlisten()
        return
      }

      unlistenBatch = batchUnlisten
      unlistenStatus = statusUnlisten
    }

    void attachListeners()

    return () => {
      disposed = true
      unlistenBatch?.()
      unlistenStatus?.()
    }
  }, [])

  const previousActivePaneIdRef = useRef<string>("")
  useEffect(() => {
    if (!activePaneId) return
    setPaneLiveStates((prev) => {
      const next = { ...prev }
      const previousPaneId = previousActivePaneIdRef.current
      if (previousPaneId && previousPaneId !== activePaneId) {
        next[previousPaneId] = false
      }
      if (next[activePaneId] === undefined) {
        next[activePaneId] = true
      }
      return next
    })
    previousActivePaneIdRef.current = activePaneId
  }, [activePaneId])

  // ── PTY structured ingest (JSON + Nginx) ───────────────────────────────────
  // Feeds PTY terminal output into the log viewer.
  // Only structured logs (JSON or Nginx combined) are accepted.
  useEffect(() => {
    if (!isTauriRuntime()) return

    let unlistenPtyOutput: (() => void) | undefined
    let disposed = false

    const attachListener = async () => {
      const { listen } = await import("@tauri-apps/api/event")
      const unlisten = await listen<IPtyOutputPayload>("pty-output", (event) => {
        const payload = event.payload
        const pane = paneByTerminalTabIdRef.current[payload.tab_id]
        if (!pane) return
        if (!(paneLiveStatesRef.current[pane.id] ?? false)) return

        const service = servicesByIdRef.current[pane.serviceId]
        if (!service) return

        const decodedChunk = new TextDecoder().decode(decodeBase64ToBytes(payload.data))
        const buffered = `${ptyChunkBufferRef.current[payload.tab_id] ?? ""}${decodedChunk}`
        const lines = buffered.split(/\r?\n/)
        const rest = lines.pop() ?? ""
        ptyChunkBufferRef.current[payload.tab_id] = rest

        const records: ILogRecord[] = []
        for (const line of lines) {
          const extracted = extractJsonOnly(line)
          if (extracted) {
            records.push(
              buildJsonRecordFromPty(
                service.id,
                service.sourceType,
                extracted.parsed,
                extracted.cleanedLine,
              ),
            )
            continue
          }

          const nginxRecord = buildNginxRecordFromPty(service.id, service.sourceType, line)
          if (nginxRecord) {
            records.push(nginxRecord)
          }
        }

        if (records.length === 0) return

        if (LOG_VIEWER_DEBUG) {
          console.log("[log-viewer] pty structured records", {
            tabId: payload.tab_id,
            count: records.length,
            sample: records[0],
          })
        }

        setRecordsByServiceId((prev) => {
          const current = prev[service.id] ?? []
          const next = appendLatestRecords(current, records, MAX_RECORDS_FRONTEND)
          return { ...prev, [service.id]: next }
        })
      })

      if (disposed) { unlisten(); return }
      unlistenPtyOutput = unlisten
    }

    void attachListener()
    return () => { disposed = true; unlistenPtyOutput?.() }
  }, [])

  const updatePaneFilters = (paneId: string, filters: ILogPaneFilters) => {
    setPanes((prev) => prev.map((pane) => (pane.id === paneId ? { ...pane, filters } : pane)))
  }

  const updatePaneFilterDraft = (paneId: string, filters: ILogPaneFilters) => {
    setPaneFilterDrafts((prev) => ({ ...prev, [paneId]: filters }))
  }

  const applyPaneFilterDraft = (paneId: string) => {
    const nextFilters = paneFilterDrafts[paneId]
    if (!nextFilters) return
    updatePaneFilters(paneId, nextFilters)
  }

  const resetPaneFilters = (paneId: string) => {
    const resetFilters = { ...LOG_VIEWER_DEFAULT_FILTERS }
    updatePaneFilters(paneId, resetFilters)
    updatePaneFilterDraft(paneId, resetFilters)
  }

  const setPaneLiveMode = (paneId: string, isLive: boolean) => {
    setPaneLiveStates((prev) => ({ ...prev, [paneId]: isLive }))
    const pane = panes.find((item) => item.id === paneId)
    if (!pane || !isTauriRuntime()) return
    const runCommand = runCommands.find((item) => item.id === pane.serviceId)
    if (!runCommand) return
    if (runCommand.sourceType === "file") return

    void invokeTauri(isLive ? "resume_process" : "pause_process", {
      sourceId: pane.serviceId,
    })
      .then(() => {
        setPanes((prev) =>
          prev.map((item) =>
            item.id === paneId ? { ...item, status: isLive ? "running" : "paused" } : item,
          ),
        )
      })
      .catch(() => {})
  }

  const setPaneService = (paneId: string, serviceId: string) => {
    setPanes((prev) => prev.map((pane) => (pane.id === paneId ? { ...pane, serviceId } : pane)))
  }

  const closePaneConnection = (paneId: string) => {
    const paneToClose = panes.find((pane) => pane.id === paneId)
    if (!paneToClose) return

    const serviceToClose = services.find((service) => service.id === paneToClose.serviceId)

    setPanes((prev) => {
      const closingIndex = prev.findIndex((pane) => pane.id === paneId)
      if (closingIndex < 0) return prev

      const nextPanes = prev.filter((pane) => pane.id !== paneId)

      setActivePaneId((currentActivePaneId) => {
        if (currentActivePaneId !== paneId) return currentActivePaneId
        const nextActivePane = nextPanes[closingIndex] ?? nextPanes[closingIndex - 1] ?? nextPanes[0]
        return nextActivePane?.id ?? ""
      })

      return nextPanes
    })

    setPaneFilterDrafts((prev) => {
      const next = { ...prev }
      delete next[paneId]
      return next
    })
    setPaneLiveStates((prev) => {
      const next = { ...prev }
      delete next[paneId]
      return next
    })
    if (isTauriRuntime()) {
      const runCommand = runCommands.find((item) => item.id === paneToClose.serviceId)
      if (runCommand) {
        void invokeTauri(
          runCommand.sourceType === "file" ? "stop_file_log_stream" : "stop_process",
          { sourceId: paneToClose.serviceId },
        )
      }
    }

    if (serviceToClose) {
      setServices((prev) => prev.filter((service) => service.id !== serviceToClose.id))
      setRunCommands((prev) => prev.filter((command) => command.id !== serviceToClose.id))
      setLogSources((prev) => prev.filter((item) => item.name !== serviceToClose.title))
      setRecordsByServiceId((prev) => {
        const next = { ...prev }
        delete next[serviceToClose.id]
        return next
      })
    }
  }

  const runAllCommands = () => {
    if (!isTauriRuntime()) {
      setRunCommands((prev) => prev.map((item) => ({ ...item, status: "running" })))
      return
    }

    void Promise.all(
      runCommands.map(async (item) => {
        try {
          if (item.sourceType === "file") {
            if (!item.filePath) throw new Error("missing file path")
            await invokeTauri("start_file_log_stream", {
              sourceId: item.id,
              filePath: item.filePath,
            })
          } else {
            await invokeTauri("spawn_process", {
              sourceId: item.id,
              command: item.command,
              cwd: item.cwd,
              jsonOnly: true,
            })
          }
        } catch {
          setRunCommands((prev) =>
            prev.map((current) => (current.id === item.id ? { ...current, status: "error" } : current)),
          )
        }
      }),
    )
  }

  const stopAllCommands = () => {
    if (!isTauriRuntime()) {
      setRunCommands((prev) => prev.map((item) => ({ ...item, status: "idle" })))
      return
    }

    void Promise.all(
      runCommands.map((item) =>
        item.sourceType === "file"
          ? invokeTauri("stop_file_log_stream", { sourceId: item.id })
          : invokeTauri("stop_process", { sourceId: item.id }),
      ),
    )
      .then(() => {
        setRunCommands((prev) => prev.map((item) => ({ ...item, status: "idle" })))
        setPanes((prev) => prev.map((pane) => ({ ...pane, status: "stopped" })))
      })
      .catch(() => {
        setRunCommands((prev) => prev.map((item) => ({ ...item, status: "error" })))
      })
  }

  const toggleCommandStatus = (commandId: string) => {
    const command = runCommands.find((item) => item.id === commandId)
    if (!command) return

    if (!isTauriRuntime()) {
      setRunCommands((prev) =>
        prev.map((item) =>
          item.id === commandId
            ? {
                ...item,
                status: item.status === "running" || item.status === "paused" ? "idle" : "running",
              }
            : item,
        ),
      )
      return
    }

    if (command.status === "running" || command.status === "paused") {
      const stopCommand =
        command.sourceType === "file"
          ? invokeTauri("stop_file_log_stream", { sourceId: command.id })
          : invokeTauri("stop_process", { sourceId: command.id })
      void stopCommand.then(() => {
        setRunCommands((prev) =>
          prev.map((item) => (item.id === command.id ? { ...item, status: "idle" } : item)),
        )
      })
      return
    }

    const startCommand =
      command.sourceType === "file"
        ? command.filePath
          ? invokeTauri("start_file_log_stream", { sourceId: command.id, filePath: command.filePath })
          : Promise.reject(new Error("missing file path"))
        : invokeTauri("spawn_process", {
            sourceId: command.id,
            command: command.command,
            cwd: command.cwd,
            jsonOnly: true,
          })
    void startCommand.then(() => {
      setRunCommands((prev) =>
        prev.map((item) => (item.id === command.id ? { ...item, status: "running" } : item)),
      )
    })
  }

  const updateProjectSetup = (value: Partial<IProjectSetupState>) => {
    setProjectSetup((prev) => ({ ...prev, ...value }))
  }

  const updateLogSourceMergeMode = (sourceId: string, mergeKey: IProjectLogSource["mergeKey"]) => {
    setLogSources((prev) =>
      prev.map((item) => (item.id === sourceId ? { ...item, mergeKey } : item)),
    )
  }

  const addPaneFromDraft = (): ICreatedPaneResult => {
    const nextPaneIndex = panes.length + 1
    const nextPaneId = `pane-${nextPaneIndex}`
    const nextServiceId = `service-${Date.now()}`
    const selectedSshHost = sshHosts.find((host) => host.id === addPaneDraft.sshHostId)
    const folderName = getProjectFolderName(addPaneDraft.projectPath)
    const normalizedTitle =
      addPaneDraft.runtimeTarget === "ssh"
        ? selectedSshHost?.name || `SSH Host ${nextPaneIndex}`
        : folderName || projectSetup.projectName.trim() || `Project ${nextPaneIndex}`
    const accentTones = ["blue", "green", "amber", "purple"] as const
    const isFileMode = projectSetup.logOutput === "file"
    const filePath =
      addPaneDraft.runtimeTarget === "local"
        ? getDefaultFileLogPath(addPaneDraft.projectPath, projectSetup.stack)
        : ""

    const nextService = {
      id: nextServiceId,
      title: normalizedTitle,
      runtimeTarget: addPaneDraft.runtimeTarget,
      sshHostId: addPaneDraft.runtimeTarget === "ssh" ? addPaneDraft.sshHostId || undefined : undefined,
      sourceType: isFileMode ? "file" : "stdout",
      parserType: isFileMode ? "text" : "json",
      filePath: isFileMode ? filePath : undefined,
      sourceLabel:
        isFileMode
          ? filePath
          : addPaneDraft.runtimeTarget === "ssh"
          ? selectedSshHost
            ? `${selectedSshHost.username}@${selectedSshHost.host}:${selectedSshHost.port}`
            : "ssh host"
          : addPaneDraft.projectPath || "local project",
    } as const

    const nextPane = {
      id: nextPaneId,
      terminalTabId: `log-pane-terminal-${nextPaneId}`,
      title: normalizedTitle,
      serviceId: nextServiceId,
      status: "stopped",
      accentTone: accentTones[(nextPaneIndex - 1) % accentTones.length],
      filters: { ...LOG_VIEWER_DEFAULT_FILTERS },
    } as const

    setPanes((prev) => [...prev, nextPane])
    setPaneFilterDrafts((prev) => ({
      ...prev,
      [nextPaneId]: { ...LOG_VIEWER_DEFAULT_FILTERS },
    }))
    setPaneLiveStates((prev) => ({ ...prev, [nextPaneId]: false }))
    setLogSources((prev) => [
      ...prev,
      {
        id: `src-${Date.now()}`,
        name: normalizedTitle,
        sourceType: isFileMode ? "file" : "stdout",
        parserType: isFileMode ? "text" : "json",
        filePath: isFileMode ? filePath : undefined,
        mergeKey: "separate",
      },
    ])
    setServices((prev) => [...prev, nextService])
    setRunCommands((prev) => [
      ...prev,
      {
        id: nextServiceId,
        name: normalizedTitle,
        command: isFileMode ? `tail -f ${filePath}` : "npm run dev",
        cwd: addPaneDraft.projectPath || ".",
        sourceType: isFileMode ? "file" : "stdout",
        filePath: isFileMode ? filePath : undefined,
        status: "idle",
      },
    ])

    setActivePaneId(nextPaneId)
    setIsAddPaneOpen(false)
    setAddPaneDraft(DEFAULT_ADD_PANE_DRAFT)

    return {
      paneId: nextPaneId,
      paneTitle: normalizedTitle,
      projectPath:
        addPaneDraft.runtimeTarget === "ssh"
          ? "~"
          : addPaneDraft.projectPath.trim() || ".",
    }

  }

  const getVisibleRecordsByPane = (paneId: string) => {
    const pane = panes.find((item) => item.id === paneId)
    if (!pane) return []

    const paneRecords = recordsByServiceId[pane.serviceId] ?? []
    const visibleRecords = paneRecords.filter((record) => {
      if (record.serviceId !== pane.serviceId) return false
      if (pane.filters.level !== "all" && record.level !== pane.filters.level) return false
      if (pane.filters.sourceType !== "all" && record.sourceType !== pane.filters.sourceType) return false
      if (pane.filters.parserType !== "all" && record.parserType !== pane.filters.parserType) return false
      if (pane.filters.keyword.trim().length > 0) {
        const keyword = pane.filters.keyword.toLowerCase()
        return (
          record.message.toLowerCase().includes(keyword) ||
          record.raw.toLowerCase().includes(keyword)
        )
      }
      return true
    })
    if (LOG_VIEWER_DEBUG) {
      console.log("[log-viewer] filter result", {
        paneId,
        serviceId: pane.serviceId,
        totalRecords: paneRecords.length,
        visibleRecords: visibleRecords.length,
        filters: pane.filters,
        sampleRecord: paneRecords[0],
      })
    }
    return visibleRecords
  }

  const clearPaneLogs = (paneId: string) => {
    const pane = panes.find((item) => item.id === paneId)
    if (!pane) return
    setRecordsByServiceId((prev) => ({
      ...prev,
      [pane.serviceId]: [],
    }))
    delete ptyChunkBufferRef.current[pane.terminalTabId]
  }

  return {
    panes,
    activePaneId,
    activePane,
    services,
    servicesById,
    runCommands,
    logSources,
    projectSetup,
    showRestorePrompt,
    isAddPaneOpen,
    addPaneDraft,
    sshHosts,
    paneFilterDrafts,
    paneLiveStates,
    recordsByServiceId,
    setShowRestorePrompt,
    setIsAddPaneOpen,
    setAddPaneDraft,
    setActivePaneId,
    setPaneService,
    closePaneConnection,
    updatePaneFilters,
    updatePaneFilterDraft,
    applyPaneFilterDraft,
    resetPaneFilters,
    setPaneLiveMode,
    runAllCommands,
    stopAllCommands,
    toggleCommandStatus,
    updateProjectSetup,
    updateLogSourceMergeMode,
    addPaneFromDraft,
    clearPaneLogs,
    getVisibleRecordsByPane,
  }
}
