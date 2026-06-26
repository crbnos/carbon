// Dashed inline input with save-on-blur, built on @carbon/react's <Input>. Holds
// a local draft so typing is smooth, commits only when the value changed, and
// re-syncs to the server value if it updates underneath (realtime / revalidate)
// — but never while focused, so a concurrent update can't clobber live typing.

import { cn, Input } from "@carbon/react";
import { useEffect, useRef, useState } from "react";

export function EditableInput({
  value,
  placeholder,
  onCommit,
  variant = "primary",
  className
}: {
  value: string;
  placeholder?: string;
  onCommit: (next: string) => void;
  variant?: "primary" | "muted";
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <Input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onCommit(draft);
      }}
      className={cn(
        "border-dashed bg-primary/[0.03] focus:ring-2 focus:ring-primary/20",
        variant === "primary"
          ? "border-primary/40 font-medium"
          : "border-primary/30 text-xs text-muted-foreground",
        className
      )}
    />
  );
}
