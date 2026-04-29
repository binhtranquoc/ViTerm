import { Copy, Edit2, Server, TerminalSquare, Trash2 } from "lucide-react"

import type { ISshHost } from "@/features/terminal-xterm/interfaces/ssh-host.interfaces"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu"

interface HostGridProps {
  hosts: ISshHost[]
  selectedGroup: string
  hostMenuOpenId: string | null
  onHostMenuOpenChange: (hostId: string, open: boolean) => void
  onConnectHost: (host: ISshHost) => void
  onCopySshCommand: (host: ISshHost) => void | Promise<void>
  onCopySshPassCommand: (host: ISshHost) => void | Promise<void>
  onEditHost: (host: ISshHost) => void | Promise<void>
  onDuplicateHost: (host: ISshHost) => void | Promise<void>
  onDeleteHost: (host: ISshHost) => void
}

export function HostGrid({
  hosts,
  selectedGroup,
  hostMenuOpenId,
  onHostMenuOpenChange,
  onConnectHost,
  onCopySshCommand,
  onCopySshPassCommand,
  onEditHost,
  onDuplicateHost,
  onDeleteHost,
}: HostGridProps) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        {selectedGroup === "all" ? "SSH Hosts" : `Hosts in ${selectedGroup}`}
      </h3>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {hosts.length === 0 && (
          <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            {selectedGroup === "all"
              ? 'No hosts yet. Click "New Host" to add one.'
              : `Group "${selectedGroup}" has no hosts.`}
          </div>
        )}
        {hosts.map((host) => (
          <div
            key={host.id}
            className="group relative rounded-lg border border-border bg-muted/30 px-2.5 py-2 transition-colors hover:bg-muted/50"
          >
            <DropdownMenu
              open={hostMenuOpenId === host.id}
              onOpenChange={(open) => onHostMenuOpenChange(host.id, open)}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="w-full pr-16 text-left"
                  onClick={() => {
                    onHostMenuOpenChange(host.id, false)
                    onConnectHost(host)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onHostMenuOpenChange(host.id, true)
                  }}
                  onPointerDown={(e) => {
                    if (e.button === 0) e.preventDefault()
                  }}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Server className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">{host.name}</span>
                  </div>
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    <div>
                      {host.username}@{host.host}:{host.port}
                    </div>
                    {host.group_parent && <div>group: {host.group_parent}</div>}
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuItem onClick={() => onConnectHost(host)}>
                  <TerminalSquare className="h-4 w-4" />
                  Connect
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void onCopySshCommand(host)}>
                  <Copy className="h-4 w-4" />
                  Copy SSH
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void onCopySshPassCommand(host)}>
                  <Copy className="h-4 w-4" />
                  Copy SSHPass
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void onEditHost(host)}>
                  <Edit2 className="h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void onDuplicateHost(host)}>
                  <Copy className="h-4 w-4" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => onDeleteHost(host)}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="absolute right-2 top-2 z-10">
              <button
                type="button"
                title="Edit host"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  void onEditHost(host)
                }}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
