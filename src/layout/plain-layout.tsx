import type { ReactNode } from "react";

interface PlainLayoutProps {
  children: ReactNode;
}

export function PlainLayout({ children }: PlainLayoutProps) {
  return <main className="min-h-screen bg-background">{children}</main>;
}
