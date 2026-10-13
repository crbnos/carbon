// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDisclosure,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuPlus, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Table } from "~/components";
import {
  EditableList,
  EditableNumber,
  EditableText
} from "~/components/Editable";
import {
  Hidden,
  Input,
  Number as NumberField,
  Submit
} from "~/components/Form";
import { useLocations } from "~/components/Form/Location";
import { ConfirmDelete } from "~/components/Modals";
import Money from "~/components/Money";
import {
  rowMenuColumn,
  setupGridHeight,
  useCellSave
} from "~/components/Setup";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { leaseLineValidator } from "../../purchasing.models";
import type { Lease, LeaseLine } from "./types";

type AssetRow = {
  id: string;
  description: string;
  serialNumber: string | null;
  locationId: string | null;
  paymentAmount: number;
};

type LeaseAssetsGridProps = {
  lease: Lease;
  lines: LeaseLine[];
};

/** The lease's assets as a spreadsheet: each asset's description, serial
 *  number, location and payment edit in place, one cell at a time, through
 *  the asset's update route. A payment change cuts that asset's payment rows
 *  again. */
const LeaseAssetsGrid = ({ lease, lines }: LeaseAssetsGridProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const save = useCellSave();
  const locations = useLocations();

  const leaseId = lease.id!;
  const currencyCode = lease.currencyCode ?? "";
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const canEdit =
    lease.status === "Draft" && permissions.can("update", "purchasing");
  const canAdd =
    lease.status === "Draft" && permissions.can("create", "purchasing");

  const addAsset = useDisclosure();
  const [deleting, setDeleting] = useState<AssetRow | null>(null);

  const locationName = useMemo(
    () =>
      new Map(locations.map((location) => [location.value, location.label])),
    [locations]
  );

  const rows = useMemo<AssetRow[]>(
    () =>
      lines.map((line) => ({
        id: line.id,
        description: line.description,
        serialNumber: line.serialNumber,
        locationId: line.locationId,
        paymentAmount: Number(line.paymentAmount)
      })),
    [lines]
  );

  const onCellEdit = useCallback(
    (accessorKey: string, value: unknown, row: AssetRow) =>
      save(path.to.leaseLineUpdate(leaseId, row.id), {
        field: accessorKey,
        value:
          value === null ||
          value === undefined ||
          (typeof value === "number" && Number.isNaN(value))
            ? ""
            : String(value)
      }),
    [leaseId, save]
  );

  const columns = useMemo<ColumnDef<AssetRow>[]>(
    () => [
      {
        accessorKey: "description",
        header: t`Asset`,
        cell: ({ row }) => (
          <span className="block max-w-[260px] truncate font-medium">
            {row.original.description}
          </span>
        )
      },
      {
        accessorKey: "serialNumber",
        header: t`Serial Number`,
        cell: ({ row }) =>
          row.original.serialNumber ?? (
            <span className="text-muted-foreground">—</span>
          )
      },
      {
        accessorKey: "locationId",
        header: t`Location`,
        cell: ({ row }) =>
          row.original.locationId ? (
            (locationName.get(row.original.locationId) ??
            row.original.locationId)
          ) : (
            <span className="text-muted-foreground">
              <Trans>The lease's</Trans>
            </span>
          )
      },
      {
        accessorKey: "paymentAmount",
        header: t`Payment`,
        cell: ({ row }) =>
          row.original.paymentAmount > 0 ? (
            <Money
              value={row.original.paymentAmount}
              currencyCode={currencyCode}
            />
          ) : (
            <span className="text-red-500">
              <Trans>No payment</Trans>
            </span>
          )
      }
    ],
    [t, currencyCode, locationName]
  );

  const editableComponents = useMemo(() => {
    // A text cell expects a write that answers with no data.
    const text = async (accessorKey: string, value: string, row: AssetRow) => ({
      ...(await onCellEdit(accessorKey, value, row)),
      data: null
    });
    return {
      description: EditableText<AssetRow>(text),
      serialNumber: EditableText<AssetRow>(text),
      locationId: EditableList<AssetRow>(onCellEdit, locations),
      paymentAmount: EditableNumber<AssetRow>(onCellEdit, {
        minValue: 0,
        step: INPUT_STEP.money(currencyDecimals),
        formatOptions: INPUT_FORMAT.money(currencyCode, currencyDecimals)
      })
    };
  }, [onCellEdit, locations, currencyCode, currencyDecimals]);

  const renderRowMenu = useCallback(
    (row: AssetRow) => (
      <MenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        destructive
        disabled={
          lease.status !== "Draft" || !permissions.can("delete", "purchasing")
        }
        onClick={() => setDeleting(row)}
      >
        <MenuIcon icon={<LuTrash />} />
        <Trans>Remove Asset</Trans>
      </MenuItem>
    ),
    [lease.status, permissions]
  );

  const gridColumns = useMemo(
    () => [...columns, rowMenuColumn(renderRowMenu, t`Actions`)],
    [columns, renderRowMenu, t]
  );

  return (
    <div className="flex w-full flex-col gap-4">
      {rows.length === 0 ? (
        <div className="flex w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            <Trans>
              No assets yet. Add each asset the lease covers, with what it pays
              for it.
            </Trans>
          </p>
          <Button
            leftIcon={<LuPlus />}
            isDisabled={!canAdd}
            onClick={addAsset.onOpen}
          >
            <Trans>Add Asset</Trans>
          </Button>
        </div>
      ) : (
        <>
          <div
            className="w-full overflow-hidden rounded-lg border border-border"
            style={{ height: setupGridHeight(rows.length, 49) }}
          >
            <Table<AssetRow>
              compact
              columns={gridColumns}
              data={rows}
              count={rows.length}
              editableComponents={editableComponents}
              withInlineEditing={canEdit}
              forceEditMode={canEdit}
              withPagination={false}
              withSearch={false}
              withSimpleSorting={false}
              withSidebarTrigger={false}
              withColumnOrdering={false}
              withCsvExport={false}
              sort={null}
            />
          </div>
          <div>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              isDisabled={!canAdd}
              onClick={addAsset.onOpen}
            >
              <Trans>Add Asset</Trans>
            </Button>
          </div>
        </>
      )}

      {addAsset.isOpen && (
        <LeaseAddAssetModal
          leaseId={leaseId}
          currencyCode={currencyCode}
          currencyDecimals={currencyDecimals}
          onClose={addAsset.onClose}
        />
      )}

      {deleting && (
        <ConfirmDelete
          action={path.to.leaseLineDelete(leaseId, deleting.id)}
          name={deleting.description}
          text={t`Are you sure you want to remove ${deleting.description} and its payment rows from this lease?`}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </div>
  );
};

/** One asset and what the lease pays for it; its payment rows are cut from
 *  the lease's terms when it is added. */
const LeaseAddAssetModal = ({
  leaseId,
  currencyCode,
  currencyDecimals,
  onClose
}: {
  leaseId: string;
  currencyCode: string;
  currencyDecimals: number;
  onClose: () => void;
}) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const submitted = useRef(false);

  // The action redirects back with a flash; close once it has settled.
  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      submitted.current = false;
      onClose();
    }
  }, [fetcher.state, onClose]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={leaseLineValidator}
          method="post"
          action={path.to.leaseLinesNew(leaseId)}
          fetcher={fetcher}
          defaultValues={{
            leaseId,
            description: "",
            paymentAmount: 0,
            ownershipTransfers: false,
            specializedAsset: false,
            purchaseOptionReasonablyCertain: false
          }}
          onSubmit={() => {
            submitted.current = true;
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Asset</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Each asset is accounted for on its own. Its payment rows are cut
                from the lease's payment terms.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="leaseId" />
            <VStack spacing={4}>
              <Input
                autoFocus
                name="description"
                label={t`Asset`}
                helperText={t`What is leased, for example Forklift FL-12`}
              />
              <Input name="serialNumber" label={t`Serial Number`} />
              <NumberField
                name="paymentAmount"
                label={t`Payment`}
                helperText={t`What each period's payment is for this asset in the first year`}
                minValue={0}
                step={INPUT_STEP.money(currencyDecimals)}
                formatOptions={INPUT_FORMAT.money(
                  currencyCode,
                  currencyDecimals
                )}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              isDisabled={fetcher.state !== "idle"}
              onClick={onClose}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Add</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default LeaseAssetsGrid;
