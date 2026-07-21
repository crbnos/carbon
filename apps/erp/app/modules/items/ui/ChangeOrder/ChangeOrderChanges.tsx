import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import ChangeOrderDiffViewer from "./ChangeOrderDiffViewer";
import type { ReleaseChange } from "./ChangeOrderReleaseMerge";
import ChangeTypeBadge from "./ChangeTypeBadge";

// The CO-wide changes rollup shown on the top-level overview ($id.details):
// every affected item's read-only authoring diff in one card, mirroring the
// release confirmation dialog's list (label + ChangeOrderDiffViewer per item).
export default function ChangeOrderChanges({
  changes
}: {
  changes: ReleaseChange[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Changes</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={4} className="w-full">
          {changes.length === 0 ? (
            <span className="text-sm italic text-muted-foreground">
              <Trans>No affected items.</Trans>
            </span>
          ) : (
            changes.map((c) => (
              <VStack key={c.id} spacing={2} className="w-full min-w-0">
                <HStack className="w-full justify-between items-start gap-2">
                  <VStack spacing={0} className="min-w-0">
                    <h3
                      className="max-w-full truncate text-sm font-medium text-foreground"
                      title={c.label}
                    >
                      {c.label}
                    </h3>
                    {c.name && (
                      <span className="max-w-full truncate text-xs text-muted-foreground">
                        {c.name}
                      </span>
                    )}
                  </VStack>
                  {/* More real estate here than the explorer/card header, so the
                      badge sits at the far right of the row, horizontally. */}
                  <ChangeTypeBadge
                    changeType={c.changeType}
                    version={c.version}
                    className="shrink-0"
                  />
                </HStack>
                <ChangeOrderDiffViewer diff={c.diff} />
              </VStack>
            ))
          )}
        </VStack>
      </CardContent>
    </Card>
  );
}
