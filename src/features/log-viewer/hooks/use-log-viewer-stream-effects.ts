import { useEffect } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import { decodeBase64ToBytes } from "@/shared/lib/base64"
import type {
  ILogBatchPayload,
  ILogPaneState,
  ILogRecord,
  ILogService,
  IPtyOutputPayload,
  IProjectRunCommand,
  ISourceStatusPayload,
} from "@/features/log-viewer/interfaces/log-viewer.interfaces"
import {
  appendLatestRecords,
  buildTextRecordFromPty,
  buildJsonRecordFromPty,
  buildNginxRecordFromPty,
  extractJsonOnly,
  isTauriRuntime,
  MAX_RECORDS_FRONTEND,
} from "@/features/log-viewer/hooks/use-log-viewer-runtime"

interface IUseLogViewerStreamEffectsParams {
  panesRef: MutableRefObject<ILogPaneState[]>
  paneLiveStatesRef: MutableRefObject<Record<string, boolean>>
  servicesByIdRef: MutableRefObject<Record<string, ILogService>>
  paneByTerminalTabIdRef: MutableRefObject<Record<string, ILogPaneState>>
  ptyChunkBufferRef: MutableRefObject<Record<string, string>>
  setRecordsByServiceId: Dispatch<SetStateAction<Record<string, ILogRecord[]>>>
  setPanes: Dispatch<SetStateAction<ILogPaneState[]>>
  setRunCommands: Dispatch<SetStateAction<IProjectRunCommand[]>>
}

export function useLogViewerStreamEffects({
  panesRef,
  paneLiveStatesRef,
  servicesByIdRef,
  paneByTerminalTabIdRef,
  ptyChunkBufferRef,
  setRecordsByServiceId,
  setPanes,
  setRunCommands,
}: IUseLogViewerStreamEffectsParams) {
  const isServiceLive = (serviceId: string) =>
    panesRef.current.some(
      (pane) => pane.serviceId === serviceId && (paneLiveStatesRef.current[pane.id] ?? false),
    )

  useEffect(() => {
    if (!isTauriRuntime()) return

    let unlistenBatch: (() => void) | undefined
    let unlistenStatus: (() => void) | undefined
    let disposed = false

    const attachListeners = async () => {
      const { listen } = await import("@tauri-apps/api/event")
      const batchUnlisten = await listen<ILogBatchPayload>("log:batch", (event) => {
        const payload = event.payload
        const service = servicesByIdRef.current[payload.source_id]
        if (!service) return
        if (!isServiceLive(payload.source_id)) return

        setRecordsByServiceId((previousRecordsByServiceId) => {
          const currentRecords = previousRecordsByServiceId[payload.source_id] ?? []
          const appendedRecords = payload.entries.map((entry) => ({
            id: entry.id,
            serviceId: payload.source_id,
            timestamp: entry.timestamp,
            level: entry.level,
            parserType: entry.parser_type ?? service.parserType,
            sourceType: service.sourceType,
            message: entry.message,
            raw: entry.raw,
            fields: entry.fields ?? {},
          }))
          const nextRecords = appendLatestRecords(currentRecords, appendedRecords, MAX_RECORDS_FRONTEND)
          return {
            ...previousRecordsByServiceId,
            [payload.source_id]: nextRecords,
          }
        })
      })

      const statusUnlisten = await listen<ISourceStatusPayload>("source-status", (event) => {
        const payload = event.payload
        setPanes((previousPanes) =>
          previousPanes.map((pane) =>
            pane.serviceId === payload.source_id ? { ...pane, status: payload.status } : pane,
          ),
        )
        setRunCommands((previousRunCommands) =>
          previousRunCommands.map((runCommandEntry) => {
            if (runCommandEntry.id !== payload.source_id) return runCommandEntry
            if (payload.status === "running") return { ...runCommandEntry, status: "running" }
            if (payload.status === "paused") return { ...runCommandEntry, status: "paused" }
            if (payload.status === "error") return { ...runCommandEntry, status: "error" }
            return { ...runCommandEntry, status: "idle" }
          }),
        )
      })

      if (disposed) {
        batchUnlisten()
        statusUnlisten()
        return
      }

      unlistenBatch = batchUnlisten
      unlistenStatus = statusUnlisten
    }

    void attachListeners()

    return () => {
      disposed = true
      unlistenBatch?.()
      unlistenStatus?.()
    }
  }, [panesRef, paneLiveStatesRef, servicesByIdRef, setPanes, setRecordsByServiceId, setRunCommands])

  useEffect(() => {
    if (!isTauriRuntime()) return

    let unlistenPtyOutput: (() => void) | undefined
    let disposed = false

    const attachListener = async () => {
      const { listen } = await import("@tauri-apps/api/event")
      const unlisten = await listen<IPtyOutputPayload>("pty-output", (event) => {
        const payload = event.payload
        const pane = paneByTerminalTabIdRef.current[payload.tab_id]
        if (!pane) return
        if (!(paneLiveStatesRef.current[pane.id] ?? false)) return

        const service = servicesByIdRef.current[pane.serviceId]
        if (!service) return

        const decodedChunk = new TextDecoder().decode(decodeBase64ToBytes(payload.data))
        const buffered = `${ptyChunkBufferRef.current[payload.tab_id] ?? ""}${decodedChunk}`
        const lines = buffered.split(/\r?\n/)
        const rest = lines.pop() ?? ""
        ptyChunkBufferRef.current[payload.tab_id] = rest

        const records: ILogRecord[] = []
        for (const line of lines) {
          const extracted = extractJsonOnly(line)
          if (extracted) {
            records.push(
              buildJsonRecordFromPty(
                service.id,
                service.sourceType,
                extracted.parsed,
                extracted.cleanedLine,
              ),
            )
            continue
          }

          const nginxRecord = buildNginxRecordFromPty(service.id, service.sourceType, line)
          if (nginxRecord) {
            records.push(nginxRecord)
            continue
          }

          const textRecord = buildTextRecordFromPty(service.id, service.sourceType, line)
          if (textRecord) {
            records.push(textRecord)
          }
        }

        if (records.length === 0) return

        setRecordsByServiceId((previousRecordsByServiceId) => {
          const currentRecords = previousRecordsByServiceId[service.id] ?? []
          const nextRecords = appendLatestRecords(currentRecords, records, MAX_RECORDS_FRONTEND)
          return { ...previousRecordsByServiceId, [service.id]: nextRecords }
        })
      })

      if (disposed) {
        unlisten()
        return
      }
      unlistenPtyOutput = unlisten
    }

    void attachListener()
    return () => {
      disposed = true
      unlistenPtyOutput?.()
    }
  }, [paneByTerminalTabIdRef, paneLiveStatesRef, ptyChunkBufferRef, servicesByIdRef, setRecordsByServiceId])
}
