import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { getNettingStatement } from "~/modules/accounting";
import { NettingStatementDrawer } from "~/modules/accounting/ui/Intercompany";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { id } = params;
  if (!id) {
    throw redirect(`${path.to.intercompany}?tab=netting`);
  }

  const statement = await getNettingStatement(client, id);
  if (statement.error || !statement.data) {
    throw redirect(
      `${path.to.intercompany}?tab=netting`,
      await flash(
        request,
        error(statement.error, "Failed to load netting statement")
      )
    );
  }

  return { statement: statement.data };
}

export default function NettingStatementRoute() {
  const { statement } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <NettingStatementDrawer
      statement={statement}
      onClose={() => navigate(`${path.to.intercompany}?tab=netting`)}
    />
  );
}
