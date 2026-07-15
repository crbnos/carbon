import type { JSONContent } from "@carbon/react";
import { HStack, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import type {
  ChangeOrder,
  ChangeOrderActionTask,
  ChangeOrderReleaseConflict
} from "~/modules/items";
import type { AffectedItemDraft } from "./affectedItem.types";
import ChangeOrderActions from "./ChangeOrderActions";
import { ChangeOrderContentSection } from "./ChangeOrderContent";
import ChangeOrderProperties from "./ChangeOrderProperties";
import ChangeOrderReleaseMerge from "./ChangeOrderReleaseMerge";
import ImpactPanel, { type ChangeOrderImpactItem } from "./ImpactPanel";

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
  impactUsedIn,
  releaseConflicts,
  isDisabled
}: {
  id: string;
  changeOrder: ChangeOrder;
  affectedItems: AffectedItemDraft[];
  actions: ChangeOrderActionTask[];
  impactUsedIn: ChangeOrderImpactItem[];
  releaseConflicts: ChangeOrderReleaseConflict[];
  isDisabled: boolean;
}) {
  const isImplementation = changeOrder.status === "Implementation";

  // The read-only changes shown in the release confirmation dialog.
  const changes = affectedItems.map((a) => ({
    id: a.affectedItem.id,
    label: a.affectedItem.item?.readableIdWithRevision ?? a.affectedItem.itemId,
    diff: a.diff
  }));

  return (
    <VStack
      spacing={4}
      className="w-96 flex-shrink-0 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 pt-2 pb-12 text-sm"
    >
      {/* Release is triggered from the header button (opens this confirmation
          dialog via releaseDialogOpenAtom). The dialog is mounted here — headless
          until opened — so it renders nothing in the rail itself. */}
      {isImplementation && (
        <ChangeOrderReleaseMerge
          changeOrderId={id}
          status={changeOrder.status}
          conflicts={releaseConflicts}
          changes={changes}
        />
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

      {/* Actions — an editable "Required Actions" multiselect matching the
          Quality issue sidebar; it renders its own label, so no RailSection
          heading. Selecting/deselecting a template adds/removes its task. */}
      <ChangeOrderActions
        variant="summary"
        changeOrderId={id}
        actions={actions}
        isDisabled={isDisabled}
      />

      <RailSection title={<Trans>Impact</Trans>}>
        <ImpactPanel embedded items={impactUsedIn} />
      </RailSection>
    </VStack>
  );
}
