import { cn } from "@carbon/react";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

/**
 * Small uppercase label that groups related settings cards into a section.
 * Use it above a run of `<Card>`s on a settings page so related settings read
 * as one group (see the purchasing settings page for the reference layout).
 */
export default function SettingsSectionHeader({ children, className }: Props) {
  return (
    <p
      className={cn(
        "mt-4 text-foreground/70 uppercase font-light tracking-wide font-mono text-xs",
        className
      )}
    >
      {children}
    </p>
  );
}
