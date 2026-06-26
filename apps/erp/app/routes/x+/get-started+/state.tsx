import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { stateActionValidator } from "@carbon/onboarding";
import {
  deleteImplementationRow,
  insertImplementationRow,
  updateImplementationHub,
  updateImplementationRow,
  upsertCheckState,
  upsertFieldValue
} from "@carbon/onboarding/server";
import { isInternalEmail } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Single action endpoint for every hub state mutation. Toggles + customer/shared
// fields + custom rows + finishing (setStatus) are open to any company employee;
// structural edits (tier/exclusions/contacts) require an internal Carbon user.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    {}
  );

  const validation = await validator(stateActionValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const a = validation.data;
  const isInternal = isInternalEmail(email);

  const fail = async (e: unknown) =>
    data(
      { success: false },
      await flash(request, error(e, "Failed to update"))
    );

  switch (a.intent) {
    case "setCheck": {
      const result = await upsertCheckState(client, {
        companyId,
        itemKey: a.itemKey,
        kind: a.kind,
        value: a.value,
        userId
      });
      if (result.error) return fail(result.error);
      break;
    }
    case "setField": {
      // All fill-in fields are currently Carbon-owned. When customer-owned
      // fields are added, gate per the field's ownership instead of isInternal.
      if (!isInternal) {
        return data(
          { success: false },
          await flash(
            request,
            error(
              new Error("forbidden"),
              "Only Carbon staff can edit this field"
            )
          )
        );
      }
      const result = await upsertFieldValue(client, {
        companyId,
        fieldKey: a.fieldKey,
        value: a.value,
        userId
      });
      if (result.error) return fail(result.error);
      break;
    }
    case "addRow": {
      // Adding/removing rows is a Carbon-staff tailoring action; updating a
      // row (e.g. a status toggle) stays open to any employee.
      if (!isInternal) {
        return data(
          { success: false },
          await flash(
            request,
            error(new Error("forbidden"), "Only Carbon staff can add rows")
          )
        );
      }
      const result = await insertImplementationRow(client, {
        companyId,
        collection: a.collection,
        payload: JSON.parse(a.payload),
        userId
      });
      if (result.error) return fail(result.error);
      break;
    }
    case "updateRow": {
      const result = await updateImplementationRow(client, {
        id: a.rowId,
        companyId,
        payload: JSON.parse(a.payload),
        userId
      });
      if (result.error) return fail(result.error);
      break;
    }
    case "deleteRow": {
      if (!isInternal) {
        return data(
          { success: false },
          await flash(
            request,
            error(new Error("forbidden"), "Only Carbon staff can delete rows")
          )
        );
      }
      const result = await deleteImplementationRow(client, {
        id: a.rowId,
        companyId
      });
      if (result.error) return fail(result.error);
      break;
    }
    case "setStatus": {
      // Finishing (or reopening) the hub is the customer's own action on their
      // own hub — open to any company member, unlike the structural edits below.
      const result = await updateImplementationHub(client, companyId, {
        status: a.status,
        userId
      });
      if (result.error) return fail(result.error);
      break;
    }
    case "setExclusions":
    case "setTier":
    case "setContacts": {
      if (!isInternal) {
        return data(
          { success: false },
          await flash(
            request,
            error(
              new Error("forbidden"),
              "Only Carbon staff can change this setting"
            )
          )
        );
      }
      const patch =
        a.intent === "setExclusions"
          ? { exclusions: JSON.parse(a.exclusions), userId }
          : a.intent === "setTier"
            ? { tier: a.tier, userId }
            : { contacts: JSON.parse(a.contacts), userId };
      const result = await updateImplementationHub(client, companyId, patch);
      if (result.error) return fail(result.error);
      break;
    }
  }

  return data({ success: true });
}
