import { LogViewerWorkspace } from "@/features/log-viewer/components/log-viewer-workspace"

export function LogViewerPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      <LogViewerWorkspace />
    </div>
  )
}
