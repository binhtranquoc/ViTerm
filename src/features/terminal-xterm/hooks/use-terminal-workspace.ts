import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { TERMINAL_WORKSPACE_HOME_TAB } from "@/features/terminal-xterm/constants/terminal-workspace.const"
import { DEFAULT_STARTUP_ARGS } from "@/features/terminal-xterm/constants/terminal-input.const"
import {
  useCreateSshHost,
  useDeleteSshHost,
  useSshGroups,
  useSshHostSecretsLookup,
  useSshHosts,
  useUpdateSshHost,
} from "@/features/terminal-xterm/hooks/use-ssh-hosts"
import { invokeTauri, isTauriRuntime } from "@/features/terminal-xterm/hooks/use-terminal-pty"
import type { ISshHost, TSshAuthType } from "@/features/terminal-xterm/interfaces/ssh-host.interfaces"
import type { TTerminalTab } from "@/features/terminal-xterm/interfaces/terminal-workspace.interfaces"

import type { IHostFormState } from "@/features/terminal-xterm/components/host-form"

function emptyHostForm() {
  return {
    name: "",
    address: "",
    port: "",
    username: "",
    groupParent: "",
    tags: "",
    authType: "password" as TSshAuthType,
    password: "",
    privateKey: "",
    passphrase: "",
    logPath: "",
  } satisfies IHostFormState
}

