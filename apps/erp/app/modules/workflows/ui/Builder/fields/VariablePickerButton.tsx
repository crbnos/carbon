import type { ItemRef, ValueType, VariableRef } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";
import { LuVariable } from "react-icons/lu";
import type { FieldContext } from "./types";
import { VariablePicker } from "./VariablePicker";

type Props = {
  accepts: ValueType;
  acceptsAny?: boolean;
  context: FieldContext;
  value: VariableRef | ItemRef | undefined;
  onChange: (next: VariableRef | ItemRef) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The browse affordance for controls you cannot type a `{` into. */
export function VariablePickerButton({
  accepts,
  acceptsAny,
  context,
  value,
  onChange,
  open,
  onOpenChange
}: Props) {
  const { t } = useLingui();
  const title = value ? t`Change variable` : t`Pick a variable`;

  return (
    <VariablePicker
      accepts={accepts}
      acceptsAny={acceptsAny}
      nodeId={context.nodeId}
      inLoop={context.inLoop}
      value={value}
      onChange={onChange}
      open={open}
      onOpenChange={onOpenChange}
    >
      <button
        type="button"
        title={title}
        aria-label={title}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={() => onOpenChange(true)}
      >
        <LuVariable className="h-4 w-4" />
      </button>
    </VariablePicker>
  );
}
