import { useEffect, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Plus, Trash2 } from "lucide-react"
import { Badge } from "@/shared/components/ui/badge"
import { Button } from "@/shared/components/ui/button"
import { Input } from "@/shared/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select"
import { cn } from "@/shared/lib/utils"
import {
  createDefaultFieldCondition,
  LOG_VIEWER_FIELD_OPERATOR_OPTIONS,
  LOG_VIEWER_LEVEL_OPTIONS,
  LOG_VIEWER_STATUS_LABEL,
} from "@/features/log-viewer/constants/log-viewer.const"
import type {
  ILogFieldFilterCondition,
  ILogPaneFilters,
  ILogPaneState,
  ILogRecord,
} from "@/features/log-viewer/interfaces/log-viewer.interfaces"

const levelClassName = {
  error: "text-red-400 border-red-500/40 bg-red-500/10",
  warn: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  info: "text-blue-300 border-blue-500/40 bg-blue-500/10",
  debug: "text-zinc-300 border-zinc-500/40 bg-zinc-500/10",
  unknown: "text-zinc-300 border-zinc-500/40 bg-zinc-500/10",
} as const

const paneAccentClassName = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  purple: "bg-violet-500",
} as const

type TJsonViewMode = "pretty" | "compact"

const parseRecordJson = (record: ILogRecord): Record<string, unknown> | null => {
  const raw = record.raw.trim()
  const start = raw.indexOf("{")
  if (start === -1) return null

  const slice = raw.slice(start)
  try {
    const parsed = JSON.parse(slice)
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    const end = slice.lastIndexOf("}")
    if (end > 0) {
      try {
        const parsed = JSON.parse(slice.slice(0, end + 1))
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
      } catch {
        return null
      }
    }
  }
  return null
}

const formatRecordContent = (record: ILogRecord, jsonViewMode: TJsonViewMode) => {
  if (record.parserType !== "json" && record.parserType !== "nginx") {
    return record.message || record.raw
  }
  const parsed = parseRecordJson(record)
  if (!parsed) return record.raw
  return jsonViewMode === "pretty" ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed)
}

interface LogPaneProps {
  pane: ILogPaneState
  serviceLabel: string
  records: ILogRecord[]
  draftFilters: ILogPaneFilters
  isLiveMode: boolean
  onChangeDraftFilters: (paneId: string, filters: ILogPaneFilters) => void
  onApplyDraftFilters: (paneId: string) => void
  onToggleLiveMode: (paneId: string, isLive: boolean) => void
  onResetFilters: (paneId: string) => void
}

