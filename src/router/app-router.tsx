import { Navigate, Route, Routes } from "react-router-dom"
import { LogViewerPage } from "@/features/log-viewer/pages/log-viewer-page"
import { TerminalWorkspacePage } from "@/features/terminal-xterm/pages/terminal-workspace-page"
import { PlainLayout } from "@/layout/plain-layout"
import { SidebarLayout } from "@/layout/sidebar-layout"

function ConnectionsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h2 className="text-xl font-semibold">Connections</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        This screen intentionally uses plain layout (no sidebar) for focused setup flows.
      </p>
    </div>
  )
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/logs/local" replace />} />
      <Route
        path="/logs/local"
        element={
          <SidebarLayout>
            <TerminalWorkspacePage />
          </SidebarLayout>
        }
      />
      <Route
        path="/logviewer"
        element={
          <SidebarLayout>
            <LogViewerPage />
          </SidebarLayout>
        }
      />
      <Route
        path="/connections"
        element={
          <PlainLayout>
            <ConnectionsPage />
          </PlainLayout>
        }
      />
      <Route path="*" element={<Navigate to="/logs/local" replace />} />
    </Routes>
  )
}
