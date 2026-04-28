import { TerminalWorkspace } from "@/features/terminal-xterm/components/terminal-workspace"

export function TerminalWorkspacePage() {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      <TerminalWorkspace />
    </div>
  )
}
