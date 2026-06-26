// The "Added for this customer" block, config-driven by the collection registry.
// It reads its own rows + canEdit from the store and wires Add straight to the
// registry's `newPayload`, so a surface just declares a render body for one row:
//
//   <CustomRowSection collection="data">
//     {(row) => <MyRow row={row} />}
//   </CustomRowSection>
//
// Hidden entirely when there are no custom rows and the viewer can't edit.

import { Button } from "@carbon/react";
import { Fragment, type ReactNode } from "react";
import { LuPlus } from "react-icons/lu";
import { COLLECTIONS, type CollectionKey, UI_TEXT } from "../../content";
import type { ImplementationRowData } from "../../types";
import { useCanEdit, useHubActions, useRows } from "../state";
import { Section, SectionList } from "./Section";

export function CustomRowSection({
  collection,
  children
}: {
  collection: CollectionKey;
  children: (row: ImplementationRowData) => ReactNode;
}) {
  const def = COLLECTIONS[collection];
  const canEdit = useCanEdit();
  const rows = useRows(collection);
  const { addRow } = useHubActions();

  if (rows.length === 0 && !canEdit) return null;

  return (
    <Section
      title={UI_TEXT.addedForCustomer}
      aside={
        canEdit ? (
          <span className="text-xxs text-muted-foreground">
            {UI_TEXT.carbonOnly}
          </span>
        ) : null
      }
    >
      {rows.length > 0 ? (
        <SectionList>
          {rows.map((row) => (
            <Fragment key={row.id}>{children(row)}</Fragment>
          ))}
        </SectionList>
      ) : (
        <div className="px-5 py-4 text-sm text-muted-foreground">
          {def.emptyText}
        </div>
      )}
      {canEdit ? (
        <div className="px-5 py-3 border-t">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<LuPlus />}
            onClick={() => addRow(collection, def.newPayload())}
          >
            {def.addLabel}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
