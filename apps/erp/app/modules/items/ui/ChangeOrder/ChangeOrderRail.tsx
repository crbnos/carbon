import type { JSONContent } from "@carbon/react";
import { Badge, Button, HStack, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuCircleCheck } from "react-icons/lu";
import type {
  ChangeOrder,
  ChangeOrderActionTask,
  ChangeOrderImpact,
  ChangeOrderReleaseConflict
} from "~/modules/items";
import type { AffectedItemDraft } from "./affectedItem.types";
import ChangeOrderActions from "./ChangeOrderActions";
import { ChangeOrderContentSection } from "./ChangeOrderContent";
import ChangeOrderProperties from "./ChangeOrderProperties";
import ChangeOrderReleaseMerge from "./ChangeOrderReleaseMerge";
import ImpactPanel from "./ImpactPanel";
import { releaseDialogOpenAtom } from "./releaseDialog.store";

// One CO-centric section — the xxs uppercase heading + content used by the
// PurchaseOrder / SalesOrder / Quote property sidebars. Sections are separated by
// the container's VStack spacing (whitespace), matching those sidebars exactly.
function RailSection({
  title,
  accessory,
  children
}: {
  title: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <VStack spacing={2} className="w-full">
      <HStack className="w-full justify-between">
        <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
          {title}
        </h3>
        {accessory}
      </HStack>
      {children}
    </VStack>
  );
}

// Right pane of the change-order workspace: all CO-centric content (not tied to
// any single affected item), as one consistent sidebar — Release (at
// Implementation), Properties, Reason for change, Description, Actions, and
// (at Implementation/Done) Impact.
export default function ChangeOrderRail({
  id,
  changeOrder,
  affectedItems,
  actions,
  impact,
  releaseConflicts,
  isDisabled,
  showImplementation
}: {
  id: string;
  changeOrder: ChangeOrder;
  affectedItems: AffectedItemDraft[];
  actions: ChangeOrderActionTask[];
  impact: ChangeOrderImpact;
  releaseConflicts: ChangeOrderReleaseConflict[];
  isDisabled: boolean;
  showImplementation: boolean;
}) {
  const isImplementation = changeOrder.status === "Implementation";
  const actionsDone = actions.filter(
    (a) => a.status === "Completed" || a.status === "Skipped"
  ).length;

  // The read-only changes shown in the release confirmation dialog.
  const changes = affectedItems.map((a) => ({
    id: a.affectedItem.id,
    label: a.affectedItem.item?.readableIdWithRevision ?? a.affectedItem.itemId,
    diff: a.diff
  }));

  return (
    <VStack
      spacing={4}
      className="w-96 flex-shrink-0 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      {/* Release is the primary action at Implementation — surfaced first so
          it's never buried below the scroll. The button opens the review +
          confirm dialog (also openable from the header); release is gated on
          confirmation, never one-click. */}
      {isImplementation && (
        <RailSection title={<Trans>Release</Trans>}>
          <VStack spacing={2} className="w-full">
            <Button
              className="w-full"
              leftIcon={<LuCircleCheck />}
              variant="primary"
              isDisabled={isDisabled}
              onClick={() => releaseDialogOpenAtom.set(true)}
            >
              <Trans>Release change order</Trans>
            </Button>
            <span className="text-xs text-muted-foreground">
              <Trans>Review the changes and confirm to activate them.</Trans>
            </span>
          </VStack>
          <ChangeOrderReleaseMerge
            changeOrderId={id}
            status={changeOrder.status}
            conflicts={releaseConflicts}
            changes={changes}
          />
        </RailSection>
      )}

      {/* Properties renders its own "Properties" heading + fields. */}
      <ChangeOrderProperties />

      <RailSection title={<Trans>Reason for change</Trans>}>
        <ChangeOrderContentSection
          key={`${id}-reason`}
          embedded
          id={id}
          title=""
          field="reasonForChange"
          content={changeOrder.reasonForChange as JSONContent}
          isDisabled={isDisabled}
        />
      </RailSection>

      <RailSection title={<Trans>Description</Trans>}>
        <ChangeOrderContentSection
          key={`${id}-description`}
          embedded
          id={id}
          title=""
          field="description"
          content={changeOrder.description as JSONContent}
          isDisabled={isDisabled}
        />
      </RailSection>

      <RailSection
        title={<Trans>Actions</Trans>}
        accessory={
          actions.length > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {actionsDone}/{actions.length}
            </Badge>
          ) : undefined
        }
      >
        <ChangeOrderActions
          variant="summary"
          changeOrderId={id}
          actions={actions}
          isDisabled={isDisabled}
        />
      </RailSection>

      {showImplementation && (
        <RailSection title={<Trans>Impact</Trans>}>
          <ImpactPanel embedded impact={impact} />
        </RailSection>
      )}
    </VStack>
  );
}
