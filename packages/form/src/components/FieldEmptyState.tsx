import { cn } from "@carbon/react";
import type { ReactNode } from "react";

export type FieldEmptyStateProps = {
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  className?: string;
};

export const fieldEmptyStateLinkClassName =
  "font-medium text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary";

const FieldEmptyState = ({
  title,
  description,
  icon,
  className
}: FieldEmptyStateProps) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-5 py-7 text-center",
        className
      )}
    >
      {icon && (
        <div className="text-muted-foreground/70 [&_svg]:size-5 [&_svg]:shrink-0">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground text-balance">
          {title}
        </p>
        <p className="mx-auto max-w-[15rem] text-[0.8125rem] leading-5 text-muted-foreground text-pretty">
          {description}
        </p>
      </div>
    </div>
  );
};

FieldEmptyState.displayName = "FieldEmptyState";

export default FieldEmptyState;
