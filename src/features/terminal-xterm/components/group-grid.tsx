import { Folder } from "lucide-react"

import type { ISshHost } from "@/features/terminal-xterm/interfaces/ssh-host.interfaces"

interface GroupGridProps {
  sshHosts: ISshHost[]
  sshGroups: string[]
  selectedGroup: string
  onSelectGroup: (group: string) => void
}

export function GroupGrid({ sshHosts, sshGroups, selectedGroup, onSelectGroup }: GroupGridProps) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-semibold">Groups</h3>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          onClick={() => onSelectGroup("all")}
          className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
            selectedGroup === "all"
              ? "border-primary bg-primary/10"
              : "border-border bg-muted/30 hover:bg-muted/50"
          }`}
        >
          <div className="mb-1 flex items-center gap-2">
            <Folder className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">All hosts</span>
          </div>
          <div className="text-xs text-muted-foreground">{sshHosts.length} host(s)</div>
        </button>
        {sshGroups.map((group) => {
          const hostCount = sshHosts.filter((host) => host.group_parent === group).length
          return (
            <button
              key={group}
              type="button"
              onClick={() => onSelectGroup(group)}
              className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                selectedGroup === group
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted/30 hover:bg-muted/50"
              }`}
            >
              <div className="mb-1 flex items-center gap-2">
                <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{group}</span>
              </div>
              <div className="text-xs text-muted-foreground">{hostCount} host(s)</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
