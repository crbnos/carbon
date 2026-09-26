import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteComplianceStatement,
  getComplianceStatement
} from "~/modules/quality";
import { getParams, path } from "~/utils/path";

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
      `${path.to.complianceStatements}?${getParams(request)}`,
      await flash(
        request,
        error(complianceStatement.error, "Failed to get compliance statement")
      )
    );
  }

  return { complianceStatement: complianceStatement.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "quality"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.complianceStatements}?${getParams(request)}`,
      await flash(
        request,
        error(params, "Failed to get a compliance statement id")
      )
    );
  }

  const { error: deleteError } = await deleteComplianceStatement(
    client,
    id,
    companyId
  );
  if (deleteError) {
    throw redirect(
      `${path.to.complianceStatements}?${getParams(request)}`,
      await flash(
        request,
        error(deleteError, "Failed to delete compliance statement")
      )
    );
  }

  throw redirect(
    `${path.to.complianceStatements}?${getParams(request)}`,
    await flash(request, success("Successfully deleted compliance statement"))
  );
}

export default function DeleteComplianceStatementRoute() {
  const { id } = useParams();
  const { complianceStatement } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!complianceStatement) return null;
  if (!id) throw notFound("id not found");

  const onCancel = () => navigate(path.to.complianceStatements);
  return (
    <ConfirmDelete
      action={path.to.deleteComplianceStatement(id)}
      name={complianceStatement.name}
      text={t`Are you sure you want to delete the compliance statement: ${complianceStatement.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
