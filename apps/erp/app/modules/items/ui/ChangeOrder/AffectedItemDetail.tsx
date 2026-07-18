import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Status,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import { CadModel, DeferredFiles } from "~/components";
import { DatePicker, Hidden, Select, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import {
  changeOrderAffectedItemChangeTypeValidator,
  changeOrderAffectedItemCutoverValidator,
  changeOrderChangeTypes
} from "../../changeOrder.models";
import type { ChangeOrderAffectedItemWithLabel } from "../../changeOrder.service";
import type { SupersessionMode } from "../../items.models";
import { supersessionModeMeta, supersessionModes } from "../../items.models";
import {
  BillOfMaterial,
  BillOfProcess,
  ItemDocuments,
  SupplierParts
} from "../Item";
import PartProperties from "../Parts/PartProperties";
import type { AffectedItemDraft } from "./affectedItem.types";
import ChangeOrderDiffViewer from "./ChangeOrderDiffViewer";
import ChangeTypeBadge from "./ChangeTypeBadge";
import ItemLink from "./ItemLink";

const supersessionModeOptions = supersessionModes.map((value) => ({
  value,
  label: <Status color={supersessionModeMeta[value].color}>{value}</Status>
}));

const changeTypeOptions = changeOrderChangeTypes.map((c) => ({
  value: c,
  label: c
}));

// The affected-item line detail: everything about the ONE selected affected item,
// unwrapped from a single card into as many standalone cards as the change needs
// (no tabs). Change Type comes first (carrying the item identity + remove), then
// the item attribute cards (Properties, Files + CAD Model for Revision / New
// Part), the method cards (BillOfMaterial / BillOfProcess, which self-card), Part
// Supersession (cutover), and the read-only Changes diff.
export default function AffectedItemDetail({
  changeOrderId,
  affected,
  isDisabled
}: {
  changeOrderId: string;
  affected: AffectedItemDraft;
  isDisabled: boolean;
}) {
  const { t } = useLingui();

  const affectedItem = affected.affectedItem;
  const partData = affected.partData;
  const label = affectedItem.item;
  const changeType = affectedItem.changeType;
  // Change-type availability keys off the SOURCE item: a Version is a method
  // version of the affected part itself, meaningless when that part is purchased.
  const sourceIsManufactured = label?.replenishmentSystem !== "Buy";
  // BoM/BoP visibility keys off the item actually being edited/released — for a
  // New Part that's the new item (whose replenishment the user can flip in the
  // Properties card), for a Version/Revision it's the same/derived item.
  const draftIsManufactured =
    (affected.partData?.partSummary?.replenishmentSystem ??
      label?.replenishmentSystem) !== "Buy";
  // BoM/BoP is now editable for ANY change type on a manufactured draft — Version,
  // Revision, and New Part alike (client ask: allow editing BoM/BoP on revisions).
  const showBomBop = draftIsManufactured;
  const showAttributes = changeType === "Revision" || changeType === "New Part";
  // Supplier-part management for a purchasable draft item (Revision / New Part
  // on a Part) — so a Buy new part doesn't release un-purchasable. The grid's
  // create/edit drawers are child routes of the line detail; data comes from
  // partData.supplierParts (already loaded by the $id loader).
  const showSupplierParts =
    showAttributes &&
    affected.partData !== null &&
    ["Buy", "Buy and Make"].includes(
      affected.partData.partSummary?.replenishmentSystem ?? ""
    );
  const showCutover = changeType !== "Version";
  // A purchased item under a type that would otherwise expose BoM/BoP: explain it.
  // (Revisions of a purchased item are attrs/docs/cutover only — no note needed.)
  const showBuyNote = !draftIsManufactured && changeType !== "Revision";

  return (
    <VStack spacing={4} className="w-full">
      {/* Change Type — the first card, carrying the item identity + remove. */}
      <Card>
        <CardHeader>
          <HStack className="justify-between w-full">
            <CardTitle>
              <ItemLink
                itemId={affectedItem.itemId}
                type={label?.type}
                className="text-base font-medium"
              >
                {label?.readableIdWithRevision ??
                  label?.readableId ??
                  affectedItem.itemId}
              </ItemLink>
            </CardTitle>
            {/* Single combined change-type + draft-version badge (e.g. "Version 2"
                / "Revision 2" / "New"), replacing the old delete icon here.
                Deletion stays available from the explorer row's ⋮ menu. */}
            <ChangeTypeBadge
              changeType={changeType}
              version={affected.makeMethod?.version}
            />
          </HStack>
          {label?.name && (
            <span className="text-xs text-muted-foreground">{label.name}</span>
          )}
        </CardHeader>
        <CardContent>
          <VStack spacing={4}>
            <ChangeTypeControl
              changeOrderId={changeOrderId}
              affected={affectedItem}
              isManufactured={sourceIsManufactured}
              isDisabled={isDisabled}
            />
            {showBuyNote && (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  This is a purchased item — it has no BoM/BoP; only its
                  attributes and documents can change.
                </Trans>
              </p>
            )}
          </VStack>
        </CardContent>
      </Card>

      {/* Properties — item attributes (Revision / New Part only). */}
      {showAttributes && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Properties</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {affected.partData ? (
              <PartProperties
                embedded
                layout="form"
                section="properties"
                data={affected.partData}
                isReadOnly={isDisabled}
              />
            ) : (
              <p className="text-sm text-muted-foreground py-2">
                <Trans>No editable properties for this item.</Trans>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Files + CAD Model — attachments on the draft item (Revision / New Part
          only). Same components as the part detail page: ItemDocuments (which
          self-cards + lists the model row) and the CadModel viewer/uploader. */}
      {showAttributes &&
        (partData ? (
          <>
            <DeferredFiles resolve={partData.files}>
              {(resolvedFiles) => (
                <ItemDocuments
                  files={resolvedFiles}
                  itemId={partData.itemId}
                  modelUpload={partData.partSummary ?? undefined}
                  type="Part"
                  isReadOnly={isDisabled}
                />
              )}
            </DeferredFiles>
            <CadModel
              isReadOnly={isDisabled}
              metadata={{ itemId: partData.itemId }}
              modelPath={partData.partSummary?.modelPath ?? null}
              title={t`CAD Model`}
            />
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Files</Trans>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground py-2">
                <Trans>No files for this item.</Trans>
              </p>
            </CardContent>
          </Card>
        ))}

      {/* Supplier Parts — purchasing setup for a Buy draft item (renders its own
          card + the Outlet hosting the create/edit drawer child routes). */}
      {showSupplierParts && affected.partData && (
        <SupplierParts
          supplierParts={affected.partData.supplierParts}
          isReadOnly={isDisabled}
          deleteSupplierPath={(supplierPartId) =>
            path.to.changeOrderDeleteSupplierPart(
              changeOrderId,
              affectedItem.id,
              supplierPartId
            )
          }
        />
      )}

      {/* Bill of Materials + Bill of Process — each renders its own card. */}
      {showBomBop &&
        (affected.makeMethod ? (
          <>
            <BillOfMaterial
              key={`bom:${affected.makeMethod.id}`}
              makeMethod={affected.makeMethod}
              parentItemId={affected.draftItemId}
              // @ts-expect-error mapped loader shape (mirrors the part route)
              materials={affected.methodMaterials}
              operations={affected.methodOperations}
              configurable={affected.configurable}
              configurationRules={affected.configurationRules}
              parameters={affected.parameters}
              replenishmentSystem={label?.replenishmentSystem ?? undefined}
              revisionStatus={affected.revisionStatus}
              releaseControl={affected.releaseControl ?? undefined}
            />
            <BillOfProcess
              key={`bop:${affected.makeMethod.id}`}
              makeMethod={affected.makeMethod}
              materials={affected.methodMaterials}
              // @ts-expect-error mapped loader shape (mirrors the part route)
              operations={affected.methodOperations}
              configurable={affected.configurable}
              configurationRules={affected.configurationRules}
              parameters={affected.parameters}
              tags={affected.tags}
              revisionStatus={affected.revisionStatus}
              releaseControl={affected.releaseControl ?? undefined}
            />
          </>
        ) : (
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground py-2">
                <Trans>No draft make method for this item yet.</Trans>
              </p>
            </CardContent>
          </Card>
        ))}

      {/* Part Supersession — cutover config (non-Version). */}
      {showCutover && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Part Supersession</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CutoverControl
              changeOrderId={changeOrderId}
              affected={affectedItem}
              isDisabled={isDisabled}
            />
          </CardContent>
        </Card>
      )}

      {/* Changes — the read-only end-state diff. */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Changes</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChangeOrderDiffViewer bare diff={affected.diff} />
        </CardContent>
      </Card>
    </VStack>
  );
}

// Per-affected-item change-type selector. Switching rebuilds the CO-owned Draft
// for the new type (edits reset — Q2). Explicit Apply avoids accidental resets.
function ChangeTypeControl({
  changeOrderId,
  affected,
  isManufactured,
  isDisabled
}: {
  changeOrderId: string;
  affected: ChangeOrderAffectedItemWithLabel;
  isManufactured: boolean;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();
  // Track the picked value so the Apply button (and its "resets edits" warning)
  // only appear once the user selects a type different from the saved one.
  const [selected, setSelected] = useState<string>(affected.changeType);
  const hasChanged = selected !== affected.changeType;
  // Version = a manufacturing-method change, meaningless for a Buy item — don't
  // offer it there (Buy items default to Revision on add).
  const options = isManufactured
    ? changeTypeOptions
    : changeTypeOptions.filter((o) => o.value !== "Version");

  return (
    <ValidatedForm
      fetcher={fetcher}
      method="post"
      action={path.to.changeOrderAffectedChangeType(changeOrderId, affected.id)}
      validator={changeOrderAffectedItemChangeTypeValidator}
      defaultValues={{ id: affected.id, changeType: affected.changeType }}
      className="w-full"
    >
      <Hidden name="id" value={affected.id} />
      <HStack className="w-full items-end gap-2">
        <div className="w-52">
          <Select
            name="changeType"
            label={t`Change type`}
            termId="change-order-change-type"
            options={options}
            isReadOnly={isDisabled}
            onChange={(option) =>
              setSelected(option?.value ?? affected.changeType)
            }
          />
        </div>
        {!isDisabled && hasChanged && (
          <>
            <Submit withBlocker={false} isDisabled={fetcher.state !== "idle"}>
              <Trans>Apply</Trans>
            </Submit>
            <span className="text-xs text-muted-foreground pb-2">
              <Trans>Changing type resets this item's draft edits.</Trans>
            </span>
          </>
        )}
      </HStack>
    </ValidatedForm>
  );
}

function CutoverControl({
  changeOrderId,
  affected,
  isDisabled
}: {
  changeOrderId: string;
  affected: ChangeOrderAffectedItemWithLabel;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();
  // Drives the mode-description helper text, reusing the canonical supersession
  // presentation so the CO cutover matches the item supersession form exactly.
  const [mode, setMode] = useState<SupersessionMode | "">(
    (affected.supersessionMode as SupersessionMode | null) ?? ""
  );

  return (
    <ValidatedForm
      fetcher={fetcher}
      method="post"
      action={path.to.changeOrderAffectedCutover(changeOrderId, affected.id)}
      validator={changeOrderAffectedItemCutoverValidator}
      defaultValues={{
        id: affected.id,
        supersessionMode: affected.supersessionMode,
        discontinuationDate: affected.discontinuationDate ?? "",
        successorEffectivityDate: affected.successorEffectivityDate ?? ""
      }}
      className="w-full"
    >
      <Hidden name="id" value={affected.id} />
      <VStack spacing={2}>
        <HStack className="w-full items-start gap-2 flex-wrap">
          <div className="w-52">
            <Select
              name="supersessionMode"
              label={t`Supersession Mode`}
              termId="supersession-mode"
              options={supersessionModeOptions}
              isReadOnly={isDisabled}
              helperText={
                mode ? supersessionModeMeta[mode].description : undefined
              }
              onChange={(option) =>
                setMode((option?.value as SupersessionMode) ?? "")
              }
            />
          </div>
          <div className="w-44">
            <DatePicker
              name="discontinuationDate"
              label={t`Discontinuation date`}
              helperText={t`Stop raising purchase orders after this date`}
              isDisabled={isDisabled}
            />
          </div>
          <div className="w-44">
            <DatePicker
              name="successorEffectivityDate"
              label={t`Successor effectivity`}
              helperText={t`When MRP uses the successor for new demand`}
              isDisabled={isDisabled}
            />
          </div>
          {!isDisabled && (
            // Fields align-start; nudge the label-less Save down so it lines up
            // with the inputs rather than the labels.
            <div className="pt-8">
              <Submit withBlocker={false} isDisabled={fetcher.state !== "idle"}>
                <Trans>Save</Trans>
              </Submit>
            </div>
          )}
        </HStack>
      </VStack>
    </ValidatedForm>
  );
}
