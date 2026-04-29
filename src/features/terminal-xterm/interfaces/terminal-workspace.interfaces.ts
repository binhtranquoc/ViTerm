export interface ITerminalTab {
  id: string
  title: string
  kind: "terminal"
  target?: string
  /** When set, the terminal connects via open_ssh_host_terminal instead of open_pty */
  hostId?: string
  startupProgram?: string
  startupArgs?: string[]
  shellLabel?: string
  locationLabel?: string
  cwd?: string
}

export type TTerminalTab = ITerminalTab
