import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  complianceStatementValidator,
  getComplianceStatement,
  upsertComplianceStatement
} from "~/modules/quality";
import ComplianceStatementForm from "~/modules/quality/ui/ComplianceStatements/ComplianceStatementForm";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const complianceStatement = await getComplianceStatement(
    client,
    id,
    companyId
  );

  if (complianceStatement.error) {
    throw redirect(
      path.to.complianceStatements,
      await flash(
        request,
        error(complianceStatement.error, "Failed to get compliance statement")
      )
    );
  }

  return {
    complianceStatement: complianceStatement.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("id not found");

  const formData = await request.formData();
  const validation = await validator(complianceStatementValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // The statement being edited is the one in the URL.
  const { id: _formId, ...d } = validation.data;

  const updateStatement = await upsertComplianceStatement(getDatabaseClient(), {
    ...d,
    id,
    companyId,
    userId
  });

  if (updateStatement.error?.code === "23505") {
    return validationError({
      fieldErrors: {
        name: "A compliance statement with this name already exists"
      }
    });
  }
  if (updateStatement.error) {
    return data(
      {},
      await flash(
        request,
        error(updateStatement.error, "Failed to update compliance statement")
      )
    );
  }

  throw redirect(
    path.to.complianceStatements,
    await flash(request, success("Updated compliance statement"))
  );
}

export default function EditComplianceStatementRoute() {
  const { complianceStatement } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const assignments = complianceStatement.complianceStatementAssignment ?? [];
  const initialValues = {
    id: complianceStatement.id,
    name: complianceStatement.name,
    content: complianceStatement.content,
    appliesToAllCustomers: complianceStatement.appliesToAllCustomers,
    active: complianceStatement.active,
    customerIds: assignments.flatMap((assignment) =>
      assignment.customerId ? [assignment.customerId] : []
    ),
    itemIds: assignments.flatMap((assignment) =>
      assignment.itemId ? [assignment.itemId] : []
    )
  };

  return (
    <ComplianceStatementForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
