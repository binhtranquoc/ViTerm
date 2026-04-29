import { Copy, Folder, Home, Link2, Plus, Search, Server, TerminalSquare, X } from "lucide-react"
import { Button } from "@/shared/components/ui/button"
import { Input } from "@/shared/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet"
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
import { DropdownMenuItem } from "@/shared/components/ui/dropdown-menu"
import { GroupDetailBreadcrumb } from "@/features/terminal-xterm/components/group-detail-breadcrumb"
import { GroupGrid } from "@/features/terminal-xterm/components/group-grid"
import { HostForm } from "@/features/terminal-xterm/components/host-form"
import { HostGrid } from "@/features/terminal-xterm/components/host-grid"
import { useTerminalWorkspace } from "@/features/terminal-xterm/hooks/use-terminal-workspace"
import { TabContextMenuChip } from "@/shared/app-components/common/tab-context-menu-chip"
import { useSortableTabDnd } from "@/shared/hooks/use-sortable-tab-dnd"
import { useMenuById } from "@/shared/hooks/use-menu-by-id"
import { TerminalXterm } from "@/features/terminal-xterm/components/terminal-xterm"

export function TerminalWorkspacePage() {
  const workspace = useTerminalWorkspace()
  const hostMenu = useMenuById()
  const tabMenu = useMenuById()
  const {
    draggingItemId: draggingTabId,
    dragPreview,
    onItemPointerDown,
    onItemPointerUp,
  } = useSortableTabDnd({
    itemIds: workspace.terminalTabs.map((tab) => tab.id),
    onReorder: workspace.reorderTerminalTabs,
    dataAttribute: "data-terminal-tab-id",
    canStartDrag: (event) => !(event.target as HTMLElement).closest('button[aria-label="Close tab"]'),
  })
  const draggingTab = draggingTabId
    ? workspace.terminalTabs.find((tab) => tab.id === draggingTabId) ?? null
    : null

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden p-2">
      <div className="rounded-lg border bg-card/80 px-2 py-1.5 shadow-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <Button variant={workspace.isHomeTabActive ? "default" : "outline"} className="h-8 shrink-0 px-2.5" onClick={workspace.goHome}>
            <Home className="mr-1 h-3.5 w-3.5" />
            Home
          </Button>
          {workspace.terminalTabs.map((tab) => (
            <div
              key={tab.id}
              data-terminal-tab-id={tab.id}
              className={`${draggingTabId ? "cursor-grabbing" : "cursor-grab"} ${
                draggingTabId === tab.id ? "scale-95 opacity-30" : ""
              }`}
              onPointerDown={(event) => {
                onItemPointerDown(event, tab.id)
              }}
              onPointerUp={() => {
                onItemPointerUp()
              }}
            >
              <TabContextMenuChip
                id={tab.id}
                title={tab.title}
                icon={tab.kind === "terminal" ? <TerminalSquare className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
                isActive={workspace.activeWorkspaceTab === tab.id}
                isMenuOpen={tabMenu.openId === tab.id}
                onMenuOpenChange={tabMenu.onOpenChange}
                onActivate={workspace.setActiveWorkspaceTab}
                onOpenContextMenu={tabMenu.openById}
                onClose={workspace.closeTerminalTab}
                menuContent={
                  <>
                    <DropdownMenuItem onClick={() => { workspace.setActiveWorkspaceTab(tab.id); tabMenu.close() }}>
                      <Link2 className="h-4 w-4" />
                      Connect
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { workspace.duplicateTerminalTab(tab.id); tabMenu.close() }}>
                      <Copy className="h-4 w-4" />
                      Duplicate tab
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => { workspace.closeTerminalTab(tab.id); tabMenu.close() }}>
                      <X className="h-4 w-4" />
                      Close
                    </DropdownMenuItem>
                  </>
                }
              />
            </div>
          ))}
          <button type="button" aria-label="Create new tab" className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => workspace.setIsQuickAddOpen(true)}>
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      {dragPreview && draggingTab ? (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: dragPreview.pointerX - dragPreview.offsetX,
            top: dragPreview.pointerY - dragPreview.offsetY,
          }}
        >
          <div className="group flex h-8 shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-background/95 px-1.5 text-foreground shadow-lg backdrop-blur-sm">
            {draggingTab.kind === "terminal" ? <TerminalSquare className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
            <span>{draggingTab.title}</span>
          </div>
        </div>
      ) : null}

      <AlertDialog open={!!workspace.deleteTarget} onOpenChange={(open) => { if (!open) workspace.setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this host?</AlertDialogTitle>
            <AlertDialogDescription>
              Host <strong>{workspace.deleteTarget?.name}</strong> ({workspace.deleteTarget?.username}@{workspace.deleteTarget?.host}) will be permanently deleted along with its saved credentials. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={workspace.confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={workspace.isQuickAddOpen} onOpenChange={workspace.setIsQuickAddOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>New Tab</SheetTitle>
            <SheetDescription>Create a new terminal or open a recent host.</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={workspace.quickQuery} onChange={(e) => workspace.setQuickQuery(e.target.value)} placeholder="Search tabs or recent hosts..." className="h-9 pl-8" />
            </div>
            <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Quick Actions</div>
            <button type="button" className="flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-sm hover:bg-muted" onClick={() => { workspace.openTerminalTab(); workspace.setIsQuickAddOpen(false); workspace.setQuickQuery("") }}>
              <TerminalSquare className="h-4 w-4 text-muted-foreground" />
              <span>New Terminal</span>
            </button>
            <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Hosts</div>
            <div className="max-h-60 space-y-1 overflow-auto pr-1">
              {workspace.quickActions.map((quickActionHost) => (
                <button key={quickActionHost.id} type="button" className="flex w-full items-start gap-2 rounded-md border px-2 py-2 text-left hover:bg-muted" onClick={() => { workspace.openSshTerminalTab(quickActionHost); workspace.setIsQuickAddOpen(false); workspace.setQuickQuery("") }}>
                  <Server className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{quickActionHost.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{quickActionHost.username}@{quickActionHost.host}:{quickActionHost.port}</span>
                  </span>
                </button>
              ))}
              {workspace.quickActions.length === 0 && <div className="rounded-md border border-dashed px-2 py-3 text-xs text-muted-foreground">No matching hosts.</div>}
            </div>
          </div>
          <SheetFooter className="sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => { workspace.setIsQuickAddOpen(false); workspace.setQuickQuery("") }}>Close</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={workspace.isNewHostOpen} onOpenChange={workspace.setIsNewHostOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader className="shrink-0">
            <SheetTitle>New Host</SheetTitle>
            <SheetDescription>SSH host details are stored locally on this machine.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto"><HostForm form={workspace.newHost} onChange={workspace.setNewHost} /></div>
          <SheetFooter className="shrink-0 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => workspace.setIsNewHostOpen(false)}>Cancel</Button>
            <Button onClick={workspace.handleAddHost} disabled={workspace.createSshHostPending}>Save Host</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={!!workspace.editingHost} onOpenChange={(open) => { if (!open) workspace.closeEditHostSheet() }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader className="shrink-0">
            <SheetTitle>Edit Host</SheetTitle>
            <SheetDescription>Update host details. Leave the password/key fields empty if you do not want to change them.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <HostForm form={workspace.editHost} onChange={workspace.setEditHost} isEdit isLoadingSecrets={workspace.isLoadingSecrets} />
          </div>
          <SheetFooter className="shrink-0 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={workspace.closeEditHostSheet}>Cancel</Button>
            <Button onClick={workspace.handleUpdateHost} disabled={workspace.updateSshHostPending}>Save Changes</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {workspace.isHomeTabActive && (
          <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
            <div className="shrink-0 flex items-center gap-2">
              <Input value={workspace.searchKeyword} onChange={(e) => workspace.setSearchKeyword(e.target.value)} placeholder="Find a host..." className="h-9 min-w-[260px] flex-1" />
              <Button variant="outline" onClick={() => workspace.setIsNewHostOpen(true)}><Plus className="mr-1 h-4 w-4" />New Host</Button>
            </div>
            <div className="application-scrollbar-thin mt-3 min-h-0 flex-1 overflow-auto bg-card">
              {workspace.selectedGroup === "all" ? (
                <GroupGrid sshHosts={workspace.sshHosts} sshGroups={workspace.sshGroups} selectedGroup={workspace.selectedGroup} onSelectGroup={workspace.setSelectedGroup} />
              ) : (
                <GroupDetailBreadcrumb groupName={workspace.selectedGroup} onBackToAllGroups={() => workspace.setSelectedGroup("all")} />
              )}
              <HostGrid
                hosts={workspace.filteredHosts}
                selectedGroup={workspace.selectedGroup}
                hostMenuOpenId={hostMenu.openId}
                onHostMenuOpenChange={hostMenu.onOpenChange}
                onConnectHost={workspace.openSshTerminalTab}
                onCopySshCommand={workspace.copySshCommand}
                onCopySshPassCommand={workspace.copySshPassCommand}
                onEditHost={workspace.openEditSheet}
                onDuplicateHost={workspace.duplicateHost}
                onDeleteHost={workspace.setDeleteTarget}
              />
            </div>
          </section>
        )}
        {workspace.terminalTabs.map((tab) => (
          <div key={tab.id} className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-[0_8px_24px_rgba(0,0,0,0.25)]" style={{ display: workspace.activeWorkspaceTab === tab.id ? "flex" : "none" }}>
            <div className="flex h-8 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-3 text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400/90" />
                <span>{tab.title}</span>
                <span className="text-zinc-500">{tab.shellLabel ?? "zsh"}</span>
              </div>
              <span className="text-zinc-500">{tab.locationLabel ?? "local • ~"}</span>
            </div>
            <div className="min-h-0 flex-1">
              <TerminalXterm
                tabId={tab.id}
                isActive={workspace.activeWorkspaceTab === tab.id}
                cwd={tab.cwd ?? "~"}
                hostId={tab.hostId}
                startupProgram={tab.startupProgram}
                startupArgs={tab.startupArgs}
                reconnectNonce={workspace.reconnectNonceByTabId[tab.id] ?? 0}
                onRequestEditHost={workspace.requestEditHostById}
                keepSessionOnUnmount
              />
            </div>
            <div className="flex h-7 items-center justify-between border-t border-zinc-800 bg-zinc-900/70 px-3 text-[11px] text-zinc-500">
              <span>UTF-8</span>
              <span>PTY connected</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
