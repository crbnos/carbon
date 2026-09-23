import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ChangeNotice, ChangeNoticeActionTask } from "~/modules/items";
import { getChangeNoticeImpactWorkspace } from "~/modules/items";
import {
  getChangeNoticeImpactReadAccess,
  reconcileAuthorizedChangeNoticeImpactProvenance
} from "~/modules/items/items.server";
import { ChangeNoticeImpactWorkspace } from "~/modules/items/ui/ChangeNotice";
import { path } from "~/utils/path";
import { revalidateIgnoringImpactDisplay } from "~/utils/revalidate";

export const shouldRevalidate = revalidateIgnoringImpactDisplay;

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await reconcileAuthorizedChangeNoticeImpactProvenance({
    client,
    companyId,
    userId,
    changeNoticeId: id
  });
  if (result.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(result.error, "Failed to refresh operational impact")
      )
    );
  }

  return { success: true };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const access = await getChangeNoticeImpactReadAccess({
    client,
    userId,
    companyId
  });
  if (access.status === "resolved" && !access.canViewChangeNotice) {
    throw new Response("Forbidden", { status: 403 });
  }

  const sourceAccess =
    access.status === "failed"
      ? access
      : { status: "resolved" as const, access: access.sourceAccess };
  const result = await getChangeNoticeImpactWorkspace(client, companyId, id, {
    sourceAccess
  });
  if (result.error || !result.data) {
    throw new Response("Impact workspace unavailable", { status: 503 });
  }
  return result.data;
}

export default function ChangeNoticeImpactRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const data = useLoaderData<typeof loader>();
  const routeData = useRouteData<{
    changeNotice: ChangeNotice;
    actions: ChangeNoticeActionTask[];
  }>(path.to.changeNotice(id));
  return (
    <ChangeNoticeImpactWorkspace
      id={id}
      changeNotice={routeData?.changeNotice ?? null}
      data={data}
      actions={routeData?.actions ?? []}
    />
  );
}
