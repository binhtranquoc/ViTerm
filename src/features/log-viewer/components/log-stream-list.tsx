import { Badge } from "@/shared/components/ui/badge"
import { useAppSelector } from "@/shared/stores/hooks"

const levelVariantMap = {
  error: "destructive",
  warn: "secondary",
  info: "default",
  debug: "outline",
  unknown: "outline",
} as const

interface LogStreamListProps {
  paneId: string
  serviceId?: string
}

export function LogStreamList({ paneId, serviceId }: LogStreamListProps) {
  const { lines, panes } = useAppSelector((state) => state.logViewer)
  const pane = panes.find((item) => item.id === paneId)

  if (!pane) return null

  const visibleLines = lines.filter((line) => {
    const currentServiceId = serviceId ?? pane.serviceId
    if (line.serviceId !== currentServiceId) return false
    if (pane.filters.level !== "all" && line.level !== pane.filters.level) return false
    if (pane.filters.source !== "all" && line.source !== pane.filters.source) return false
    if (pane.filters.keyword.trim().length > 0) {
      const keyword = pane.filters.keyword.toLowerCase()
      return line.message.toLowerCase().includes(keyword) || line.raw.toLowerCase().includes(keyword)
    }
    return true
  })

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3 text-sm font-medium lg:px-5">
        Stream ({visibleLines.length})
      </div>
      <div className="max-h-[52vh] space-y-2 overflow-auto p-3 sm:max-h-[56vh] lg:max-h-[60vh] lg:p-4 2xl:max-h-[64vh]">
        {visibleLines.map((line) => (
          <div key={line.id} className="rounded-lg border bg-background p-3 lg:p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={levelVariantMap[line.level]}>{line.level.toUpperCase()}</Badge>
              <Badge variant="outline">{line.source}</Badge>
              <span className="text-xs text-muted-foreground">{new Date(line.timestamp).toLocaleString()}</span>
            </div>
            <p className="mb-2 wrap-break-word text-sm">{line.message}</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs text-muted-foreground">{line.raw}</pre>
          </div>
        ))}
        {visibleLines.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No logs matched current filters.
          </div>
        ) : null}
      </div>
    </div>
  )
}
