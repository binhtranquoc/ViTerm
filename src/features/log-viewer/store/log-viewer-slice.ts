import { createSlice, type PayloadAction } from "@reduxjs/toolkit"
import logLines from "@/features/log-viewer/mocks/log-lines.json"
import menuData from "@/features/log-viewer/mocks/log-menu.json"

export type LogLevel = "error" | "warn" | "info" | "debug" | "unknown"

export interface LogLine {
  id: string
  serviceId: string
  timestamp: string
  level: LogLevel
  source: string
  message: string
  raw: string
}

interface ServiceMenuItem {
  id: string
  title: string
  url: string
  icon: string
  isActive?: boolean
}

interface LogViewerFilters {
  keyword: string
  level: "all" | LogLevel
  source: "all" | "json" | "stdout"
}

export type PaneStatus = "running" | "stopped" | "error"

export interface LogPane {
  id: string
  serviceId: string
  status: PaneStatus
  color: string
  filters: LogViewerFilters
}

interface HostNode {
  id: string
  name: string
  target: string
}

interface HostGroup {
  id: string
  name: string
  hosts: HostNode[]
}

interface HostHistoryItem {
  id: string
  name: string
  target: string
  status: string
}

interface TerminalSessionState {
  command: string
  cwd: string
  isRunning: boolean
  lastError: string | null
}

interface LogViewerState {
  services: ServiceMenuItem[]
  panes: LogPane[]
  activePaneId: string
  lines: LogLine[]
  groups: HostGroup[]
  hostHistory: HostHistoryItem[]
  terminal: TerminalSessionState
}

const defaultFilters: LogViewerFilters = {
  keyword: "",
  level: "all",
  source: "all",
}

const paneColors = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899"]
const statusCycle: PaneStatus[] = ["stopped"]

const createPane = (serviceId: string, index: number): LogPane => ({
  id: `pane-${index + 1}`,
  serviceId,
  status: statusCycle[index % statusCycle.length],
  color: paneColors[index % paneColors.length],
  filters: { ...defaultFilters },
})

const buildDefaultPane = (serviceIds: string[]): LogPane[] => {
  const defaultServiceId = serviceIds[0] ?? ""
  return [createPane(defaultServiceId, 0)]
}

const initialState: LogViewerState = {
  services: menuData.services,
  panes: buildDefaultPane(menuData.services.map((service) => service.id)),
  activePaneId: "pane-1",
  lines: logLines as LogLine[],
  groups: menuData.groups as HostGroup[],
  hostHistory: menuData.hostHistory as HostHistoryItem[],
  terminal: {
    command: "pnpm dev",
    cwd: ".",
    isRunning: false,
    lastError: null,
  },
}

const logViewerSlice = createSlice({
  name: "logViewer",
  initialState,
  reducers: {
    setActivePane: (state, action: PayloadAction<string>) => {
      state.activePaneId = action.payload
    },
    setPaneService: (state, action: PayloadAction<{ paneId: string; serviceId: string }>) => {
      const pane = state.panes.find((item) => item.id === action.payload.paneId)
      if (!pane) return
      pane.serviceId = action.payload.serviceId
    },
    setPaneFilters: (state, action: PayloadAction<{ paneId: string; filters: LogViewerFilters }>) => {
      const pane = state.panes.find((item) => item.id === action.payload.paneId)
      if (!pane) return
      pane.filters = action.payload.filters
    },
    resetPaneFilters: (state, action: PayloadAction<{ paneId: string }>) => {
      const pane = state.panes.find((item) => item.id === action.payload.paneId)
      if (!pane) return
      pane.filters = { ...defaultFilters }
    },
    appendLogLine: (state, action: PayloadAction<LogLine>) => {
      state.lines.push(action.payload)
    },
    clearLogLines: (state, action: PayloadAction<{ serviceId: string }>) => {
      state.lines = state.lines.filter((line) => line.serviceId !== action.payload.serviceId)
    },
    setPaneStatus: (state, action: PayloadAction<{ paneId: string; status: PaneStatus }>) => {
      const pane = state.panes.find((item) => item.id === action.payload.paneId)
      if (!pane) return
      pane.status = action.payload.status
    },
    setTerminalCommand: (state, action: PayloadAction<string>) => {
      state.terminal.command = action.payload
    },
    setTerminalCwd: (state, action: PayloadAction<string>) => {
      state.terminal.cwd = action.payload
    },
    setTerminalRunning: (state, action: PayloadAction<boolean>) => {
      state.terminal.isRunning = action.payload
    },
    setTerminalError: (state, action: PayloadAction<string | null>) => {
      state.terminal.lastError = action.payload
    },
    addHostToHistory: (state, action: PayloadAction<HostHistoryItem>) => {
      state.hostHistory = [action.payload, ...state.hostHistory.filter((item) => item.id !== action.payload.id)]
    },
    addHostToGroup: (
      state,
      action: PayloadAction<{ groupId: string; host: HostNode }>,
    ) => {
      const group = state.groups.find((item) => item.id === action.payload.groupId)
      if (!group) return
      group.hosts = [...group.hosts, action.payload.host]
    },
  },
})

export const {
  setActivePane,
  setPaneService,
  setPaneFilters,
  resetPaneFilters,
  appendLogLine,
  clearLogLines,
  setPaneStatus,
  setTerminalCommand,
  setTerminalCwd,
  setTerminalRunning,
  setTerminalError,
  addHostToHistory,
  addHostToGroup,
} = logViewerSlice.actions
export default logViewerSlice.reducer
