// Compact external-resource chip (Docs / Video / Academy) shared by the hub's
// surfaces. Always opens a new tab — these leave the hub for docs.carbon.ms or
// the Academy.

import type { ReactNode } from "react";
import { LuArrowUpRight } from "react-icons/lu";

export function LearnLink({
  href,
  icon,
  children
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="shrink-0 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
    >
      {icon}
      {children}
      <LuArrowUpRight className="size-3 opacity-60" />
    </a>
  );
}
