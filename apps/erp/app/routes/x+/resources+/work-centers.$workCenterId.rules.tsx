import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getStorageRulesDataForTarget } from "@carbon/ee/storage-rules.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import RuleAssignmentsList from "~/modules/storage-rules/ui/RuleAssignmentsList";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });
  const { workCenterId } = params;
  if (!workCenterId) throw notFound("workCenterId required");

  const data = await getStorageRulesDataForTarget(client, {
    targetType: "workCenter",
    targetId: workCenterId,
    companyId
  });

  return { workCenterId, ...data };
}

export default function WorkCenterRulesRoute() {
  const { workCenterId, assignments, library } = useLoaderData<typeof loader>();
  return (
    <RuleAssignmentsList
      targetType="workCenter"
      targetId={workCenterId}
      assignments={assignments as never}
      library={library as never}
      variant="flat"
    />
  );
}