export function useTerminalWorkspace() {
  const navigate = useNavigate()
  const location = useLocation()
  const sshHostsQuery = useSshHosts()
  const sshGroupsQuery = useSshGroups()
  const createSshHostMutation = useCreateSshHost()
  const updateSshHostMutation = useUpdateSshHost()
  const deleteSshHostMutation = useDeleteSshHost()
  const sshHostSecretsLookup = useSshHostSecretsLookup()
  const sshHosts = sshHostsQuery.data ?? []
  const sshGroups = sshGroupsQuery.data ?? []

  const [terminalTabs, setTerminalTabs] = useState<TTerminalTab[]>([])
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<string>(TERMINAL_WORKSPACE_HOME_TAB)

  const [isNewHostOpen, setIsNewHostOpen] = useState(false)
  const [newHost, setNewHost] = useState(emptyHostForm)

  const [editingHost, setEditingHost] = useState<ISshHost | null>(null)
  const [editHost, setEditHost] = useState(emptyHostForm)
  const [isLoadingSecrets, setIsLoadingSecrets] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<ISshHost | null>(null)

  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false)
  const [quickQuery, setQuickQuery] = useState("")

  const [searchKeyword, setSearchKeyword] = useState("")
  const [selectedGroup, setSelectedGroup] = useState<string>("all")
  const [reconnectNonceByTabId, setReconnectNonceByTabId] = useState<Record<string, number>>({})
  const [pendingReconnect, setPendingReconnect] = useState<{ hostId: string; tabId: string } | null>(null)

  const isHomeTabActive = activeWorkspaceTab === TERMINAL_WORKSPACE_HOME_TAB

  const consumePendingLocalTerminal = () => {
    const fromLocation = (location.state as { openLocalTerminal?: { cwd?: string; title?: string } } | null)
      ?.openLocalTerminal
    if (fromLocation) return fromLocation

    if (typeof window === "undefined") return null
    const raw = window.sessionStorage.getItem("pending-open-local-terminal")
    if (!raw) return null
    try {
      return JSON.parse(raw) as { cwd?: string; title?: string }
    } catch {
      return null
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    window.dispatchEvent(
      new CustomEvent("terminal-workspace-sidebar-visibility", {
        detail: { visible: isHomeTabActive },
      }),
    )
  }, [isHomeTabActive])

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return
      window.dispatchEvent(
        new CustomEvent("terminal-workspace-sidebar-visibility", {
          detail: { visible: true },
        }),
      )
    }
  }, [])

  useEffect(() => {
    if (selectedGroup === "all") return
    if (!sshGroups.includes(selectedGroup)) {
      setSelectedGroup("all")
    }
  }, [selectedGroup, sshGroups])

  const filteredHosts = useMemo(() => {
    const hostsByGroup =
      selectedGroup === "all"
        ? sshHosts
        : sshHosts.filter((host) => (host.group_parent ?? "ungrouped") === selectedGroup)
    if (!searchKeyword.trim()) return hostsByGroup
    const kw = searchKeyword.toLowerCase()
    return hostsByGroup.filter(
      (h) =>
        h.name.toLowerCase().includes(kw) ||
        h.host.toLowerCase().includes(kw) ||
        h.username.toLowerCase().includes(kw),
    )
  }, [searchKeyword, selectedGroup, sshHosts])

  const quickActions = useMemo(() => {
    const q = quickQuery.trim().toLowerCase()
    return sshHosts
      .filter((h) => !q || h.name.toLowerCase().includes(q) || h.host.toLowerCase().includes(q))
      .slice(0, 6)
  }, [sshHosts, quickQuery])

  useEffect(() => {
    const openLocalTerminal = consumePendingLocalTerminal()
    if (!openLocalTerminal) return

    openTerminalTab({
      cwd: openLocalTerminal.cwd,
      title: openLocalTerminal.title,
    })

    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("pending-open-local-terminal")
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  const openTerminalTab = (options?: { cwd?: string; title?: string }) => {
    const tabId = `terminal-tab-${Date.now()}`
    const normalizedCwd = options?.cwd?.trim() || "~"
    const normalizedTitle = options?.title?.trim()
    setTerminalTabs((prev) => [
      ...prev,
      {
        id: tabId,
        title: normalizedTitle || `Terminal ${prev.length + 1}`,
        kind: "terminal",
        shellLabel: "zsh",
        locationLabel: `local • ${normalizedCwd}`,
        startupArgs: DEFAULT_STARTUP_ARGS,
        cwd: normalizedCwd,
      },
    ])
    setActiveWorkspaceTab(tabId)
  }

  const openSshTerminalTab = (host: ISshHost) => {
    const tabId = `ssh-tab-${Date.now()}`
    setTerminalTabs((prev) => [
      ...prev,
      {
        id: tabId,
        title: host.name,
        kind: "terminal",
        hostId: host.id,
        shellLabel: "ssh",
        locationLabel: `${host.username}@${host.host}:${host.port}`,
      },
    ])
    setActiveWorkspaceTab(tabId)
  }

  const closeTerminalTab = (tabId: string) => {
    setTerminalTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId)
      if (activeWorkspaceTab === tabId) {
        setActiveWorkspaceTab(next[next.length - 1]?.id ?? TERMINAL_WORKSPACE_HOME_TAB)
      }
      return next
    })
  }

  const duplicateTerminalTab = (tabId: string) => {
    const sourceTab = terminalTabs.find((tab) => tab.id === tabId)
    if (!sourceTab) return

    const duplicatedTab: TTerminalTab = {
      ...sourceTab,
      id: `${sourceTab.id}-copy-${Date.now()}`,
      title: `${sourceTab.title} Copy`,
    }
    setTerminalTabs((prev) => [...prev, duplicatedTab])
    setActiveWorkspaceTab(duplicatedTab.id)
  }

  const duplicateHost = async (host: ISshHost) => {
    try {
      const secrets = await sshHostSecretsLookup.mutateAsync(host.id)
      createSshHostMutation.mutate(
        {
          name: `${host.name} Copy`,
          host: host.host,
          port: host.port,
          username: host.username,
          group_parent: host.group_parent ?? null,
          tags: host.tags,
          auth_type: host.auth_type,
          log_path: host.log_path ?? null,
          password: secrets.password ?? null,
          private_key: secrets.private_key ?? null,
          passphrase: secrets.passphrase ?? null,
        },
        {
          onSuccess: (createdHost) => {
            toast.success(`Host "${createdHost.name}" duplicated successfully`)
          },
          onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Unable to duplicate host.")
          },
        },
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to read host data for duplication.")
    }
  }

  const shellQuote = (value: string) => `'${value.replace(/'/g, `'\"'\"'`)}'`

  const copyTextToClipboard = async (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        return
      } catch {
        // fallback below
      }
    }

    if (typeof document === "undefined") {
      throw new Error("Clipboard API is unavailable.")
    }

    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "-9999px"
    textarea.style.left = "-9999px"
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    const copied = document.execCommand("copy")
    document.body.removeChild(textarea)

    if (copied) return

    if (isTauriRuntime()) {
      await invokeTauri("write_clipboard_text", { text })
      return
    }

    throw new Error("Clipboard permission denied.")
  }

  const copySshCommand = async (host: ISshHost) => {
    const baseCommand = `ssh ${host.username}@${host.host} -p ${host.port}`

    try {
      await copyTextToClipboard(baseCommand)
      toast.success(`Copied SSH command for "${host.name}"`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to copy SSH command.")
    }
  }

  const copySshPassCommand = async (host: ISshHost) => {
    const baseCommand = `ssh ${host.username}@${host.host} -p ${host.port}`

    try {
      let commandToCopy = baseCommand
      if (host.auth_type === "password") {
        const secrets = await sshHostSecretsLookup.mutateAsync(host.id)
        const password = (secrets.password ?? "").trim()
        if (password) {
          commandToCopy = `sshpass -p ${shellQuote(password)} ${baseCommand}`
        }
      }

      await copyTextToClipboard(commandToCopy)
      toast.success(`Copied SSHPass command for "${host.name}"`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to copy SSHPass command.")
    }
  }

  const handleAddHost = () => {
    const effectiveUsername = (newHost.username.trim() || "root").trim()
    const effectivePort = newHost.port.trim() || "22"
    if (!newHost.name.trim() || !newHost.address.trim()) return
    const port = Number(effectivePort)
    if (!Number.isFinite(port) || port <= 0 || port > 65535) return

    createSshHostMutation.mutate(
      {
        name: newHost.name.trim(),
        host: newHost.address.trim(),
        port,
        username: effectiveUsername,
        group_parent: newHost.groupParent.trim() || null,
        tags: newHost.tags.split(",").map((t) => t.trim()).filter(Boolean),
        auth_type: newHost.authType,
        log_path: newHost.logPath.trim() || null,
        password: newHost.authType === "password" && newHost.password.trim() ? newHost.password : null,
        private_key: newHost.authType === "private_key" && newHost.privateKey.trim() ? newHost.privateKey : null,
        passphrase: newHost.passphrase.trim() || null,
      },
      {
        onSuccess: (host) => {
          setNewHost(emptyHostForm())
          setIsNewHostOpen(false)
          toast.success(`Host "${host.name}" added successfully`)
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Unable to save host.")
        },
      },
    )
  }

  const openEditSheet = async (host: ISshHost) => {
    setEditingHost(host)
    setIsLoadingSecrets(true)
    setEditHost({
      name: host.name,
      address: host.host,
      port: String(host.port),
      username: host.username,
      groupParent: host.group_parent ?? "",
      tags: host.tags.join(", "),
      authType: host.auth_type as TSshAuthType,
      password: "",
      privateKey: "",
      passphrase: "",
      logPath: host.log_path ?? "",
    })

    try {
      const secrets = await sshHostSecretsLookup.mutateAsync(host.id)
      setEditHost((prev) => ({
        ...prev,
        password: secrets.password ?? "",
        privateKey: secrets.private_key ?? "",
        passphrase: secrets.passphrase ?? "",
      }))
    } catch {
      toast.error("Unable to load saved credentials.")
    } finally {
      setIsLoadingSecrets(false)
    }
  }

  const requestEditHostById = (hostId: string, tabId?: string) => {
    const host = sshHosts.find((item) => item.id === hostId)
    if (!host) return
    if (tabId) {
      setPendingReconnect({ hostId, tabId })
    }
    void openEditSheet(host)
  }

  const handleUpdateHost = () => {
    if (!editingHost) return
    const effectiveUsername = (editHost.username.trim() || "root").trim()
    const effectivePort = editHost.port.trim() || "22"
    if (!editHost.name.trim() || !editHost.address.trim()) return
    const port = Number(effectivePort)
    if (!Number.isFinite(port) || port <= 0 || port > 65535) return

    updateSshHostMutation.mutate(
      {
        id: editingHost.id,
        payload: {
          name: editHost.name.trim(),
          host: editHost.address.trim(),
          port,
          username: effectiveUsername,
          group_parent: editHost.groupParent.trim() || null,
          tags: editHost.tags.split(",").map((t) => t.trim()).filter(Boolean),
          auth_type: editHost.authType,
          log_path: editHost.logPath.trim() || null,
          password: editHost.authType === "password" && editHost.password.trim() ? editHost.password : null,
          private_key: editHost.authType === "private_key" && editHost.privateKey.trim() ? editHost.privateKey : null,
          passphrase: editHost.passphrase.trim() || null,
        },
      },
      {
        onSuccess: (host) => {
          if (pendingReconnect && pendingReconnect.hostId === editingHost.id) {
            setReconnectNonceByTabId((prev) => ({
              ...prev,
              [pendingReconnect.tabId]: (prev[pendingReconnect.tabId] ?? 0) + 1,
            }))
            setActiveWorkspaceTab(pendingReconnect.tabId)
            setPendingReconnect(null)
          }
          setEditingHost(null)
          setEditHost(emptyHostForm())
          toast.success(`Host "${host.name}" updated successfully`)
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : "Unable to update host.")
        },
      },
    )
  }

  const closeEditHostSheet = () => {
    setEditingHost(null)
    setIsLoadingSecrets(false)
    setPendingReconnect(null)
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    const name = deleteTarget.name
    deleteSshHostMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success(`Host "${name}" deleted successfully`)
        setDeleteTarget(null)
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "Unable to delete host.")
        setDeleteTarget(null)
      },
    })
  }

  return {
    // queries/data
    sshHosts,
    sshGroups,
    filteredHosts,
    quickActions,
    // tab state
    terminalTabs,
    reconnectNonceByTabId,
    activeWorkspaceTab,
    isHomeTabActive,
    setActiveWorkspaceTab,
    openTerminalTab,
    openSshTerminalTab,
    closeTerminalTab,
    duplicateTerminalTab,
    goHome: () => setActiveWorkspaceTab(TERMINAL_WORKSPACE_HOME_TAB),
    // quick add
    isQuickAddOpen,
    setIsQuickAddOpen,
    quickQuery,
    setQuickQuery,
    // home filtering
    searchKeyword,
    setSearchKeyword,
    selectedGroup,
    setSelectedGroup,
    // host forms/dialog state
    isNewHostOpen,
    setIsNewHostOpen,
    newHost,
    setNewHost,
    editingHost,
    setEditingHost,
    editHost,
    setEditHost,
    isLoadingSecrets,
    deleteTarget,
    setDeleteTarget,
    // handlers
    handleAddHost,
    openEditSheet,
    closeEditHostSheet,
    handleUpdateHost,
    duplicateHost,
    copySshCommand,
    copySshPassCommand,
    requestEditHostById,
    confirmDelete,
    // mutation states
    createSshHostPending: createSshHostMutation.isPending,
    updateSshHostPending: updateSshHostMutation.isPending,
  }
}
