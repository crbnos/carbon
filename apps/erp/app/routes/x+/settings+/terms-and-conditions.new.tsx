import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import type { z } from "zod";
import {
  TermsVersionForm,
  termsVersionValidator,
  upsertTermsVersion
} from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "settings",
    role: "employee"
  });

  return {};
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "settings"
  });

  const validation = await validator(termsVersionValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id: _id,
    scope,
    customerIds,
    supplierIds,
    countryCodes,
    content,
    ...d
  } = validation.data;

  const create = await upsertTermsVersion(client, {
    ...d,
    content: JSON.parse(content || "{}") as Json,
    customerIds: scope === "party" ? customerIds : [],
    supplierIds: scope === "party" ? supplierIds : [],
    countryCodes: scope === "country" ? countryCodes : [],
    companyId,
    createdBy: userId
  });

  if (create.error || !create.data?.id) {
    return data(
      {},
      await flash(
        request,
        error(create.error, "Failed to create terms version")
      )
    );
  }

  // Straight into the full-screen editor — the body, scope and dates are
  // edited there, so the create step only collects a name and a document.
  throw redirect(
    path.to.termsVersion(create.data.id),
    await flash(request, success("Created terms version"))
  );
}

export default function NewTermsVersionRoute() {
  const initialValues: z.infer<typeof termsVersionValidator> = {
    name: "",
    documentTypes: ["purchaseOrder"],
    scope: "global",
    content: "",
    customerIds: [],
    supplierIds: [],
    countryCodes: [],
    effectiveFrom: "",
    effectiveTo: "",
    active: true
  };

  return <TermsVersionForm initialValues={initialValues} />;
}
