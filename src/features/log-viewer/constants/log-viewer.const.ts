import type { ILogPaneFilters } from "@/features/log-viewer/interfaces/log-viewer.interfaces"

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

export const LOG_VIEWER_SOURCE_OPTIONS = [
  { value: "all", label: "All sources" },
  { value: "stdout", label: "Stdout" },
  { value: "file", label: "File log" },
] as const

export const LOG_VIEWER_PARSER_OPTIONS = [
  { value: "all", label: "All parser types" },
  { value: "json", label: "JSON" },
  { value: "text", label: "Text" },
  { value: "nginx", label: "Nginx" },
] as const

export const LOG_VIEWER_DEFAULT_FILTERS: ILogPaneFilters = {
  keyword: "",
  level: "all",
  sourceType: "all",
  parserType: "all",
}
