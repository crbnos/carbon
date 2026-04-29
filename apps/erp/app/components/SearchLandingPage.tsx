import { cn, Heading } from "@carbon/react";
import type { ComponentType, ReactNode } from "react";

type Props = {
  icon: ComponentType<{ className?: string }>;
  heading: ReactNode;
  description?: ReactNode;
  /** Interactive surface (cmdk Command, picker, form). Rendered inside the
   *  bordered shadow card. Consumer owns internal padding. */
  children: ReactNode;
  /** Optional small caption beneath the card. */
  footerTip?: ReactNode;
  /** Centered column width. Defaults to "md" (max-w-md ≈ 28rem). */
  maxWidth?: "sm" | "md" | "lg";
  className?: string;
};

const MAX_WIDTH = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg"
} as const;

export function SearchLandingPage({
  icon: Icon,
  heading,
  description,
  children,
  footerTip,
  maxWidth = "md",
  className
}: Props) {
  return (
    <div
      className={cn(
        "relative flex w-full h-full flex-1 items-center justify-center bg-card overflow-hidden isolate",
        className
      )}
    >
      <div
        className={cn(
          "relative flex flex-col items-center w-full px-6 gap-6",
          MAX_WIDTH[maxWidth]
        )}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="relative flex items-center justify-center size-14 rounded-2xl bg-background border border-border text-foreground shadow-sm before:absolute before:inset-0 before:rounded-2xl before:bg-linear-to-b before:from-foreground/5 before:to-transparent before:pointer-events-none">
            <Icon className="size-6" />
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <Heading
              size="h1"
              className="tracking-tight text-balance font-semibold"
            >
              {heading}
            </Heading>
            {description && (
              <p className="text-sm text-muted-foreground max-w-[44ch] text-pretty leading-6">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-2 w-full">{children}</div>

        {footerTip && (
          <p className="text-[11px] text-muted-foreground/70 tabular-nums">
            {footerTip}
          </p>
        )}
      </div>
    </div>
  );
}

export default SearchLandingPage;
