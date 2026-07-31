import { Input } from "@carbon/react";
import { useBuilderStore } from "../context";

type Props = { node: { id: string; type: string; title?: string } };

export function NodeNameField({ node }: Props) {
  const renameNode = useBuilderStore((s) => s.renameNode);
  return (
    <Input
      defaultValue={node.title ?? ""}
      placeholder={node.type}
      onChange={(e) => renameNode(node.id, e.target.value)}
    />
  );
}
