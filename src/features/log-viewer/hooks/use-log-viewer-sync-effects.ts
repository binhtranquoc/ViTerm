import { useEffect, useRef } from "react"
import type { Dispatch, SetStateAction } from "react"
import type {
  ILogPaneFilters,
  ILogPaneState,
  ILogRecord,
  ILogService,
  ILogViewerWorkspaceCache,
} from "@/features/log-viewer/interfaces/log-viewer.interfaces"

interface IUseLogViewerSyncEffectsParams {
  cache: ILogViewerWorkspaceCache
  services: ILogService[]
  panes: ILogPaneState[]
  activePaneId: string
  runCommands: ILogViewerWorkspaceCache["runCommands"]
  logSources: ILogViewerWorkspaceCache["logSources"]
  projectSetup: ILogViewerWorkspaceCache["projectSetup"]
  addPaneDraft: ILogViewerWorkspaceCache["addPaneDraft"]
  paneFilterDrafts: Record<string, ILogPaneFilters>
  paneLiveStates: Record<string, boolean>
  recordsByServiceId: Record<string, ILogRecord[]>
  servicesById: Record<string, ILogService>
  paneByTerminalTabId: Record<string, ILogPaneState>
  setPaneLiveStates: Dispatch<SetStateAction<Record<string, boolean>>>
}

export function useLogViewerSyncEffects({
  cache,
  services,
  panes,
  activePaneId,
  runCommands,
  logSources,
  projectSetup,
  addPaneDraft,
  paneFilterDrafts,
  paneLiveStates,
  recordsByServiceId,
  servicesById,
  paneByTerminalTabId,
  setPaneLiveStates,
}: IUseLogViewerSyncEffectsParams) {
  const panesRef = useRef<ILogPaneState[]>([])
  const paneLiveStatesRef = useRef<Record<string, boolean>>({})
  const servicesByIdRef = useRef(servicesById)
  const paneByTerminalTabIdRef = useRef(paneByTerminalTabId)
  const previousActivePaneIdRef = useRef<string>("")

  useEffect(() => {
    cache.services = services
  }, [cache, services])

  useEffect(() => {
    cache.panes = panes
  }, [cache, panes])

  useEffect(() => {
    cache.activePaneId = activePaneId
  }, [activePaneId, cache])

  useEffect(() => {
    cache.runCommands = runCommands
  }, [cache, runCommands])

  useEffect(() => {
    cache.logSources = logSources
  }, [cache, logSources])

  useEffect(() => {
    cache.projectSetup = projectSetup
  }, [cache, projectSetup])

  useEffect(() => {
    cache.addPaneDraft = addPaneDraft
  }, [addPaneDraft, cache])

  useEffect(() => {
    cache.paneFilterDrafts = paneFilterDrafts
  }, [cache, paneFilterDrafts])

  useEffect(() => {
    cache.paneLiveStates = paneLiveStates
  }, [cache, paneLiveStates])

  useEffect(() => {
    cache.recordsByServiceId = recordsByServiceId
  }, [cache, recordsByServiceId])

  useEffect(() => {
    panesRef.current = panes
  }, [panes])

  useEffect(() => {
    paneLiveStatesRef.current = paneLiveStates
  }, [paneLiveStates])

  useEffect(() => {
    servicesByIdRef.current = servicesById
  }, [servicesById])

  useEffect(() => {
    paneByTerminalTabIdRef.current = paneByTerminalTabId
  }, [paneByTerminalTabId])

  useEffect(() => {
    if (!activePaneId) return
    setPaneLiveStates((previousPaneLiveStates) => {
      const nextPaneLiveStates = { ...previousPaneLiveStates }
      const previousPaneId = previousActivePaneIdRef.current
      if (previousPaneId && previousPaneId !== activePaneId) {
        nextPaneLiveStates[previousPaneId] = false
      }
      if (nextPaneLiveStates[activePaneId] === undefined) {
        nextPaneLiveStates[activePaneId] = true
      }
      return nextPaneLiveStates
    })
    previousActivePaneIdRef.current = activePaneId
  }, [activePaneId, setPaneLiveStates])

  return {
    panesRef,
    paneLiveStatesRef,
    servicesByIdRef,
    paneByTerminalTabIdRef,
  }
}
