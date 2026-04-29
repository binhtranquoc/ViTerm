import {
  Activity,
  AudioWaveform,
  BookOpen,
  Bot,
  Folder,
  GalleryVerticalEnd,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react"

const iconMap: Record<string, LucideIcon> = {
  activity: Activity,
  audio: AudioWaveform,
  book: BookOpen,
  bot: Bot,
  folder: Folder,
  gallery: GalleryVerticalEnd,
  terminal: SquareTerminal,
}

export const getIconByName = (iconName: string): LucideIcon => iconMap[iconName] ?? SquareTerminal
