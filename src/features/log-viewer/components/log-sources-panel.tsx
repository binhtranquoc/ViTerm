import { Badge } from "@/shared/components/ui/badge"
import { Button } from "@/shared/components/ui/button"
import type { IProjectLogSource } from "@/features/log-viewer/interfaces/log-viewer.interfaces"

interface LogSourcesPanelProps {
  sources: IProjectLogSource[]
  onMergeModeChange: (sourceId: string, mergeKey: IProjectLogSource["mergeKey"]) => void
}

export function LogSourcesPanel({ sources, onMergeModeChange }: LogSourcesPanelProps) {
  return (
    <section className="rounded-xl border bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Log sources</p>
      <div className="mt-2 space-y-2">
        {sources.map((source) => (
          <div key={source.id} className="rounded-md border bg-background px-2 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-xs font-medium">{source.name}</p>
              <Badge variant="outline" className="text-[10px] capitalize">
                {source.sourceType}
              </Badge>
              <Badge variant="outline" className="text-[10px] uppercase">
                {source.parserType}
              </Badge>
            </div>
            {source.filePath ? (
              <p className="mt-1 truncate text-[11px] text-muted-foreground">file: {source.filePath}</p>
            ) : null}
            <div className="mt-2 flex items-center gap-1.5">
              <Button
                size="sm"
                variant={source.mergeKey === "separate" ? "default" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => onMergeModeChange(source.id, "separate")}
              >
                Separate pane
              </Button>
              <Button
                size="sm"
                variant={source.mergeKey === "merged" ? "default" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => onMergeModeChange(source.id, "merged")}
              >
                Merge timeline
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
