import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  complianceStatementValidator,
  upsertComplianceStatement
} from "~/modules/quality";
import ComplianceStatementForm from "~/modules/quality/ui/ComplianceStatements/ComplianceStatementForm";
import { getDatabaseClient } from "~/services/database.server";
import { getParams, path, requestReferrer } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "quality"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });

  const formData = await request.formData();
  const validation = await validator(complianceStatementValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertStatement = await upsertComplianceStatement(getDatabaseClient(), {
    ...d,
    companyId,
    userId
  });
  if (insertStatement.error?.code === "23505") {
    return validationError({
      fieldErrors: {
        name: "A compliance statement with this name already exists"
      }
    });
  }
  if (insertStatement.error) {
    throw redirect(
      requestReferrer(request) ??
        `${path.to.complianceStatements}?${getParams(request)}`,
      await flash(
        request,
        error(insertStatement.error, "Failed to insert compliance statement")
      )
    );
  }

  throw redirect(
    `${path.to.complianceStatements}?${getParams(request)}`,
    await flash(request, success("Compliance statement created"))
  );
}

export default function NewComplianceStatementRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    content: "",
    appliesToAllCustomers: false,
    active: true,
    customerIds: [],
    itemIds: []
  };

  return (
    <ComplianceStatementForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
