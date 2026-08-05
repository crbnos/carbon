import { requirePermissions } from "@carbon/auth/auth.server";
import { requirePlan } from "@carbon/ee/plan.server";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import {
  getWorkflowRun,
  getWorkflowRunChain,
  getWorkflowRunRecordNames,
  getWorkflowRunSteps
} from "~/modules/workflows";
import { collectEntityRefs } from "~/modules/workflows/ui/Runs/entityRefs";
import { WorkflowRunDetail } from "~/modules/workflows/ui/Runs/WorkflowRunDetail";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "workflows",
    role: "employee"
  });
  await requirePlan({
    request,
    client,
    companyId,
    feature: "WORKFLOWS",
    redirectTo: path.to.workflows
  });

  const { runId } = params;
  if (!runId) throw new Error("runId is not found");

  const runResult = await getWorkflowRun(client, runId, companyId);
  const run = runResult.data;
  if (!run) throw new Error("Run not found");

  const stepsResult = await getWorkflowRunSteps(client, runId, companyId);
  const steps = stepsResult.data ?? [];

  const refs = collectEntityRefs([
    ...steps.map((s) => s.input),
    ...steps.map((s) => s.output)
  ]);
  if (run.triggerTable && run.triggerRecordId) {
    refs.push({ table: run.triggerTable, id: run.triggerRecordId });
  }
  const recordNames = await getWorkflowRunRecordNames(client, companyId, refs);

  let chain = null;
  if (run.rootRunId) {
    const chainResult = await getWorkflowRunChain(
      client,
      run.rootRunId,
      companyId
    );
    chain = chainResult.data ?? null;
  }

  return { run, steps, chain, recordNames };
}

export default function WorkflowRunDetailRoute() {
  const { run, steps, chain, recordNames } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.workflowRuns);
      }}
    >
      <DrawerContent size="xl">
        <DrawerHeader>
          <DrawerTitle>
            <Trans>Run Details</Trans>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="p-0">
          <WorkflowRunDetail
            run={run}
            steps={steps}
            chain={chain}
            recordNames={recordNames}
          />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
