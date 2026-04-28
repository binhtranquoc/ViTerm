import { type ChangeEvent, type Dispatch, type SetStateAction, useState } from "react"
import { Eye, EyeOff } from "lucide-react"

import type { TSshAuthType } from "@/features/terminal-xterm/interfaces/ssh-host.interfaces"
import { Input } from "@/shared/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select"

export interface IHostFormState {
  name: string
  address: string
  port: string
  username: string
  groupParent: string
  tags: string
  authType: TSshAuthType
  password: string
  privateKey: string
  passphrase: string
  logPath: string
}

interface HostFormProps {
  form: IHostFormState
  onChange: Dispatch<SetStateAction<IHostFormState>>
  isEdit?: boolean
  isLoadingSecrets?: boolean
}

export function HostForm({ form, onChange, isEdit = false, isLoadingSecrets = false }: HostFormProps) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isPassphraseVisible, setIsPassphraseVisible] = useState(false)

  const set = (key: keyof IHostFormState) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange((prev) => ({ ...prev, [key]: e.target.value }))

  return (
    <div className="space-y-3 px-4 pb-2">
      <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
        <p className="text-sm font-semibold">Address</p>
        <Input value={form.address} onChange={set("address")} placeholder="IP or Hostname" className="h-9" />
      </div>

      <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
        <p className="text-sm font-semibold">General</p>
        <Input value={form.name} onChange={set("name")} placeholder="Label" className="h-9" />
        <Input value={form.groupParent} onChange={set("groupParent")} placeholder="Parent Group" className="h-9" />
        <Input value={form.tags} onChange={set("tags")} placeholder="Tags" className="h-9" />
      </div>

      <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
        <p className="text-sm font-semibold">Credentials</p>
        <div className="grid grid-cols-2 gap-2">
          <Input value={form.port} onChange={set("port")} placeholder="22" className="h-9" />
          <Input value={form.username} onChange={set("username")} placeholder="root" className="h-9" />
        </div>

        <Select
          value={form.authType}
          onValueChange={(value) => onChange((prev) => ({ ...prev, authType: value as TSshAuthType }))}
        >
          <SelectTrigger className="h-9 w-full rounded-md border bg-background text-sm">
            <SelectValue placeholder="Select authentication method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="password">Password</SelectItem>
            <SelectItem value="private_key">Private key</SelectItem>
          </SelectContent>
        </Select>

        {form.authType === "password" ? (
          <div className="relative">
            <Input
              type={isPasswordVisible ? "text" : "password"}
              value={form.password}
              onChange={set("password")}
              placeholder="Password"
              className="h-9 pr-10"
              disabled={isLoadingSecrets}
            />
            <button
              type="button"
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              onClick={() => setIsPasswordVisible((v) => !v)}
              aria-label={isPasswordVisible ? "Hide password" : "Show password"}
            >
              {isPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        ) : (
          <Input
            value={form.privateKey}
            onChange={set("privateKey")}
            placeholder="Private key"
            className="h-9"
            disabled={isLoadingSecrets}
          />
        )}

        {form.authType === "private_key" ? (
          <div className="relative">
            <Input
              type={isPassphraseVisible ? "text" : "password"}
              value={form.passphrase}
              onChange={set("passphrase")}
              placeholder="Passphrase (if the private key is encrypted)"
              className="h-9 pr-10"
              disabled={isLoadingSecrets}
            />
            <button
              type="button"
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              onClick={() => setIsPassphraseVisible((v) => !v)}
              aria-label={isPassphraseVisible ? "Hide passphrase" : "Show passphrase"}
            >
              {isPassphraseVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        ) : null}

        {isEdit && isLoadingSecrets ? (
          <p className="text-xs text-muted-foreground">Loading saved credentials...</p>
        ) : null}
      </div>
    </div>
  )
}