export function LogPane({
  pane,
  serviceLabel,
  records,
  draftFilters,
  isLiveMode,
  onChangeDraftFilters,
  onApplyDraftFilters,
  onToggleLiveMode,
  onResetFilters,
}: LogPaneProps) {
  const statusClassName =
    pane.status === "running"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
      : pane.status === "error"
        ? "bg-red-500/15 text-red-300 border-red-500/40"
        : "bg-zinc-500/15 text-zinc-300 border-zinc-500/40"
  const [jsonViewMode, setJsonViewMode] = useState<TJsonViewMode>("pretty")
  const scrollParentRef = useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 120,
    overscan: 8,
  })
  const virtualItems = rowVirtualizer.getVirtualItems()
  const fieldOptions = Array.from(
    new Set(records.flatMap((record) => Object.keys(record.fields ?? {}))),
  ).sort((left, right) => left.localeCompare(right))

  const updateFieldCondition = (conditionId: string, updater: Partial<ILogFieldFilterCondition>) => {
    onChangeDraftFilters(pane.id, {
      ...draftFilters,
      fieldConditions: draftFilters.fieldConditions.map((condition) =>
        condition.id === conditionId ? { ...condition, ...updater } : condition,
      ),
    })
  }

  useEffect(() => {
    if (!isLiveMode) return
    if (records.length === 0) return
    const lastIndex = records.length - 1
    rowVirtualizer.scrollToIndex(lastIndex, { align: "end" })
  }, [isLiveMode, records.length, rowVirtualizer])

  return (
    <article className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card/80">
      <header className="flex flex-wrap items-center gap-5 border-b px-5 py-3">
        <span className={cn("h-2.5 w-2.5 rounded-full", paneAccentClassName[pane.accentTone])} />
        <Badge variant="outline" className={cn("text-xs", statusClassName)}>
          {LOG_VIEWER_STATUS_LABEL[pane.status]}
        </Badge>
        <Badge variant={isLiveMode ? "default" : "secondary"} className="text-xs">
          {isLiveMode ? "Live" : "Paused"}
        </Badge>
        <span className="text-xs text-muted-foreground">{serviceLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border bg-background p-1">
            <Button
              size="sm"
              variant={jsonViewMode === "pretty" ? "default" : "ghost"}
              className="h-7 px-2 text-[11px]"
              onClick={() => setJsonViewMode("pretty")}
            >
              Pretty
            </Button>
            <Button
              size="sm"
              variant={jsonViewMode === "compact" ? "default" : "ghost"}
              className="h-7 px-2 text-[11px]"
              onClick={() => setJsonViewMode("compact")}
            >
              Compact
            </Button>
          </div>
          <Button
            size="sm"
            variant={isLiveMode ? "secondary" : "default"}
            className="h-9 px-3 text-xs"
            onClick={() => onToggleLiveMode(pane.id, !isLiveMode)}
          >
            {isLiveMode ? "Pause" : "Resume live"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 px-3 text-xs"
            disabled={isLiveMode}
            onClick={() => onApplyDraftFilters(pane.id)}
          >
            Apply filter
          </Button>
        </div>
      </header>

      <div className="grid gap-4 border-b p-5 md:grid-cols-[minmax(220px,1.8fr)_minmax(180px,1fr)_auto]">
        <Input
          value={draftFilters.keyword}
          placeholder="Filter by keyword..."
          onChange={(event) =>
            onChangeDraftFilters(pane.id, {
              ...draftFilters,
              keyword: event.target.value,
            })
          }
        />

        <Select
          value={draftFilters.level}
          onValueChange={(value) =>
            onChangeDraftFilters(pane.id, {
              ...draftFilters,
              level: value as ILogPaneFilters["level"],
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent>
            {LOG_VIEWER_LEVEL_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" className="h-10" onClick={() => onResetFilters(pane.id)}>
          Reset
        </Button>
      </div>
      <div className="space-y-3 border-b px-5 py-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">Field Filters (AND)</p>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-[11px]"
            onClick={() =>
              onChangeDraftFilters(pane.id, {
                ...draftFilters,
                fieldConditions: [...draftFilters.fieldConditions, createDefaultFieldCondition()],
              })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add condition
          </Button>
        </div>
        {draftFilters.fieldConditions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No field condition. Add one to filter by key/value.</p>
        ) : null}
        {draftFilters.fieldConditions.map((condition) => (
          <div key={condition.id} className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_140px_minmax(180px,1fr)_auto]">
            <Input
              list={`field-options-${pane.id}`}
              placeholder="field (e.g. status, user.id)"
              value={condition.field}
              onChange={(event) => updateFieldCondition(condition.id, { field: event.target.value })}
            />
            <Select
              value={condition.operator}
              onValueChange={(value) =>
                updateFieldCondition(condition.id, { operator: value as ILogFieldFilterCondition["operator"] })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_VIEWER_FIELD_OPERATOR_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder={condition.operator === "exists" ? "No value needed" : "value"}
              value={condition.value}
              disabled={condition.operator === "exists"}
              onChange={(event) => updateFieldCondition(condition.id, { value: event.target.value })}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10"
              onClick={() =>
                onChangeDraftFilters(pane.id, {
                  ...draftFilters,
                  fieldConditions: draftFilters.fieldConditions.filter(
                    (fieldCondition) => fieldCondition.id !== condition.id,
                  ),
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <datalist id={`field-options-${pane.id}`}>
          {fieldOptions.map((field) => (
            <option key={field} value={field} />
          ))}
        </datalist>
      </div>
      {!isLiveMode ? (
        <div className="border-b bg-muted/30 px-5 py-2 text-xs text-muted-foreground">
          Pane is paused. Filters are applied only when you click "Apply filter".
        </div>
      ) : null}

      <div ref={scrollParentRef} className="application-scrollbar-ultra-thin min-h-0 flex-1 overflow-auto bg-background/50 p-5">
        {records.length > 0 ? (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualItems.map((virtualRow) => {
              const record = records[virtualRow.index]
              return (
                <div
                  key={record.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full pb-3"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="rounded-lg border bg-background p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={cn("rounded border px-2 py-0.5 text-[11px] font-medium", levelClassName[record.level])}>
                        {record.level.toUpperCase()}
                      </span>
                      <Badge variant="outline" className="text-[11px] capitalize">
                        {record.sourceType}
                      </Badge>
                      <Badge variant="outline" className="text-[11px] uppercase">
                        {record.parserType}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(record.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <pre className="application-scrollbar-ultra-thin mt-2 overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-md border bg-muted/60 p-2 text-xs text-muted-foreground">
                      {formatRecordContent(record, jsonViewMode)}
                    </pre>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        {records.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-background px-4 py-8 text-center text-sm text-muted-foreground">
            No logs matched this pane filters.
          </div>
        ) : null}
      </div>
    </article>
  )
}
