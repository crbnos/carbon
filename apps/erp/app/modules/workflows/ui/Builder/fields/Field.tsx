import type { TermId } from "@carbon/glossary";
import { cn, LabelWithHelp } from "@carbon/react";
import type { ReactNode } from "react";

type FieldProps = {
  label: string;
  required?: boolean;
  /** Glossary term for the ⓘ hover. Absent => no icon, same layout. */
  helpTermId?: TermId;
  /** Message from a validation issue whose `field` path resolves here. */
  issue?: string;
  /** Advisory text shown only when there is no issue to report. */
  hint?: string;
  children: ReactNode;
};

/** The label / required marker / message shell every value control sits in. */
export function Field({
  label,
  required,
  helpTermId,
  issue,
  hint,
  children
}: FieldProps) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      {/* Still rendered when hidden: an `aria-label` on a plain div is ignored. */}
      <label className={cn("text-sm font-medium text-foreground")}>
        <LabelWithHelp termId={helpTermId}>
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </LabelWithHelp>
      </label>
      {/* No ring here: the control draws its own destructive border, and the two
          together read as a thick red slab. */}
      <div className="flex items-center gap-1">{children}</div>
      {issue ? (
        <p className="text-xs text-destructive">{issue}</p>
      ) : (
        hint && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{hint}</p>
        )
      )}
    </div>
  );
}
