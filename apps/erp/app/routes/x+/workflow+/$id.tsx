import { requirePermissions } from "@carbon/auth/auth.server";
import { requirePlan } from "@carbon/ee/plan.server";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  useDisclosure,
  VStack
} from "@carbon/react";
import { readWorkflowVersion } from "@carbon/workflows";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ReactFlowProvider } from "@xyflow/react";
import XYFlowStyle from "@xyflow/react/dist/style.css?url";
import { LuTriangleAlert } from "react-icons/lu";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs
} from "react-router";
import { redirect, useLoaderData } from "react-router";
import { usePermissions } from "~/hooks";
import {
  getWorkflow,
  getWorkflowVersion,
  getWorkflowVersions,
  workflowCanvasStateSchema
} from "~/modules/workflows";
import { Autosave } from "~/modules/workflows/ui/Builder/Autosave";
import { BuilderHeader } from "~/modules/workflows/ui/Builder/BuilderHeader";
import { WorkflowBuilderProvider } from "~/modules/workflows/ui/Builder/context";
import WorkflowEdgeStyle from "~/modules/workflows/ui/Builder/edges/workflow-edge.css?url";
import { toReactFlow } from "~/modules/workflows/ui/Builder/graph";
import { IssuesPanel } from "~/modules/workflows/ui/Builder/IssuesPanel";
import { LiveValidation } from "~/modules/workflows/ui/Builder/LiveValidation";
import { TestRunDialog } from "~/modules/workflows/ui/Builder/TestRun/TestRunDialog";
import { WorkflowBuilder } from "~/modules/workflows/ui/Builder/WorkflowBuilder";
import WorkflowLockModal from "~/modules/workflows/ui/WorkflowLockModal";
import type { Handle } from "~/utils/handle";
import { detailBreadcrumb } from "~/utils/handle";
import { path } from "~/utils/path";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: XYFlowStyle },
  { rel: "stylesheet", href: WorkflowEdgeStyle }
];

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Workflows`, to: path.to.workflows },
    (data) => data?.workflow?.name
  ),
  module: "workflows"
};

// Neither write may revalidate the loader: a save would re-seed the canvas mid-edit
// and lose the selection, a canvas write would snap the viewport back.
export function shouldRevalidate({ formAction }: ShouldRevalidateFunctionArgs) {
  return (
    !formAction?.includes("/save") &&
    !formAction?.includes("/canvas") &&
    !formAction?.includes("/positions")
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
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

  const { id } = params;
  if (!id) throw new Error("id is not found");

  const found = await getWorkflow(client, id, companyId);
  if (found.error || !found.data) throw redirect(path.to.workflows);
  const workflow = found.data;

  const stored = workflowCanvasStateSchema.safeParse(workflow.canvasState);
  const canvasState = stored.success ? stored.data : null;

  const versions = await getWorkflowVersions(client, id, companyId);
  const all = versions.data ?? [];

  const requested = new URL(request.url).searchParams.get("version");
  const mostRecent = [...all].sort(
    (a, b) =>
      new Date(b.updatedAt ?? 0).getTime() -
      new Date(a.updatedAt ?? 0).getTime()
  )[0];
  const versionId =
    (requested && all.some((version) => version.id === requested)
      ? requested
      : null) ??
    mostRecent?.id ??
    null;

  if (!versionId) {
    return {
      workflow,
      userId,
      canvasState,
      versions: all,
      versionId: null,
      definition: null,
      failure: "no-versions" as const,
      message: "This workflow has no versions.",
      isVersionLocked: true
    };
  }

  const version = await getWorkflowVersion(client, versionId, companyId);
  if (version.error || !version.data) throw redirect(path.to.workflows);

  // `readWorkflowVersion` is the only legal read path. On failure the canvas must
  // not mount — a blank canvas would let an autosave overwrite a definition
  // nobody could see.
  const read = readWorkflowVersion(version.data);
  if (!read.ok) {
    return {
      workflow,
      userId,
      canvasState,
      versions: all,
      versionId,
      definition: null,
      failure: read.failure,
      message: read.message,
      isVersionLocked: true
    };
  }

  return {
    workflow,
    userId,
    canvasState,
    versions: all,
    versionId,
    definition: read.definition,
    failure: null,
    message: null,
    isVersionLocked: versionId === workflow.publishedVersionId
  };
}

export default function WorkflowBuilderRoute() {
  const permissions = usePermissions();
  const issuesDisclosure = useDisclosure();
  const {
    workflow,
    userId,
    canvasState,
    versions,
    versionId,
    definition,
    message,
    isVersionLocked
  } = useLoaderData<typeof loader>();

  // Two reasons, two behaviours: a locked version still allows dragging to tidy the
  // layout, a missing permission does not.
  const canEdit = permissions.can("update", "workflows");
  const isOwner = workflow.ownerId === userId;

  if (!definition || !versionId) {
    return (
      <VStack spacing={4} className="p-8">
        <Alert variant="destructive">
          <LuTriangleAlert />
          <AlertTitle>
            <Trans>This version cannot be opened</Trans>
          </AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </VStack>
    );
  }

  const { nodes, edges } = toReactFlow(definition);

  return (
    <ReactFlowProvider>
      <WorkflowBuilderProvider
        key={`${versionId}:${isVersionLocked}:${canEdit}:${isOwner}`}
        nodes={nodes}
        edges={edges}
        isVersionLocked={isVersionLocked}
        canEdit={canEdit}
        isOwner={isOwner}
      >
        <div className="flex h-[calc(100dvh-var(--topbar-height))] w-full flex-col">
          <BuilderHeader
            workflow={workflow}
            versions={versions}
            versionId={versionId}
            onIssues={issuesDisclosure.onOpen}
          />
          {isVersionLocked && permissions.can("create", "workflows") && (
            <WorkflowLockModal workflowId={workflow.id} versionId={versionId} />
          )}
          <div className="relative flex flex-1 overflow-hidden">
            <WorkflowBuilder
              workflowId={workflow.id}
              canvasState={canvasState}
              canPersistCanvasState={permissions.can("update", "workflows")}
            />
            {issuesDisclosure.isOpen && (
              <IssuesPanel onDismiss={issuesDisclosure.onClose} />
            )}
          </div>
          <Autosave workflowId={workflow.id} versionId={versionId} />
          <LiveValidation />
          <TestRunDialog workflowId={workflow.id} versionId={versionId} />
        </div>
      </WorkflowBuilderProvider>
    </ReactFlowProvider>
  );
}
