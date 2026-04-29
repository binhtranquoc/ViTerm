import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { SSH_HOST_QUERY_KEYS } from "@/features/terminal-xterm/constants/ssh-host.const"
import type {
  ICreateSshHostPayload,
  ISshHost,
  ISshHostSecrets,
  IUpdateSshHostPayload,
} from "@/features/terminal-xterm/interfaces/ssh-host.interfaces"

const isTauriRuntime = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

const invokeTauri = async <T,>(command: string, payload?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, payload)
}

export const useSshHosts = () =>
  useQuery({
    queryKey: SSH_HOST_QUERY_KEYS.all,
    queryFn: async () => {
      if (!isTauriRuntime()) return [] as ISshHost[]
      return invokeTauri<ISshHost[]>("list_ssh_hosts")
    },
  })

export const useSshGroups = () =>
  useQuery({
    queryKey: SSH_HOST_QUERY_KEYS.groups,
    queryFn: async () => {
      if (!isTauriRuntime()) return [] as string[]
      return invokeTauri<string[]>("list_ssh_groups")
    },
  })

export const useCreateSshHost = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ICreateSshHostPayload) => {
      if (!isTauriRuntime()) {
        throw new Error("Please run the app with Tauri to save local hosts.")
      }
      return invokeTauri<ISshHost>("create_ssh_host", { payload })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SSH_HOST_QUERY_KEYS.all })
      queryClient.invalidateQueries({ queryKey: SSH_HOST_QUERY_KEYS.groups })
    },
  })
}

export const useUpdateSshHost = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: IUpdateSshHostPayload }) => {
      if (!isTauriRuntime()) {
        throw new Error("Please run the app with Tauri.")
      }
      return invokeTauri<ISshHost>("update_ssh_host", { id, payload })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SSH_HOST_QUERY_KEYS.all })
      queryClient.invalidateQueries({ queryKey: SSH_HOST_QUERY_KEYS.groups })
    },
  })
}

export const useDeleteSshHost = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      if (!isTauriRuntime()) {
        throw new Error("Please run the app with Tauri.")
      }
      return invokeTauri<void>("delete_ssh_host", { id })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SSH_HOST_QUERY_KEYS.all })
      queryClient.invalidateQueries({ queryKey: SSH_HOST_QUERY_KEYS.groups })
    },
  })
}

export const useSshHostSecretsLookup = () =>
  useMutation({
    mutationFn: async (id: string) => {
      if (!isTauriRuntime()) {
        throw new Error("Please run the app with Tauri.")
      }
      return invokeTauri<ISshHostSecrets>("get_ssh_host_secrets", { id })
    },
  })
