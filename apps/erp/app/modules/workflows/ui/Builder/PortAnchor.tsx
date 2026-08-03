import { Handle, Position } from "@xyflow/react";
import { HANDLE_CLASS } from "./NodeCard";

// Centres on the row it sits in, so that row must be `relative` and full-bleed
// (`-mx-2.5 px-2.5`) for the handle to land on the card's border.
export function PortAnchor({ id }: { id: string }) {
  return (
    <Handle
      type="source"
      position={Position.Right}
      id={id}
      className={HANDLE_CLASS}
    />
  );
}
