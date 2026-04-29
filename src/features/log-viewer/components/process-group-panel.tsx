import { Play, Square, TerminalSquare } from "lucide-react"
import { Badge } from "@/shared/components/ui/badge"
import { Button } from "@/shared/components/ui/button"
import type { IProjectRunCommand } from "@/features/log-viewer/interfaces/log-viewer.interfaces"

interface ProcessGroupPanelProps {
  commands: IProjectRunCommand[]
  onRunAll: () => void
  onStopAll: () => void
  onToggleCommand: (commandId: string) => void
}

export function ProcessGroupPanel({
  commands,
  onRunAll,
  onStopAll,
  onToggleCommand,
}: ProcessGroupPanelProps) {
  const runningCount = commands.filter((item) => item.status === "running").length

  return (
    <section className="rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Process group</p>
        <Badge variant="outline" className="text-xs">
          {runningCount}/{commands.length} running
        </Badge>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" className="h-8" onClick={onRunAll}>
          <Play className="mr-1.5 h-3.5 w-3.5" />
          Run all
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={onStopAll}>
          <Square className="mr-1.5 h-3.5 w-3.5" />
          Stop all
        </Button>
      </div>

      <div className="mt-2 space-y-2">
        {commands.map((command) => (
          <div key={command.id} className="rounded-md border bg-background px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{command.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{command.command}</p>
                <p className="truncate text-[11px] text-muted-foreground">cwd: {command.cwd}</p>
              </div>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => onToggleCommand(command.id)}>
                <TerminalSquare className="mr-1 h-3.5 w-3.5" />
                {command.status === "running" ? "Stop" : "Run"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
