import { useEffect, useRef, useState } from "react"
import { Eraser, FolderOpen, Pencil, Plus, SquareTerminal, Trash2, X } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog"
import { Button } from "@/shared/components/ui/button"
import { Checkbox } from "@/shared/components/ui/checkbox"
import { Input } from "@/shared/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu"
import { useSortableTabDnd } from "@/shared/hooks/use-sortable-tab-dnd"
import { cn } from "@/shared/lib/utils"
import { LogPane } from "@/features/log-viewer/components/log-pane"
import { useLogViewer } from "@/features/log-viewer/hooks/use-log-viewer-workspace"
import { TerminalXterm } from "@/features/terminal-xterm/components/terminal-xterm"

const paneAccentClassName = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  purple: "bg-violet-500",
} as const

export function LogViewerWorkspace() {
  const workspace = useLogViewer()
  const [openPaneMenuId, setOpenPaneMenuId] = useState<string | null>(null)
  const [editingPaneId, setEditingPaneId] = useState("")
  const [editPaneLogPaths, setEditPaneLogPaths] = useState<string[]>([])
  const [editRemotePathDraft, setEditRemotePathDraft] = useState("")
  const [editRemoteBrowsePath, setEditRemoteBrowsePath] = useState("")
  const [editRemoteEntries, setEditRemoteEntries] = useState<
    { name: string; path: string; is_dir: boolean }[]
  >([])
  const [editRemoteLoading, setEditRemoteLoading] = useState(false)
  const [editPaneError, setEditPaneError] = useState("")
  const [addRemotePathDraft, setAddRemotePathDraft] = useState("")
  const [addRemoteBrowsePath, setAddRemoteBrowsePath] = useState("~")
  const [addRemoteEntries, setAddRemoteEntries] = useState<
    { name: string; path: string; is_dir: boolean }[]
  >([])
  const [addRemoteLoading, setAddRemoteLoading] = useState(false)
  const [isTerminalVisible, setIsTerminalVisible] = useState(false)
  const [addPaneError, setAddPaneError] = useState("")
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const logFilesInputRef = useRef<HTMLInputElement | null>(null)
  const editLogFilesInputRef = useRef<HTMLInputElement | null>(null)
  const directoryInputProps = { webkitdirectory: "true", directory: "true" } as const
  const isTauriRuntime =
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

  const replaceFileLogPaths = (incomingPaths: string[]) => {
    const normalizedFilePaths = incomingPaths
      .map((incomingPath) => incomingPath.trim())
      .filter((incomingPath) => incomingPath.length > 0)
    if (normalizedFilePaths.length === 0) return
    workspace.updateProjectSetup({ fileLogPaths: Array.from(new Set(normalizedFilePaths)) })
  }

  const removeFileLogPath = (targetPath: string) => {
    workspace.updateProjectSetup({
      fileLogPaths: workspace.projectSetup.fileLogPaths.filter((existingPath) => existingPath !== targetPath),
    })
  }

  const editingPane = workspace.panes.find((pane) => pane.id === editingPaneId) ?? null
  const editingService = editingPane ? workspace.servicesById[editingPane.serviceId] : undefined

  const activeService =
    workspace.activePane ? workspace.servicesById[workspace.activePane.serviceId] : undefined
  const activePaneVisibleRecords = workspace.activePane
    ? workspace.getVisibleRecordsByPane(workspace.activePane.id)
    : []
  const isActivePaneLiveMode = workspace.activePane
    ? (workspace.paneLiveStates[workspace.activePane.id] ?? false)
    : false
  const getRuntimeLabel = (runtimeTarget?: "local" | "ssh") =>
    runtimeTarget === "ssh" ? "SSH host" : "Local"
  const activePaneServiceLabel = (() => {
    if (!workspace.activePane) return "Unknown source"
    const currentService = workspace.servicesById[workspace.activePane.serviceId]
    if (!currentService) return "Unknown source"
    return `${getRuntimeLabel(currentService.runtimeTarget)} - ${currentService.sourceLabel}`
  })()
  const {
    draggingItemId: draggingPaneId,
    dragPreview,
    onItemPointerDown,
    onItemPointerUp,
  } = useSortableTabDnd({
    itemIds: workspace.panes.map((pane) => pane.id),
    onReorder: workspace.reorderPanes,
    dataAttribute: "data-pane-id",
  })
  const draggingPane = draggingPaneId
    ? workspace.panes.find((pane) => pane.id === draggingPaneId) ?? null
    : null
  const draggingPaneService = draggingPane ? workspace.servicesById[draggingPane.serviceId] : undefined

  useEffect(() => {
    // For SSH file-log mode, auto auth injection may require manual password entry.
    // Show the terminal pane so user can type into the PTY session.
    if (!activeService) return
    if (activeService.runtimeTarget === "ssh" && activeService.sourceType === "file") {
      setIsTerminalVisible(true)
    }
  }, [activeService?.runtimeTarget, activeService?.sourceType, workspace.activePane?.id])

  const beginEditPane = (paneId: string) => {
    const selectedPane = workspace.panes.find((workspacePane) => workspacePane.id === paneId)
    if (!selectedPane) return
    const service = workspace.servicesById[selectedPane.serviceId]
    if (!service) return
    const filePaths = service.filePaths?.filter(Boolean) ?? (service.filePath ? [service.filePath] : [])
    setEditingPaneId(paneId)
    setEditPaneLogPaths(filePaths)
    setEditRemotePathDraft("")
    setEditRemoteBrowsePath(filePaths[0] ? filePaths[0].split("/").slice(0, -1).join("/") || "/" : "~")
    setEditRemoteEntries([])
    setEditPaneError("")
  }

  const closeEditPane = () => {
    setEditingPaneId("")
    setEditPaneLogPaths([])
    setEditRemotePathDraft("")
    setEditRemoteBrowsePath("")
    setEditRemoteEntries([])
    setEditRemoteLoading(false)
    setEditPaneError("")
  }

  useEffect(() => {
    if (!editingPane || editingService?.runtimeTarget !== "ssh") return
    if (!editingService.sshHostId) return
    const targetPath = editRemoteBrowsePath.trim() || "~"
    let disposed = false
    setEditRemoteLoading(true)
    workspace
      .listSshRemoteEntries(editingService.sshHostId, targetPath)
      .then((result) => {
        if (disposed) return
        setEditRemoteBrowsePath(result.base_path || targetPath)
        setEditRemoteEntries(result.entries ?? [])
      })
      .catch((error) => {
        if (disposed) return
        setEditPaneError(error instanceof Error ? error.message : "Failed to list remote entries")
      })
      .finally(() => {
        if (disposed) return
        setEditRemoteLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [editingPane?.id, editingService?.runtimeTarget, editingService?.sshHostId, editRemoteBrowsePath])

  const openEditLogFilesPicker = async () => {
    if (!editingService || editingService.runtimeTarget === "ssh") return
    if (isTauriRuntime) {
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const selected = await invoke<string[] | string | null>("plugin:dialog|open", {
          options: {
            directory: false,
            multiple: true,
            title: "Select log files",
          },
        })
        if (Array.isArray(selected)) {
          setEditPaneLogPaths(
            Array.from(new Set(selected.map((selectedPath) => selectedPath.trim()).filter(Boolean))),
          )
          return
        }
        if (typeof selected === "string" && selected.length > 0) {
          setEditPaneLogPaths([selected])
          return
        }
      } catch (error) {
        console.error("Failed to open log file dialog:", error)
      }
    }
    editLogFilesInputRef.current?.click()
  }

  const openLogFilesPicker = async () => {
    const allowMultiple = workspace.projectSetup.combineFileLogs
    if (workspace.addPaneDraft.runtimeTarget === "ssh") {
      if (!workspace.addPaneDraft.sshHostId) {
        setAddPaneError("Please select an SSH host first")
        return
      }
      setAddPaneError("")
      const targetPath = addRemoteBrowsePath.trim() || "~"
      setAddRemoteLoading(true)
      try {
        const result = await workspace.listSshRemoteEntries(workspace.addPaneDraft.sshHostId, targetPath)
        setAddRemoteBrowsePath(result.base_path || targetPath)
        setAddRemoteEntries(result.entries ?? [])
      } catch (error) {
        setAddPaneError(error instanceof Error ? error.message : "Failed to connect SSH host")
      } finally {
        setAddRemoteLoading(false)
      }
      return
    }
    if (isTauriRuntime) {
      try {
        const { invoke } = await import("@tauri-apps/api/core")
        const selected = await invoke<string[] | string | null>("plugin:dialog|open", {
          options: {
            directory: false,
            multiple: allowMultiple,
            title: "Select log files",
          },
        })
        if (Array.isArray(selected)) {
          replaceFileLogPaths(allowMultiple ? selected : selected.slice(0, 1))
          return
        }
        if (typeof selected === "string" && selected.length > 0) {
          replaceFileLogPaths([selected])
          return
        }
      } catch (error) {
        console.error("Failed to open native log file dialog:", error)
      }
    }
    logFilesInputRef.current?.click()
  }

  const addRemoteLogPath = (path: string) => {
    const normalizedPath = path.trim()
    if (!normalizedPath) return
    if (workspace.projectSetup.combineFileLogs) {
      replaceFileLogPaths([...workspace.projectSetup.fileLogPaths, normalizedPath])
      return
    }
    replaceFileLogPaths([normalizedPath])
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden p-2.5">
      <AlertDialog open={workspace.showRestorePrompt} onOpenChange={workspace.setShowRestorePrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore last project session?</AlertDialogTitle>
            <AlertDialogDescription>
              We detected a Laravel workspace with stdout and file logs. You can restore and run all commands,
              or start from a fresh setup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => workspace.stopAllCommands()}>Start fresh</AlertDialogCancel>
            <AlertDialogAction onClick={() => workspace.runAllCommands()}>Restore and run all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <input
        ref={logFilesInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={(event) => {
          const files = event.target.files
          if (!files || files.length === 0) return
          const fallbackPaths = Array.from(files).map((file) => (file as File & { path?: string }).path ?? file.name)
          replaceFileLogPaths(
            workspace.projectSetup.combineFileLogs ? fallbackPaths : fallbackPaths.slice(0, 1),
          )
          event.currentTarget.value = ""
        }}
      />
      <input
        ref={editLogFilesInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={(event) => {
          const files = event.target.files
          if (!files || files.length === 0) return
          const fallbackPaths = Array.from(files).map((file) => (file as File & { path?: string }).path ?? file.name)
          setEditPaneLogPaths(
            Array.from(new Set(fallbackPaths.map((fallbackPath) => fallbackPath.trim()).filter(Boolean))),
          )
          event.currentTarget.value = ""
        }}
      />

      <div
        className="flex items-center gap-3 overflow-x-auto rounded-lg border bg-card/70 px-2.5 py-2"
      >
        <button
          type="button"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          onClick={() => workspace.setIsAddPaneOpen(true)}
        >
          <Plus className="h-3 w-3" />
          Add pane
        </button>
        <div className="h-5 w-px shrink-0 bg-border" />
        {workspace.panes.map((pane) => {
          const service = workspace.servicesById[pane.serviceId]
          const isActive = pane.id === workspace.activePaneId
          const isDragging = draggingPaneId === pane.id

          return (
            <DropdownMenu
              key={pane.id}
              open={openPaneMenuId === pane.id}
              onOpenChange={(open) => {
                if (!open && openPaneMenuId === pane.id) {
                  setOpenPaneMenuId(null)
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-pane-id={pane.id}
                  className={cn(
                    "flex h-8 shrink-0 select-none items-center gap-1.5 rounded-md border px-2.5 text-left text-[11px] transition-colors",
                    draggingPaneId ? "cursor-grabbing" : "cursor-grab",
                    isDragging ? "scale-95 opacity-30" : "",
                    isActive
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                  onPointerDown={(event) => {
                    onItemPointerDown(event, pane.id)
                  }}
                  onPointerUp={() => {
                    onItemPointerUp()
                  }}
                  onClick={() => workspace.setActivePaneId(pane.id)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    workspace.setActivePaneId(pane.id)
                    setOpenPaneMenuId(pane.id)
                  }}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", paneAccentClassName[pane.accentTone])} />
                  <SquareTerminal className="h-3.5 w-3.5" />
                  <span className="max-w-40 truncate">{pane.title}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {getRuntimeLabel(service?.runtimeTarget)}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => beginEditPane(pane.id)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => workspace.closePaneConnection(pane.id)}
                >
                  <X className="h-3.5 w-3.5" />
                  Close
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}
      </div>
      {dragPreview && draggingPane ? (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: dragPreview.pointerX - dragPreview.offsetX,
            top: dragPreview.pointerY - dragPreview.offsetY,
          }}
        >
          <div className="flex h-8 select-none items-center gap-1.5 rounded-md border border-primary/40 bg-background/95 px-2.5 text-left text-[11px] text-foreground shadow-lg backdrop-blur-sm">
            <span className={cn("h-1.5 w-1.5 rounded-full", paneAccentClassName[draggingPane.accentTone])} />
            <SquareTerminal className="h-3.5 w-3.5" />
            <span className="max-w-40 truncate">{draggingPane.title}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {getRuntimeLabel(draggingPaneService?.runtimeTarget)}
            </span>
          </div>
        </div>
      ) : null}

      <Sheet open={workspace.isAddPaneOpen} onOpenChange={workspace.setIsAddPaneOpen}>
        <SheetContent side="right" className="w-full overflow-hidden sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Add Log Pane</SheetTitle>
            <SheetDescription>
              Select project path. Pane name will be inferred from project folder.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            <div className="space-y-2 rounded-md border bg-muted/40 p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Connection target
              </p>
              <Select
                value={workspace.addPaneDraft.runtimeTarget}
                onValueChange={(value) =>
                  workspace.setAddPaneDraft((prev) => ({
                    ...prev,
                    runtimeTarget: value as "local" | "ssh",
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Runtime target" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local project</SelectItem>
                  <SelectItem value="ssh">SSH host</SelectItem>
                </SelectContent>
              </Select>
              {workspace.addPaneDraft.runtimeTarget === "local" ? (
                <>
                  <input
                    ref={folderInputRef}
                    type="file"
                    className="hidden"
                    {...(directoryInputProps as Record<string, string>)}
                    onChange={(event) => {
                      const files = event.target.files
                      if (!files || files.length === 0) return
                      const firstFile = files[0]
                      const relativePath = firstFile.webkitRelativePath
                      const folderName = relativePath.split("/")[0] ?? ""
                      if (folderName.length > 0) {
                        workspace.setAddPaneDraft((prev) => ({ ...prev, projectPath: folderName }))
                      }
                      event.currentTarget.value = ""
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      value={workspace.addPaneDraft.projectPath}
                      onChange={(event) =>
                        workspace.setAddPaneDraft((prev) => ({ ...prev, projectPath: event.target.value }))
                      }
                      placeholder="Choose project folder"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={async () => {
                        if (isTauriRuntime) {
                          try {
                            const { invoke } = await import("@tauri-apps/api/core")
                            const selectedPath = await invoke<string | null>("plugin:dialog|open", {
                              options: {
                                directory: true,
                                multiple: false,
                                title: "Select project folder",
                              },
                            })
                            if (selectedPath && selectedPath.length > 0) {
                              workspace.setAddPaneDraft((prev) => ({ ...prev, projectPath: selectedPath }))
                              return
                            }
                          } catch (error) {
                            console.error("Failed to open native folder dialog:", error)
                          }
                        }
                        folderInputRef.current?.click()
                      }}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Select
                    value={workspace.addPaneDraft.sshHostId}
                    onValueChange={(value) =>
                      workspace.setAddPaneDraft((prev) => ({ ...prev, sshHostId: value }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select SSH host" />
                    </SelectTrigger>
                    <SelectContent>
                      {workspace.sshHosts.map((host) => (
                        <SelectItem key={host.id} value={host.id}>
                          {host.name} ({host.username}@{host.host}:{host.port})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
            <div className="rounded-md border bg-muted/40 p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Project setup
              </p>
              <div className="mt-3 grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    value={workspace.projectSetup.stack}
                    onValueChange={(value) =>
                      workspace.updateProjectSetup({
                        stack: value as "laravel" | "node" | "go" | "custom",
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Tech stack" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="laravel">Laravel</SelectItem>
                      <SelectItem value="node">Node</SelectItem>
                      <SelectItem value="go">Go</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={workspace.projectSetup.logOutput}
                    onValueChange={(value) =>
                      workspace.updateProjectSetup({
                        logOutput: value as "stdout" | "file" | "mixed",
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Log output" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stdout">Stdout only</SelectItem>
                      <SelectItem value="file">File only</SelectItem>
                      <SelectItem value="mixed">Stdout + file</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-3 rounded-md border bg-background px-3 py-3 text-xs">
                  <Checkbox
                    checked={workspace.projectSetup.combineFileLogs}
                    onCheckedChange={(checked) =>
                      workspace.updateProjectSetup({ combineFileLogs: checked === true })
                    }
                  />
                  Merge multi file logs into one timeline
                </label>
                {workspace.projectSetup.logOutput === "file" ? (
                  <div className="space-y-2 rounded-md border bg-background p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">
                        {workspace.projectSetup.combineFileLogs ? "Merged log files" : "Log file"}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-[11px]"
                        onClick={openLogFilesPicker}
                      >
                        {workspace.addPaneDraft.runtimeTarget === "ssh" ? "Connect & browse" : "Select files"}
                      </Button>
                    </div>
                    {workspace.addPaneDraft.runtimeTarget === "ssh" ? (
                      <div className="space-y-2 rounded-md border bg-muted/40 p-2">
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="/var/log"
                            value={addRemoteBrowsePath}
                            onChange={(event) => setAddRemoteBrowsePath(event.target.value)}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              void openLogFilesPicker()
                            }}
                          >
                            Browse
                          </Button>
                        </div>
                        <div className="max-h-40 space-y-1 overflow-auto rounded border bg-background p-2">
                          {addRemoteLoading ? (
                            <p className="text-xs text-muted-foreground">Connecting SSH host...</p>
                          ) : addRemoteEntries.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No remote entries loaded yet.</p>
                          ) : (
                            addRemoteEntries.map((entry) => (
                              <button
                                key={entry.path}
                                type="button"
                                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                                onClick={() => {
                                  if (entry.is_dir) {
                                    setAddRemoteBrowsePath(entry.path)
                                    return
                                  }
                                  addRemoteLogPath(entry.path)
                                }}
                              >
                                <span className="text-muted-foreground">{entry.is_dir ? "DIR" : "FILE"}</span>
                                <span className="min-w-0 flex-1 truncate">{entry.path}</span>
                              </button>
                            ))
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="/var/log/app.log"
                            value={addRemotePathDraft}
                            onChange={(event) => setAddRemotePathDraft(event.target.value)}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              addRemoteLogPath(addRemotePathDraft)
                              setAddRemotePathDraft("")
                            }}
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <div className="space-y-2">
                      {workspace.projectSetup.fileLogPaths.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No file selected yet.</p>
                      ) : (
                        workspace.projectSetup.fileLogPaths
                          .slice(0, workspace.projectSetup.combineFileLogs ? undefined : 1)
                          .map((path) => (
                          <div key={path} className="flex items-center gap-2 rounded border px-2 py-1.5">
                            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{path}</span>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() => removeFileLogPath(path)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <SheetFooter className="pt-2 sm:flex-row sm:justify-end sm:gap-5">
            <Button
              variant="outline"
              onClick={() => {
                workspace.setIsAddPaneOpen(false)
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={
                (workspace.addPaneDraft.runtimeTarget === "ssh" &&
                  workspace.addPaneDraft.sshHostId.length === 0)
              }
              onClick={() => {
                try {
                  workspace.addPaneFromDraft()
                  setAddPaneError("")
                } catch (error) {
                  setAddPaneError(error instanceof Error ? error.message : "Cannot add pane")
                }
              }}
            >
              Add Pane
            </Button>
          </SheetFooter>
          {addPaneError ? <p className="px-4 pb-2 text-xs text-red-400">{addPaneError}</p> : null}
        </SheetContent>
      </Sheet>

      <Sheet open={editingPaneId.length > 0} onOpenChange={(open) => (!open ? closeEditPane() : undefined)}>
        <SheetContent side="right" className="w-full overflow-hidden sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit Pane Source</SheetTitle>
            <SheetDescription>
              {editingPane ? `Update log files for ${editingPane.title}` : "Update pane source"}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {editingService?.runtimeTarget === "ssh" ? (
              <p className="text-xs text-muted-foreground">
                Enter remote log file paths on the selected host.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Select local log file paths for this pane.
              </p>
            )}
            {editingService?.sourceType !== "file" ? (
              <p className="rounded border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
                This pane is currently using stdout. Saving file paths here will switch it to file-log mode.
              </p>
            ) : null}
            {editingService?.runtimeTarget === "ssh" ? (
              <div className="space-y-2 rounded-md border bg-background p-3">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="/var/log"
                    value={editRemoteBrowsePath}
                    onChange={(event) => setEditRemoteBrowsePath(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditRemoteBrowsePath((prev) => prev.trim() || "~")}
                  >
                    Browse
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setEditRemoteBrowsePath("/var/log")}>
                    /var/log
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setEditRemoteBrowsePath("~/storage/logs")}>
                    ~/storage/logs
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setEditRemoteBrowsePath("~/logs")}>
                    ~/logs
                  </Button>
                </div>
                <div className="max-h-48 space-y-1 overflow-auto rounded border bg-muted/40 p-2">
                  {editRemoteLoading ? (
                    <p className="text-xs text-muted-foreground">Loading remote entries...</p>
                  ) : editRemoteEntries.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No entries found in this path.</p>
                  ) : (
                    editRemoteEntries.map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                        onClick={() => {
                          if (entry.is_dir) {
                            setEditRemoteBrowsePath(entry.path)
                            return
                          }
                          setEditPaneLogPaths((prev) => Array.from(new Set([...prev, entry.path])))
                        }}
                      >
                        <span className="text-muted-foreground">{entry.is_dir ? "DIR" : "FILE"}</span>
                        <span className="min-w-0 flex-1 truncate">{entry.path}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="/var/log/app.log"
                    value={editRemotePathDraft}
                    onChange={(event) => setEditRemotePathDraft(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const next = editRemotePathDraft.trim()
                      if (!next) return
                      setEditPaneLogPaths((prev) => Array.from(new Set([...prev, next])))
                      setEditRemotePathDraft("")
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full" onClick={openEditLogFilesPicker}>
                Select local files
              </Button>
            )}
            <div className="space-y-2">
              {editPaneLogPaths.length === 0 ? (
                <p className="text-xs text-muted-foreground">No file selected.</p>
              ) : (
                editPaneLogPaths.map((path) => (
                  <div key={path} className="flex items-center gap-2 rounded border px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{path}</span>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() =>
                        setEditPaneLogPaths((prevPaths) =>
                          prevPaths.filter((existingPath) => existingPath !== path),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          <SheetFooter className="pt-2 sm:flex-row sm:justify-end sm:gap-2">
            <Button variant="outline" onClick={closeEditPane}>
              Cancel
            </Button>
            <Button
              disabled={!editingPane || editPaneLogPaths.length === 0}
              onClick={async () => {
                if (!editingPane) return
                try {
                  await workspace.updatePaneLogFiles(editingPane.id, editPaneLogPaths)
                  closeEditPane()
                } catch (error) {
                  setEditPaneError(error instanceof Error ? error.message : "Failed to update pane files")
                }
              }}
            >
              Save
            </Button>
          </SheetFooter>
          {editPaneError ? <p className="px-4 pb-2 text-xs text-red-400">{editPaneError}</p> : null}
        </SheetContent>
      </Sheet>

      <div className="min-h-0 flex-1">
        {workspace.activePane ? (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex items-center justify-between rounded-md border bg-card/60 px-2.5 py-1.5">
              <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded border bg-background px-1.5 py-0.5">
                  {activePaneVisibleRecords.length} logs
                </span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5",
                    isActivePaneLiveMode
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {isActivePaneLiveMode ? "live" : "paused"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => workspace.clearPaneLogs(workspace.activePane.id)}
                  title="Clear current pane logs"
                >
                  <Eraser className="h-3 w-3" />
                  Clear logs
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 px-2 text-[11px]",
                    isTerminalVisible
                      ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setIsTerminalVisible((prev) => !prev)}
                  title={isTerminalVisible ? "Hide terminal panel" : "Show terminal panel"}
                >
                  {isTerminalVisible ? "Hide terminal" : "Show terminal"}
                </Button>
              </div>
            </div>
            <div
              className={cn(
                "grid h-full min-h-0 gap-3",
                isTerminalVisible
                  ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
                  : "grid-cols-[minmax(0,1fr)]",
              )}
            >
              <LogPane
                pane={workspace.activePane}
                serviceLabel={activePaneServiceLabel}
                records={activePaneVisibleRecords}
                draftFilters={
                  workspace.paneFilterDrafts[workspace.activePane.id] ?? workspace.activePane.filters
                }
                isLiveMode={workspace.paneLiveStates[workspace.activePane.id] ?? false}
                onChangeDraftFilters={workspace.updatePaneFilterDraft}
                onApplyDraftFilters={workspace.applyPaneFilterDraft}
                onToggleLiveMode={workspace.setPaneLiveMode}
                onResetFilters={workspace.resetPaneFilters}
              />
              <div
                className={cn(
                  "min-h-0 overflow-hidden rounded-xl border bg-background",
                  isTerminalVisible ? "block" : "hidden",
                )}
              >
                <div className="relative h-full w-full">
                  {workspace.panes.map((pane) => {
                    const paneService = workspace.servicesById[pane.serviceId]
                    const isPaneActive = pane.id === workspace.activePane?.id
                    return (
                      <div
                        key={pane.id}
                        className={cn(
                          "absolute inset-0",
                          isPaneActive ? "block" : "hidden",
                        )}
                      >
                        <div className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
                          <div className="flex h-8 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-3 text-xs text-zinc-400">
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-emerald-400/90" />
                              <span>{pane.title}</span>
                              <span className="text-zinc-500">
                                {getRuntimeLabel(paneService?.runtimeTarget)}
                              </span>
                            </div>
                            <span className="text-zinc-500">
                              {paneService?.sourceLabel ?? "~"}
                            </span>
                          </div>
                          <div className="min-h-0 flex-1">
                            <TerminalXterm
                              tabId={pane.terminalTabId}
                              isActive={isTerminalVisible && isPaneActive}
                              cwd={paneService?.sourceLabel ?? "~"}
                              hostId={paneService?.sshHostId}
                              keepSessionOnUnmount
                            />
                          </div>
                          <div className="flex h-7 items-center justify-between border-t border-zinc-800 bg-zinc-900/70 px-3 text-[11px] text-zinc-500">
                            <span>UTF-8</span>
                            <span>PTY connected</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
            No pane yet. Add a pane to start viewing logs.
          </div>
        )}
      </div>
    </div>
  )
}
