import { useState } from "react"

export function useMenuById() {
  const [openId, setOpenId] = useState<string | null>(null)

  const onOpenChange = (id: string, open: boolean) => {
    setOpenId(open ? id : null)
  }

  const openById = (id: string) => setOpenId(id)
  const close = () => setOpenId(null)

  return {
    openId,
    onOpenChange,
    openById,
    close,
  }
}
