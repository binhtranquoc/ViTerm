import { useRef, useState } from "react"
import { Eraser, FolderOpen, Plus, Settings2, SquareTerminal, X } from "lucide-react"
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
import { cn } from "@/shared/lib/utils"
import { LogPane } from "@/features/log-viewer/components/log-pane"
import { useLogViewerWorkspace } from "@/features/log-viewer/hooks/use-log-viewer-workspace"
import { TerminalXterm } from "@/features/terminal-xterm/components/terminal-xterm"

const paneAccentClassName = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  purple: "bg-violet-500",
} as const

export function LogViewerWorkspace() {
  const workspace = useLogViewerWorkspace()
  const [isProjectSetupOpen, setIsProjectSetupOpen] = useState(false)
  const [isTerminalVisible, setIsTerminalVisible] = useState(true)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const directoryInputProps = { webkitdirectory: "true", directory: "true" } as const
  const isTauriRuntime =
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-5 overflow-hidden p-3">
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

      <div className="flex items-center gap-5 overflow-x-auto rounded-lg border bg-card/70 px-3 py-2.5">
        <button
          type="button"
          className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          onClick={() => workspace.setIsAddPaneOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add pane
        </button>
        <button
          type="button"
          className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => setIsProjectSetupOpen(true)}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Project setup
        </button>
        <div className="h-6 w-px shrink-0 bg-border" />
        {workspace.panes.map((pane) => {
          const service = workspace.servicesById[pane.serviceId]
          const isActive = pane.id === workspace.activePaneId

          return (
            <div
              key={pane.id}
              className={cn(
                "flex shrink-0 items-center rounded-md border text-left text-xs transition-colors",
                isActive
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <button
                type="button"
                className="flex h-10 items-center gap-2 px-3"
                onClick={() => workspace.setActivePaneId(pane.id)}
              >
                <span className={cn("h-2 w-2 rounded-full", paneAccentClassName[pane.accentTone])} />
                <SquareTerminal className="h-3.5 w-3.5" />
                <span>{pane.title}</span>
                <span className="text-[11px] text-muted-foreground">{service?.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${pane.title}`}
                className="mr-2 flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation()
                  workspace.closePaneConnection(pane.id)
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      <Sheet open={workspace.isAddPaneOpen} onOpenChange={workspace.setIsAddPaneOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Add Log Pane</SheetTitle>
            <SheetDescription>
              Select project path. Pane name will be inferred from project folder.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 py-3">
            <div className="rounded-md border bg-muted/40 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Project setup
              </p>
              <div className="mt-5 grid gap-5">
                <Input
                  value={workspace.projectSetup.projectName}
                  onChange={(event) => workspace.updateProjectSetup({ projectName: event.target.value })}
                  placeholder="Project name"
                />
                <div className="grid grid-cols-2 gap-5">
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
              </div>
            </div>
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
                <div className="flex items-center gap-3">
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
                    className="h-10 w-10 shrink-0"
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
                          // Fall back to browser directory input if dialog is unavailable.
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
            )}
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
              onClick={() => {
                workspace.addPaneFromDraft()
              }}
            >
              Add Pane
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={isProjectSetupOpen} onOpenChange={setIsProjectSetupOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Update Project Setup</SheetTitle>
            <SheetDescription>Adjust stack and log behavior for current log workspace.</SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 py-3">
            <Input
              value={workspace.projectSetup.projectName}
              onChange={(event) => workspace.updateProjectSetup({ projectName: event.target.value })}
              placeholder="Project name"
            />
            <div className="grid grid-cols-2 gap-5">
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
          </div>
          <SheetFooter className="pt-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setIsProjectSetupOpen(false)}>
              Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <div className="min-h-0 flex-1">
        {workspace.activePane ? (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex justify-end">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => workspace.clearPaneLogs(workspace.activePane.id)}
                >
                  <Eraser className="h-3.5 w-3.5" />
                  Clear logs
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => setIsTerminalVisible((prev) => !prev)}
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
                service={workspace.servicesById[workspace.activePane.serviceId]}
                services={workspace.services}
                records={workspace.getVisibleRecordsByPane(workspace.activePane.id)}
                draftFilters={
                  workspace.paneFilterDrafts[workspace.activePane.id] ?? workspace.activePane.filters
                }
                isLiveMode={workspace.paneLiveStates[workspace.activePane.id] ?? false}
                onChangeDraftFilters={workspace.updatePaneFilterDraft}
                onApplyDraftFilters={workspace.applyPaneFilterDraft}
                onToggleLiveMode={workspace.setPaneLiveMode}
                onResetFilters={workspace.resetPaneFilters}
                onChangeService={workspace.setPaneService}
              />
              <div
                className={cn(
                  "min-h-0 overflow-hidden rounded-xl border bg-background",
                  isTerminalVisible ? "block" : "hidden",
                )}
              >
                <TerminalXterm
                  tabId={workspace.activePane.terminalTabId}
                  isActive={isTerminalVisible}
                  cwd={workspace.servicesById[workspace.activePane.serviceId]?.sourceLabel ?? "~"}
                  hostId={workspace.servicesById[workspace.activePane.serviceId]?.sshHostId}
                  contentPadding={10}
                />
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
