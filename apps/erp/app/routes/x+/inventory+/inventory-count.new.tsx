import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import {
  deleteInventoryCount,
  generateInventoryCountLines,
  InventoryCountForm,
  insertInventoryCount,
  inventoryCountValidator
} from "~/modules/inventory";
import { getNextSequence } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "inventory" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(inventoryCountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { locationId, isBlind, notes, storageUnitIds, itemType } =
    validation.data;

  const sequence = await getNextSequence(client, "inventoryCount", companyId);
  if (sequence.error || !sequence.data) {
    return data(
      {},
      await flash(
        request,
        error(sequence.error, "Failed to generate inventory count id")
      )
    );
  }

  // Persisted for a future "regenerate from current stock while Draft" action:
  // it records the filter this count was generated with so the snapshot can be
  // rebuilt with the same scope. Written now, not yet read back.
  const scope = {
    ...(storageUnitIds && storageUnitIds.length > 0 ? { storageUnitIds } : {}),
    ...(itemType ? { itemFilter: { type: itemType } } : {})
  };

  const created = await insertInventoryCount(client, {
    inventoryCountId: sequence.data as string,
    locationId,
    isBlind,
    notes: notes ?? null,
    scope: scope as Json,
    companyId,
    createdBy: userId
  });

  if (created.error || !created.data) {
    return data(
      {},
      await flash(
        request,
        error(created.error, "Failed to create inventory count")
      )
    );
  }

  // Snapshot current on-hand into count lines (multi-row, transactional). The
  // header insert above and this snapshot aren't a single transaction, so if
  // line generation fails, delete the just-created header rather than leaving an
  // orphan empty Draft count behind.
  try {
    await generateInventoryCountLines(getDatabaseClient(), {
      inventoryCountId: created.data.id,
      companyId,
      locationId,
      createdBy: userId,
      storageUnitIds,
      itemType
    });
  } catch (err) {
    await deleteInventoryCount(client, created.data.id, companyId);
    return data(
      {},
      await flash(request, error(err, "Failed to generate count lines"))
    );
  }

  throw redirect(
    path.to.inventoryCount(created.data.id),
    await flash(request, success("Inventory count created"))
  );
}

export default function NewInventoryCountRoute() {
  const navigate = useNavigate();

  return (
    <InventoryCountForm
      initialValues={{ locationId: "", isBlind: false }}
      onClose={() => navigate(-1)}
    />
  );
}
