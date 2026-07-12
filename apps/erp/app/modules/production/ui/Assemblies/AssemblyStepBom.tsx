import { Badge, VStack } from "@carbon/react";
import type { AssemblyGraphIndex } from "@carbon/viewer";
import { groupComponentNodeIds } from "@carbon/viewer";
import { useMemo } from "react";
import { Empty } from "~/components";

type AssemblyStepBomProps = {
  componentNodeIds: string[];
  graphIndex: AssemblyGraphIndex | null;
};

/** Components used by the selected step, grouped by identical geometry. */
export default function AssemblyStepBom({
  componentNodeIds,
  graphIndex
}: AssemblyStepBomProps) {
  const groups = useMemo(
    () =>
      graphIndex
        ? groupComponentNodeIds(componentNodeIds, graphIndex).sort((a, b) =>
            a.name.localeCompare(b.name)
          )
        : [],
    [componentNodeIds, graphIndex]
  );

  if (!graphIndex) {
    return (
      <Empty className="border-none">
        <p className="text-sm text-muted-foreground">
          The model graph has not loaded yet
        </p>
      </Empty>
    );
  }

  if (groups.length === 0) {
    return (
      <Empty className="border-none">
        <p className="text-sm text-muted-foreground max-w-[320px] text-center">
          Click components in the viewer to assign them to this step
        </p>
      </Empty>
    );
  }

  return (
    <VStack spacing={2} className="w-full py-2">
      <ul className="w-full divide-y divide-border">
        {groups.map((group) => (
          <li
            key={group.key}
            className="flex w-full items-center gap-2 py-2 text-sm"
          >
            <ComponentColorSwatch color={group.color} />
            <span className="min-w-0 flex-1 truncate" title={group.name}>
              {group.name}
            </span>
            <Badge variant="secondary" className="tabular-nums">
              ×{group.count}
            </Badge>
          </li>
        ))}
      </ul>
    </VStack>
  );
}

export function ComponentColorSwatch({
  color
}: {
  color: [number, number, number, number] | null;
}) {
  return (
    <span
      aria-hidden="true"
      className="h-3 w-3 shrink-0 rounded-sm border border-border bg-muted"
      style={
        color
          ? {
              backgroundColor: `rgba(${Math.round(color[0] * 255)}, ${Math.round(
                color[1] * 255
              )}, ${Math.round(color[2] * 255)}, ${color[3]})`
            }
          : undefined
      }
    />
  );
}
