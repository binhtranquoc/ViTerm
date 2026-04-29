import { useMemo, useRef, useState } from "react"
import { LOG_VIEWER_DEFAULT_FILTERS } from "@/features/log-viewer/constants/log-viewer.const"
import { filterRecordsBySourceType } from "@/features/log-viewer/utils/log-filter.utils"
import { useSshHosts } from "@/features/terminal-xterm/hooks/use-ssh-hosts"
import type {
  IAddPaneDraft,
  ICreatedPaneResult,
  ILogPaneState,
  ILogPaneFilters,
  ILogRecord,
  ILogService,
  ILogViewerWorkspaceCache,
  IProjectLogSource,
  IProjectSetupState,
  IProjectRunCommand,
  ISshRemoteEntry,
} from "@/features/log-viewer/interfaces/log-viewer.interfaces"
import {
  DEFAULT_ADD_PANE_DRAFT,
  getProjectFolderName,
  invokeTauri,
  isTauriRuntime,
} from "@/features/log-viewer/hooks/use-log-viewer-runtime"
import { useLogViewerStreamEffects } from "@/features/log-viewer/hooks/use-log-viewer-stream-effects"
import { useLogViewerSyncEffects } from "@/features/log-viewer/hooks/use-log-viewer-sync-effects"

const logViewerWorkspaceCache: ILogViewerWorkspaceCache = {
  services: [],
  panes: [],
  activePaneId: "",
  runCommands: [],
  logSources: [],
  projectSetup: {
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

 

export function useLogViewer() {
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

  const servicesById = useMemo(
    () => Object.fromEntries(services.map((service) => [service.id, service])),
    [services],
  )

  const activePane = panes.find((pane) => pane.id === activePaneId) ?? panes[0] ?? null
  const paneByTerminalTabId = useMemo(
    () => Object.fromEntries(panes.map((pane) => [pane.terminalTabId, pane])),
    [panes],
  )
  const {
    panesRef,
    paneLiveStatesRef,
    servicesByIdRef,
    paneByTerminalTabIdRef,
  } = useLogViewerSyncEffects({
    cache: logViewerWorkspaceCache,
    services,
    panes,
    activePaneId,
    runCommands,
    logSources,
    projectSetup,
    addPaneDraft,
    paneFilterDrafts,
    paneLiveStates,
    recordsByServiceId,
    servicesById,
    paneByTerminalTabId,
    setPaneLiveStates,
  })

  useLogViewerStreamEffects({
    panesRef,
    paneLiveStatesRef,
    servicesByIdRef,
    paneByTerminalTabIdRef,
    ptyChunkBufferRef,
    setRecordsByServiceId,
    setPanes,
    setRunCommands,
  })

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

  const reorderPanes = (sourcePaneId: string, targetPaneId: string) => {
    if (sourcePaneId === targetPaneId) return
    setPanes((prevPanes) => {
      const sourceIndex = prevPanes.findIndex((pane) => pane.id === sourcePaneId)
      const targetIndex = prevPanes.findIndex((pane) => pane.id === targetPaneId)
      if (sourceIndex < 0 || targetIndex < 0) return prevPanes
      const nextPanes = [...prevPanes]
      const [movingPane] = nextPanes.splice(sourceIndex, 1)
      nextPanes.splice(targetIndex, 0, movingPane)
      return nextPanes
    })
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
              jsonOnly: false,
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
            jsonOnly: false,
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
        : folderName || `Project ${nextPaneIndex}`
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
    reorderPanes,
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

export const useLogViewerWorkspace = useLogViewer
