export type TSshAuthType = "password" | "private_key"

export interface ISshHost {
  id: string
  name: string
  host: string
  port: number
  username: string
  group_parent?: string | null
  tags: string[]
  auth_type: TSshAuthType
  log_path?: string | null
  created_at: string
  updated_at: string
}

export interface ICreateSshHostPayload {
  name: string
  host: string
  port: number
  username: string
  group_parent?: string | null
  tags: string[]
  auth_type: TSshAuthType
  log_path?: string | null
  password?: string | null
  private_key?: string | null
  passphrase?: string | null
}

/** Same fields as create; secret fields only sent when the user edited them. */
export interface IUpdateSshHostPayload {
  name: string
  host: string
  port: number
  username: string
  group_parent?: string | null
  tags: string[]
  auth_type: TSshAuthType
  log_path?: string | null
  password?: string | null
  private_key?: string | null
  passphrase?: string | null
}

export interface ISshHostSecrets {
  password?: string | null
  private_key?: string | null
  passphrase?: string | null
}
