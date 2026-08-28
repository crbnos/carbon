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
 *
 * Styled to match the section headings on the financial reporting page. The
 * settings pages wrap their content in a `VStack spacing={4}` with an extra
 * `gap-4`, which stacks ~2rem between every child; the negative bottom margin
 * trims the heading a bit closer to the card that follows (~1.5rem) so it reads
 * as part of its section without hugging it too tightly.
 */
export default function SettingsSectionHeader({ children, className }: Props) {
  return (
    <p
      className={cn(
        "-mb-2 text-muted-foreground uppercase font-medium tracking-wide text-xs",
        className
      )}
    >
      {children}
    </p>
  );
}
