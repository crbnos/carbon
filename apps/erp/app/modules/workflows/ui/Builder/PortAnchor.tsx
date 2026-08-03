import { Handle, Position } from "@xyflow/react";
import { HANDLE_CLASS } from "./NodeCard";

// Centres on the row it sits in, so that row must be `relative` and full-bleed
// (`-mx-2.5 px-2.5`) for the handle to land on the card's border.
export function PortAnchor({ id, label }: { id: string; label?: string }) {
  return (
    <Handle
      type="source"
      position={Position.Right}
      id={id}
      title={label}
      aria-label={label}
      className={HANDLE_CLASS}
    />
  );
}
