import type {
  ILogFieldFilterCondition,
  ILogPaneFilters,
} from "@/features/log-viewer/interfaces/log-viewer.interfaces"

export const LOG_VIEWER_STATUS_LABEL = {
  running: "Running",
  paused: "Paused",
  stopped: "Stopped",
  error: "Error",
} as const

export const LOG_VIEWER_LEVEL_OPTIONS = [
  { value: "all", label: "All levels" },
  { value: "error", label: "Error" },
  { value: "warn", label: "Warn" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
  { value: "unknown", label: "Unknown" },
] as const

export const LOG_VIEWER_FIELD_OPERATOR_OPTIONS = [
  { value: "equals", label: "=" },
  { value: "not_equals", label: "!=" },
  { value: "contains", label: "contains" },
  { value: "exists", label: "exists" },
] as const

export const createDefaultFieldCondition = (): ILogFieldFilterCondition => ({
  id: `cond-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  field: "",
  operator: "equals",
  value: "",
})

export const LOG_VIEWER_DEFAULT_FILTERS: ILogPaneFilters = {
  keyword: "",
  level: "all",
  fieldConditions: [],
}
