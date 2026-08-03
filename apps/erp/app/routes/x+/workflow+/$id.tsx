import { requirePermissions } from "@carbon/auth/auth.server";
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
  getWorkflowVersions
} from "~/modules/workflows";
import { Autosave } from "~/modules/workflows/ui/Builder/Autosave";
import { BuilderHeader } from "~/modules/workflows/ui/Builder/BuilderHeader";
import { WorkflowBuilderProvider } from "~/modules/workflows/ui/Builder/context";
import WorkflowEdgeStyle from "~/modules/workflows/ui/Builder/edges/workflow-edge.css?url";
import { toReactFlow } from "~/modules/workflows/ui/Builder/graph";
import { IssuesPanel } from "~/modules/workflows/ui/Builder/IssuesPanel";
import { WorkflowBuilder } from "~/modules/workflows/ui/Builder/WorkflowBuilder";
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

// An autosave must not revalidate the loader — that re-seeds the canvas from
// server state mid-edit and loses the selection and any in-flight drag.
export function shouldRevalidate({ formAction }: ShouldRevalidateFunctionArgs) {
  return !formAction?.includes("/save");
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "workflows",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw new Error("id is not found");

  const found = await getWorkflow(client, id, companyId);
  if (found.error || !found.data) throw redirect(path.to.workflows);
  const workflow = found.data;

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
      versions: all,
      versionId: null,
      definition: null,
      failure: "no-versions" as const,
      message: "This workflow has no versions.",
      isReadOnly: true
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
      versions: all,
      versionId,
      definition: null,
      failure: read.failure,
      message: read.message,
      isReadOnly: true
    };
  }

  return {
    workflow,
    versions: all,
    versionId,
    definition: read.definition,
    failure: null,
    message: null,
    isReadOnly: versionId === workflow.activeVersionId
  };
}

export default function WorkflowBuilderRoute() {
  const permissions = usePermissions();
  const issuesDisclosure = useDisclosure();
  const {
    workflow,
    versions,
    versionId,
    definition,
    message,
    isReadOnly: isLiveVersion
  } = useLoaderData<typeof loader>();

  const isReadOnly = isLiveVersion || !permissions.can("update", "workflows");

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
        key={`${versionId}:${isReadOnly}`}
        nodes={nodes}
        edges={edges}
        isReadOnly={isReadOnly}
      >
        <div className="flex h-[calc(100dvh-49px)] w-full flex-col">
          <BuilderHeader
            workflow={workflow}
            versions={versions}
            versionId={versionId}
            onIssues={issuesDisclosure.onOpen}
          />
          <div className="relative flex flex-1 overflow-hidden">
            <WorkflowBuilder />
            {issuesDisclosure.isOpen && (
              <IssuesPanel onDismiss={issuesDisclosure.onClose} />
            )}
          </div>
          <Autosave workflowId={workflow.id} versionId={versionId} />
        </div>
      </WorkflowBuilderProvider>
    </ReactFlowProvider>
  );
}
