import { cn, Input, Textarea } from "@carbon/react";
import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useCanEdit, useHubActions } from "./state";

// A fill-in field: editable by Carbon staff, read-only for the customer. The
// value is the per-company override (fieldValue) or the code default. Saves on
// blur via the hub store — this is how a hub gets tailored per account. canEdit
// and the save path come from the store, so callers pass only the field itself.
export function EditableField({
  fieldKey,
  value,
  defaultValue,
  multiline,
  placeholder,
  className
}: {
  fieldKey: string;
  value: string | undefined; // the override, if any
  defaultValue: string | MessageDescriptor;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const canEdit = useCanEdit();
  const { i18n } = useLingui();
  const { setField } = useHubActions();
  const resolvedDefault =
    defaultValue == null
      ? ""
      : typeof defaultValue === "string"
        ? defaultValue
        : i18n._(defaultValue);
  const resolved = value ?? resolvedDefault;
  const [draft, setDraft] = useState(resolved);
  const focused = useRef(false);

  // Keep in sync when realtime / another editor changes the value — but not
  // while focused, so a concurrent revalidation can't clobber live typing.
  // Depend on the resolved string (not the raw descriptor object, whose identity
  // changes every render) so the effect doesn't re-fire on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on external value change only
  useEffect(() => {
    if (!focused.current) setDraft(resolved);
  }, [value, resolvedDefault]);

  if (!canEdit) {
    return <span className={className}>{resolved || placeholder}</span>;
  }

  const commit = () => {
    focused.current = false;
    if (draft !== resolved) setField(fieldKey, draft);
  };

  const fieldClass = cn(
    "w-full rounded-lg border border-dashed border-primary/40 bg-primary/[0.03] px-2.5 py-1.5 text-sm outline-none transition-colors",
    "hover:border-primary/60 focus:border-primary focus:ring-2 focus:ring-primary/20",
    className
  );

  if (multiline) {
    return (
      <Textarea
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={commit}
        rows={2}
        className={cn(fieldClass, "resize-none leading-relaxed")}
      />
    );
  }

  return (
    <Input
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={fieldClass}
    />
  );
}
