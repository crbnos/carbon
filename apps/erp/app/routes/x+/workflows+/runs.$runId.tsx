import { requirePermissions } from "@carbon/auth/auth.server";
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
  getWorkflowRunSteps
} from "~/modules/workflows";
import { WorkflowRunDetail } from "~/modules/workflows/ui/Runs/WorkflowRunDetail";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "workflows",
    role: "employee"
  });

  const { runId } = params;
  if (!runId) throw new Error("runId is not found");

  const runResult = await getWorkflowRun(client, runId, companyId);
  const run = runResult.data;
  if (!run) throw new Error("Run not found");

  const stepsResult = await getWorkflowRunSteps(client, runId, companyId);
  const steps = stepsResult.data ?? [];

  let chain = null;
  if (run.rootRunId) {
    const chainResult = await getWorkflowRunChain(
      client,
      run.rootRunId,
      companyId
    );
    chain = chainResult.data ?? null;
  }

  return { run, steps, chain };
}

export default function WorkflowRunDetailRoute() {
  const { run, steps, chain } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.workflowRuns);
      }}
    >
      <DrawerContent size="full">
        <DrawerHeader>
          <DrawerTitle>
            <Trans>Run Details</Trans>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="p-0">
          <WorkflowRunDetail run={run} steps={steps} chain={chain} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
