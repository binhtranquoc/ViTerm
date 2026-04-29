import { useEffect, useMemo, useRef, useState } from "react"
import { LOG_VIEWER_DEFAULT_FILTERS } from "@/features/log-viewer/constants/log-viewer.const"
import { filterRecordsBySourceType } from "@/features/log-viewer/utils/log-filter.utils"
import { useSshHosts } from "@/features/terminal-xterm/hooks/use-ssh-hosts"
import { decodeBase64ToBytes } from "@/shared/lib/base64"
import type {
  IAddPaneDraft,
  ICreatedPaneResult,
  ILogBatchPayload,
  ILogPaneState,
  ILogPaneFilters,
  ILogRecord,
  ILogService,
  ILogViewerWorkspaceCache,
  IPtyOutputPayload,
  IProjectLogSource,
  IProjectSetupState,
  IProjectRunCommand,
  ISourceStatusPayload,
  ISshRemoteEntry,
} from "@/features/log-viewer/interfaces/log-viewer.interfaces"

const DEFAULT_ADD_PANE_DRAFT: IAddPaneDraft = {
  runtimeTarget: "local",
  projectPath: "",
  sshHostId: "",
}

const logViewerWorkspaceCache: ILogViewerWorkspaceCache = {
  services: [],
  panes: [],
  activePaneId: "",
  runCommands: [],
  logSources: [],
  projectSetup: {
    projectName: "",
    stack: "custom",
    logOutput: "stdout",
    combineFileLogs: false,
    fileLogPaths: [],
  },
  addPaneDraft: DEFAULT_ADD_PANE_DRAFT,
  paneFilterDrafts: {},
  paneLiveStates: {},
  recordsByServiceId: {},
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

const invokeTauri = async <T,>(command: string, payload?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, payload)
}

const isTauriRuntime = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

const getProjectFolderName = (projectPath: string) => {
  const normalizedProjectPath = projectPath.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  if (!normalizedProjectPath) return ""
  const segments = normalizedProjectPath.split("/").filter(Boolean)
  return segments[segments.length - 1] ?? ""
}


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
      } catch {}
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
    fields: extractFlattenedFields(parsed),
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
    fields: extractFlattenedFields(structured),
  }
}

const extractFlattenedFields = (value: unknown): Record<string, string> => {
  const fields: Record<string, string> = {}
  const walk = (current: unknown, prefix: string) => {
    if (current === null || current === undefined) return
    if (Array.isArray(current)) {
      if (prefix.length > 0 && current.length > 0) {
        fields[prefix] = JSON.stringify(current)
      }
      return
    }
    if (typeof current === "object") {
      for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
        walk(child, prefix ? `${prefix}.${key}` : key)
      }
      return
    }
    if (prefix.length > 0) {
      fields[prefix] = String(current)
    }
  }
  walk(value, "")
  return fields
}

export function useLogViewerWorkspace() {
  const sshHostsQuery = useSshHosts()
  const sshHosts = sshHostsQuery.data ?? []
  const [services, setServices] = useState<ILogService[]>(() => logViewerWorkspaceCache.services)
  const [panes, setPanes] = useState<ILogPaneState[]>(() => logViewerWorkspaceCache.panes)
  const [activePaneId, setActivePaneId] = useState(() => logViewerWorkspaceCache.activePaneId)
  const [showRestorePrompt, setShowRestorePrompt] = useState(false)
  const [runCommands, setRunCommands] = useState<IProjectRunCommand[]>(() => logViewerWorkspaceCache.runCommands)
  const [logSources, setLogSources] = useState<IProjectLogSource[]>(() => logViewerWorkspaceCache.logSources)
  const [projectSetup, setProjectSetup] = useState<IProjectSetupState>(() => logViewerWorkspaceCache.projectSetup)
  const [isAddPaneOpen, setIsAddPaneOpen] = useState(false)
  const [addPaneDraft, setAddPaneDraft] = useState<IAddPaneDraft>(() => logViewerWorkspaceCache.addPaneDraft)
  const [paneFilterDrafts, setPaneFilterDrafts] = useState<Record<string, ILogPaneFilters>>(
    () => logViewerWorkspaceCache.paneFilterDrafts,
  )
  const [paneLiveStates, setPaneLiveStates] = useState<Record<string, boolean>>(
    () => logViewerWorkspaceCache.paneLiveStates,
  )
  const [recordsByServiceId, setRecordsByServiceId] = useState<Record<string, ILogRecord[]>>(
    () => logViewerWorkspaceCache.recordsByServiceId,
  )
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
    logViewerWorkspaceCache.services = services
  }, [services])

  useEffect(() => {
    logViewerWorkspaceCache.panes = panes
  }, [panes])

  useEffect(() => {
    logViewerWorkspaceCache.activePaneId = activePaneId
  }, [activePaneId])

  useEffect(() => {
    logViewerWorkspaceCache.runCommands = runCommands
  }, [runCommands])

  useEffect(() => {
    logViewerWorkspaceCache.logSources = logSources
  }, [logSources])

  useEffect(() => {
    logViewerWorkspaceCache.projectSetup = projectSetup
  }, [projectSetup])

  useEffect(() => {
    logViewerWorkspaceCache.addPaneDraft = addPaneDraft
  }, [addPaneDraft])

  useEffect(() => {
    logViewerWorkspaceCache.paneFilterDrafts = paneFilterDrafts
  }, [paneFilterDrafts])

  useEffect(() => {
    logViewerWorkspaceCache.paneLiveStates = paneLiveStates
  }, [paneLiveStates])

  useEffect(() => {
    logViewerWorkspaceCache.recordsByServiceId = recordsByServiceId
  }, [recordsByServiceId])

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
        const service = servicesByIdRef.current[payload.source_id]
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
            fields: entry.fields ?? {},
          }))
          const nextRecords = appendLatestRecords(current, appended, MAX_RECORDS_FRONTEND)
          return {
            ...prev,
            [payload.source_id]: nextRecords,
          }
        })
      })

      const statusUnlisten = await listen<ISourceStatusPayload>("source-status", (event) => {
        const payload = event.payload
        setPanes((prev) =>
          prev.map((pane) =>
            pane.serviceId === payload.source_id ? { ...pane, status: payload.status } : pane,
          ),
        )
        setRunCommands((prev) =>
          prev.map((runCommandEntry) => {
            if (runCommandEntry.id !== payload.source_id) return runCommandEntry
            if (payload.status === "running") return { ...runCommandEntry, status: "running" }
            if (payload.status === "paused") return { ...runCommandEntry, status: "paused" }
            if (payload.status === "error") return { ...runCommandEntry, status: "error" }
            return { ...runCommandEntry, status: "idle" }
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
    const selectedPane = panes.find((paneEntry) => paneEntry.id === paneId)
    if (!selectedPane || !isTauriRuntime()) return
    const runCommand = runCommands.find((runCommandEntry) => runCommandEntry.id === selectedPane.serviceId)
    if (!runCommand) return
    if (runCommand.sourceType === "file") return

    void invokeTauri(isLive ? "resume_process" : "pause_process", {
      sourceId: selectedPane.serviceId,
    })
      .then(() => {
        setPanes((prev) =>
          prev.map((paneEntry) =>
            paneEntry.id === paneId
              ? { ...paneEntry, status: isLive ? "running" : "paused" }
              : paneEntry,
          ),
        )
      })
      .catch(() => {})
  }

  const setPaneService = (paneId: string, serviceId: string) => {
    setPanes((prev) => prev.map((pane) => (pane.id === paneId ? { ...pane, serviceId } : pane)))
  }

  const getEffectiveFilePaths = (command: IProjectRunCommand) => {
    const filePathList = command.filePaths?.map((filePath) => filePath.trim()).filter(Boolean) ?? []
    if (filePathList.length > 0) return filePathList
    const single = command.filePath?.trim()
    return single ? [single] : []
  }

  const startFileCommand = async (command: IProjectRunCommand, service?: ILogService) => {
    const filePaths = getEffectiveFilePaths(command)
    if (filePaths.length === 0) throw new Error("missing file path")
    if (service?.runtimeTarget === "ssh" && service.sshHostId) {
      await invokeTauri("start_ssh_file_log_streams", {
        sourceId: command.id,
        hostId: service.sshHostId,
        filePaths,
      })
      return
    }
    if (filePaths.length === 1) {
      await invokeTauri("start_file_log_stream", {
        sourceId: command.id,
        filePath: filePaths[0],
      })
      return
    }
    await invokeTauri("start_file_log_streams", {
      sourceId: command.id,
      filePaths,
    })
  }

  const stopFileCommand = async (command: IProjectRunCommand, service?: ILogService) => {
    if (service?.runtimeTarget === "ssh") {
      await invokeTauri("stop_ssh_file_log_streams", { sourceId: command.id })
      return
    }
    const filePaths = getEffectiveFilePaths(command)
    if (filePaths.length > 1) {
      await invokeTauri("stop_file_log_streams", { sourceId: command.id })
      return
    }
    await invokeTauri("stop_file_log_stream", { sourceId: command.id })
  }

  const updatePaneLogFiles = async (paneId: string, nextPaths: string[]) => {
    const targetPane = panesRef.current.find((paneEntry) => paneEntry.id === paneId)
    if (!targetPane) throw new Error("Pane not found")
    const service = servicesByIdRef.current[targetPane.serviceId]
    if (!service) throw new Error("Service not found")

    const normalizedPaths = Array.from(new Set(nextPaths.map((nextPath) => nextPath.trim()).filter(Boolean)))
    if (normalizedPaths.length === 0) throw new Error("Please select at least one log file")

    const effectivePaths = normalizedPaths
    const nextSourceLabel =
      effectivePaths.length > 1 ? `${effectivePaths.length} log files` : effectivePaths[0]
    const nextParserType =
      projectSetup.stack === "laravel" ? "laravel" : "text"

    setServices((prev) =>
      prev.map((serviceEntry) =>
        serviceEntry.id === service.id
          ? {
              ...serviceEntry,
              sourceType: "file",
              parserType: nextParserType,
              filePath: effectivePaths[0],
              filePaths: effectivePaths,
              sourceLabel: nextSourceLabel,
            }
          : serviceEntry,
      ),
    )
    setRunCommands((prev) =>
      prev.map((runCommandEntry) =>
        runCommandEntry.id === service.id
          ? {
              ...runCommandEntry,
              sourceType: "file",
              filePath: effectivePaths[0],
              filePaths: effectivePaths,
              command: `tail -f ${effectivePaths.join(" ")}`,
            }
          : runCommandEntry,
      ),
    )
    setLogSources((prev) =>
      prev.map((logSourceEntry) =>
        logSourceEntry.name === service.title
          ? {
              ...logSourceEntry,
              sourceType: "file",
              parserType: nextParserType,
              filePath: effectivePaths[0],
            }
          : logSourceEntry,
      ),
    )

    const currentCommand = runCommands.find((runCommandEntry) => runCommandEntry.id === service.id)
    if (!currentCommand || !isTauriRuntime()) return

    const updatedCommand: IProjectRunCommand = {
      ...currentCommand,
      sourceType: "file",
      filePath: effectivePaths[0],
      filePaths: effectivePaths,
      command: `tail -f ${effectivePaths.join(" ")}`,
    }
    try {
      if (currentCommand.status === "running" || currentCommand.status === "paused") {
        // For ssh + file-log, keep the existing SSH connection/PTY and only update file list.
        if (service.runtimeTarget === "ssh" && currentCommand.sourceType === "file") {
          await invokeTauri("update_ssh_file_log_paths", {
            sourceId: currentCommand.id,
            filePaths: effectivePaths,
          })

          setRunCommands((prev) =>
            prev.map((runCommandEntry) =>
              runCommandEntry.id === updatedCommand.id
                ? { ...runCommandEntry, status: "running" }
                : runCommandEntry,
            ),
          )
          setPanes((prev) =>
            prev.map((paneEntry) =>
              paneEntry.id === paneId ? { ...paneEntry, status: "running" } : paneEntry,
            ),
          )
          return
        }

        if (currentCommand.sourceType === "file") {
          await stopFileCommand(currentCommand, service)
        } else {
          await invokeTauri("stop_process", { sourceId: currentCommand.id })
        }
      }

      await startFileCommand(updatedCommand, service)
      setRunCommands((prev) =>
        prev.map((runCommandEntry) =>
          runCommandEntry.id === updatedCommand.id
            ? { ...runCommandEntry, status: "running" }
            : runCommandEntry,
        ),
      )
      setPanes((prev) =>
        prev.map((paneEntry) => (paneEntry.id === paneId ? { ...paneEntry, status: "running" } : paneEntry)),
      )
    } catch {
      setRunCommands((prev) =>
        prev.map((runCommandEntry) =>
          runCommandEntry.id === updatedCommand.id
            ? { ...runCommandEntry, status: "error" }
            : runCommandEntry,
        ),
      )
      setPanes((prev) =>
        prev.map((paneEntry) => (paneEntry.id === paneId ? { ...paneEntry, status: "error" } : paneEntry)),
      )
      throw new Error("Failed to reload file watchers")
    }
  }

  const listSshRemoteEntries = async (hostId: string, path: string) => {
    return invokeTauri<{ base_path: string; entries: ISshRemoteEntry[] }>("list_ssh_remote_entries", {
      hostId,
      path,
    })
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
      void invokeTauri("stop_ssh_host_terminal", { tabId: paneToClose.terminalTabId }).catch(() => {})
      void invokeTauri("force_close_pty_tab", { tabId: paneToClose.terminalTabId }).catch(() => {})
    }
    if (isTauriRuntime()) {
      const runCommand = runCommands.find((runCommandEntry) => runCommandEntry.id === paneToClose.serviceId)
      if (runCommand) {
        if (runCommand.sourceType === "file") {
          void stopFileCommand(runCommand, serviceToClose)
        } else {
          void invokeTauri("stop_process", { sourceId: paneToClose.serviceId })
        }
      }
    }

    if (serviceToClose) {
      setServices((prev) => prev.filter((service) => service.id !== serviceToClose.id))
      setRunCommands((prev) => prev.filter((command) => command.id !== serviceToClose.id))
      setLogSources((prev) =>
        prev.filter((logSourceEntry) => logSourceEntry.name !== serviceToClose.title),
      )
      setRecordsByServiceId((prev) => {
        const next = { ...prev }
        delete next[serviceToClose.id]
        return next
      })
    }
  }

  const runAllCommands = () => {
    if (!isTauriRuntime()) {
      setRunCommands((prev) => prev.map((runCommandEntry) => ({ ...runCommandEntry, status: "running" })))
      return
    }

    void Promise.all(
      runCommands.map(async (runCommandEntry) => {
        try {
          if (runCommandEntry.sourceType === "file") {
            await startFileCommand(runCommandEntry, servicesByIdRef.current[runCommandEntry.id])
          } else {
            await invokeTauri("spawn_process", {
              sourceId: runCommandEntry.id,
              command: runCommandEntry.command,
              cwd: runCommandEntry.cwd,
              jsonOnly: true,
            })
          }
        } catch {
          setRunCommands((prev) =>
            prev.map((currentRunCommand) =>
              currentRunCommand.id === runCommandEntry.id
                ? { ...currentRunCommand, status: "error" }
                : currentRunCommand,
            ),
          )
        }
      }),
    )
  }

  const stopAllCommands = () => {
    if (!isTauriRuntime()) {
      setRunCommands((prev) => prev.map((runCommandEntry) => ({ ...runCommandEntry, status: "idle" })))
      return
    }

    void Promise.all(
      runCommands.map((runCommandEntry) =>
        runCommandEntry.sourceType === "file"
          ? stopFileCommand(runCommandEntry, servicesByIdRef.current[runCommandEntry.id])
          : invokeTauri("stop_process", { sourceId: runCommandEntry.id }),
      ),
    )
      .then(() => {
        setRunCommands((prev) => prev.map((runCommandEntry) => ({ ...runCommandEntry, status: "idle" })))
        setPanes((prev) => prev.map((pane) => ({ ...pane, status: "stopped" })))
      })
      .catch(() => {
        setRunCommands((prev) => prev.map((runCommandEntry) => ({ ...runCommandEntry, status: "error" })))
      })
  }

  const toggleCommandStatus = (commandId: string) => {
    const command = runCommands.find((runCommandEntry) => runCommandEntry.id === commandId)
    if (!command) return

    if (!isTauriRuntime()) {
      setRunCommands((prev) =>
        prev.map((runCommandEntry) =>
          runCommandEntry.id === commandId
            ? {
                ...runCommandEntry,
                status:
                  runCommandEntry.status === "running" || runCommandEntry.status === "paused"
                    ? "idle"
                    : "running",
              }
            : runCommandEntry,
        ),
      )
      return
    }

    if (command.status === "running" || command.status === "paused") {
      const stopCommand =
        command.sourceType === "file"
          ? stopFileCommand(command, servicesByIdRef.current[command.id])
          : invokeTauri("stop_process", { sourceId: command.id })
      void stopCommand.then(() => {
        setRunCommands((prev) =>
          prev.map((runCommandEntry) =>
            runCommandEntry.id === command.id ? { ...runCommandEntry, status: "idle" } : runCommandEntry,
          ),
        )
      })
      return
    }

    const startCommand =
      command.sourceType === "file"
        ? startFileCommand(command, servicesByIdRef.current[command.id])
        : invokeTauri("spawn_process", {
            sourceId: command.id,
            command: command.command,
            cwd: command.cwd,
            jsonOnly: true,
          })
    void startCommand.then(() => {
      setRunCommands((prev) =>
        prev.map((runCommandEntry) =>
          runCommandEntry.id === command.id ? { ...runCommandEntry, status: "running" } : runCommandEntry,
        ),
      )
    })
  }

  const updateProjectSetup = (value: Partial<IProjectSetupState>) => {
    setProjectSetup((prev) => ({ ...prev, ...value }))
  }

  const updateLogSourceMergeMode = (sourceId: string, mergeKey: IProjectLogSource["mergeKey"]) => {
    setLogSources((prev) =>
      prev.map((logSourceEntry) =>
        logSourceEntry.id === sourceId ? { ...logSourceEntry, mergeKey } : logSourceEntry,
      ),
    )
  }

  const addPaneFromDraft = (): ICreatedPaneResult => {
    const nextServiceId = `service-${Date.now()}`
    const nextPaneId = `pane-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const nextPaneIndex = panes.length + 1
    const selectedSshHost = sshHosts.find((host) => host.id === addPaneDraft.sshHostId)
    if (addPaneDraft.runtimeTarget === "ssh" && !selectedSshHost) {
      throw new Error("Please select an SSH host")
    }
    const folderName = getProjectFolderName(addPaneDraft.projectPath)
    const normalizedTitle =
      addPaneDraft.runtimeTarget === "ssh"
        ? selectedSshHost?.name || `SSH Host ${nextPaneIndex}`
        : folderName || projectSetup.projectName.trim() || `Project ${nextPaneIndex}`
    const accentTones = ["blue", "green", "amber", "purple"] as const
    const isFileMode = projectSetup.logOutput === "file"
    const configuredFilePaths = projectSetup.fileLogPaths
      .map((filePath) => filePath.trim())
      .filter((filePath) => filePath.length > 0)
    const effectiveFilePaths = isFileMode
      ? projectSetup.combineFileLogs
        ? configuredFilePaths
        : configuredFilePaths.slice(0, 1)
      : []
    const parserType =
      isFileMode && projectSetup.stack === "laravel"
        ? "laravel"
        : isFileMode
          ? "text"
          : "json"

    const nextService = {
      id: nextServiceId,
      title: normalizedTitle,
      runtimeTarget: addPaneDraft.runtimeTarget,
      sshHostId: addPaneDraft.runtimeTarget === "ssh" ? addPaneDraft.sshHostId || undefined : undefined,
      sourceType: isFileMode ? "file" : "stdout",
      parserType,
      filePath: isFileMode ? effectiveFilePaths[0] : undefined,
      filePaths: isFileMode ? effectiveFilePaths : undefined,
      sourceLabel:
        isFileMode
          ? effectiveFilePaths.length > 1
            ? `${effectiveFilePaths.length} log files`
            : effectiveFilePaths[0] ?? "file log (select later)"
          : addPaneDraft.runtimeTarget === "ssh"
          ? selectedSshHost
            ? `${selectedSshHost.username}@${selectedSshHost.host}:${selectedSshHost.port}`
            : "ssh host"
          : addPaneDraft.projectPath || "local project",
    } as const

    const nextPane = {
      id: nextPaneId,
      terminalTabId: `log-pane-terminal-${nextServiceId}`,
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
    setPaneLiveStates((prev) => ({ ...prev, [nextPaneId]: true }))
    setLogSources((prev) => [
      ...prev,
      {
        id: `src-${Date.now()}`,
        name: normalizedTitle,
        sourceType: isFileMode ? "file" : "stdout",
        parserType,
        filePath: isFileMode ? effectiveFilePaths[0] : undefined,
        mergeKey: "separate",
      },
    ])
    setServices((prev) => [...prev, nextService])
    setRunCommands((prev) => [
      ...prev,
      {
        id: nextServiceId,
        name: normalizedTitle,
        command: isFileMode
          ? effectiveFilePaths.length > 0
            ? `tail -f ${effectiveFilePaths.join(" ")}`
            : "tail -f <select-log-file>"
          : "npm run dev",
        cwd: addPaneDraft.projectPath || ".",
        sourceType: isFileMode ? "file" : "stdout",
        filePath: isFileMode ? effectiveFilePaths[0] : undefined,
        filePaths: isFileMode ? effectiveFilePaths : undefined,
        status: "idle",
      },
    ])

    setActivePaneId(nextPaneId)
    setIsAddPaneOpen(false)
    setAddPaneDraft(DEFAULT_ADD_PANE_DRAFT)

    if (isTauriRuntime() && isFileMode && effectiveFilePaths.length > 0) {
      const nextCommand: IProjectRunCommand = {
        id: nextServiceId,
        name: normalizedTitle,
        command: `tail -f ${effectiveFilePaths.join(" ")}`,
        cwd: addPaneDraft.projectPath || ".",
        sourceType: "file",
        filePath: effectiveFilePaths[0],
        filePaths: effectiveFilePaths,
        status: "idle",
      }
      void startFileCommand(nextCommand, nextService)
        .then(() => {
          setRunCommands((prev) =>
            prev.map((runCommandEntry) =>
              runCommandEntry.id === nextServiceId
                ? { ...runCommandEntry, status: "running" }
                : runCommandEntry,
            ),
          )
          setPanes((prev) =>
            prev.map((paneEntry) =>
              paneEntry.id === nextPaneId ? { ...paneEntry, status: "running" } : paneEntry,
            ),
          )
        })
        .catch(() => {
          setRunCommands((prev) =>
            prev.map((runCommandEntry) =>
              runCommandEntry.id === nextServiceId ? { ...runCommandEntry, status: "error" } : runCommandEntry,
            ),
          )
          setPanes((prev) =>
            prev.map((paneEntry) =>
              paneEntry.id === nextPaneId ? { ...paneEntry, status: "error" } : paneEntry,
            ),
          )
        })
    }

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
    const selectedPane = panes.find((paneEntry) => paneEntry.id === paneId)
    if (!selectedPane) return []
    const service = servicesById[selectedPane.serviceId]
    if (!service) return []

    const paneRecords = recordsByServiceId[selectedPane.serviceId] ?? []
    const recordsForPane = paneRecords.filter((record) => record.serviceId === selectedPane.serviceId)
    const visibleRecords = filterRecordsBySourceType(
      service.sourceType,
      recordsForPane,
      selectedPane.filters,
    )
    return visibleRecords
  }

  const clearPaneLogs = (paneId: string) => {
    const selectedPane = panes.find((paneEntry) => paneEntry.id === paneId)
    if (!selectedPane) return
    setRecordsByServiceId((prev) => ({
      ...prev,
      [selectedPane.serviceId]: [],
    }))
    delete ptyChunkBufferRef.current[selectedPane.terminalTabId]
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
    updatePaneLogFiles,
    listSshRemoteEntries,
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
