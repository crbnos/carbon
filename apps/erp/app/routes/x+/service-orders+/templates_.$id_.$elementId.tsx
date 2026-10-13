// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuArrowLeft,
  LuChevronRight,
  LuEllipsisVertical,
  LuListPlus,
  LuTrash
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Link,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import {
  deleteProjectElementCost,
  deleteProjectElementLabor,
  deleteProjectElementMaterial,
  getLaborCategoriesList,
  getProjectElementPlanLines,
  projectElementCostValidator,
  projectElementLaborValidator,
  projectElementMaterialValidator,
  upsertProjectElementCost,
  upsertProjectElementLabor,
  upsertProjectElementMaterial
} from "~/modules/projects";
import { ElementPlanLines } from "~/modules/projects/ui/Element/ElementPlanLines";
import { ElementTypeIcon } from "~/modules/projects/ui/Elements/ElementTypeIcon";
import { getServiceTemplate } from "~/modules/service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: (
    params: { id?: string },
    data?: {
      template?: { identifier: string | null; name: string };
      node?: { readableId: string };
    }
  ) => [
    { breadcrumb: msg`Service Templates`, to: path.to.serviceTemplates },
    ...(data?.template && params.id
      ? [
          {
            breadcrumb: data.template.identifier ?? data.template.name,
            to: path.to.serviceTemplate(params.id)
          }
        ]
      : []),
    ...(data?.node ? [{ breadcrumb: data.node.readableId }] : [])
  ]
};

const logger = getLogger("erp", "service-template-node");

type PlanTable =
  | "projectElementMaterial"
  | "projectElementLabor"
  | "projectElementCost";

/** The node of a template, checked to belong to it. */
async function getTemplateNode(
  client: Awaited<ReturnType<typeof requirePermissions>>["client"],
  args: { templateId: string; elementId: string; companyId: string }
) {
  return client
    .from("projectElement")
    .select("id, readableId, name, type")
    .eq("id", args.elementId)
    .eq("projectId", args.templateId)
    .eq("companyId", args.companyId)
    .single();
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { id, elementId } = params;
  if (!id) throw new Error("Could not find id");
  if (!elementId) throw new Error("Could not find elementId");

  const [template, node, planLines, laborCategories] = await Promise.all([
    getServiceTemplate(client, id, companyId),
    getTemplateNode(client, { templateId: id, elementId, companyId }),
    getProjectElementPlanLines(client, elementId, companyId),
    getLaborCategoriesList(client, companyId)
  ]);
  if (template.error || node.error || planLines.error || !planLines.data) {
    throw redirect(
      path.to.serviceTemplate(id),
      await flash(
        request,
        error(
          template.error ?? node.error ?? planLines.error,
          "Failed to load the element"
        )
      )
    );
  }

  return {
    template: {
      identifier: template.data.identifier,
      name: template.data.name
    },
    node: node.data,
    planLines: planLines.data,
    laborCategories: laborCategories.data ?? []
  };
}

/** Adds, edits and deletes the plan lines of a template node. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { id, elementId } = params;
  if (!id) throw new Error("Could not find id");
  if (!elementId) throw new Error("Could not find elementId");

  const formData = await request.formData();
  const quiet = formData.get("quiet") === "true";
  const refuse = async (err: unknown, message: string) => {
    if (err) {
      logger.error(message, {
        companyId,
        templateId: id,
        elementId,
        error: err
      });
    }
    return quiet
      ? data({ success: false, error: message }, { status: 400 })
      : data({ success: false }, await flash(request, error(err, message)));
  };
  // `id` is the line saved: a grid draft keeps it, so its next edit updates.
  const done = async (message: string, id?: string) =>
    quiet
      ? data({ success: true, error: null, id: id ?? null })
      : data({ success: true }, await flash(request, success(message)));
  const invalid = (validation: {
    error: Parameters<typeof validationError>[0];
  }) =>
    quiet
      ? data(
          {
            success: false,
            error:
              Object.values(validation.error.fieldErrors ?? {})[0] ??
              "Invalid line"
          },
          { status: 400 }
        )
      : validationError(validation.error);

  const node = await getTemplateNode(client, {
    templateId: id,
    elementId,
    companyId
  });
  if (node.error)
    return refuse(null, "The element is not part of this template");

  formData.set("projectElementId", elementId);
  const intent = formData.get("intent");

  /** That an edited or deleted line belongs to this node. */
  const ownsLine = async (table: PlanTable, lineId: string) => {
    const line = await client
      .from(table)
      .select("id")
      .eq("id", lineId)
      .eq("projectElementId", elementId)
      .eq("companyId", companyId)
      .maybeSingle();
    return Boolean(line.data);
  };

  switch (intent) {
    case "upsertMaterial": {
      const validation = await validator(
        projectElementMaterialValidator
      ).validate(formData);
      if (validation.error) return invalid(validation);
      const { id: lineId, ...line } = validation.data;
      if (lineId && !(await ownsLine("projectElementMaterial", lineId))) {
        return refuse(null, "The line is not on this element");
      }
      const result = lineId
        ? await upsertProjectElementMaterial(client, {
            ...line,
            id: lineId,
            companyId,
            updatedBy: userId
          })
        : await upsertProjectElementMaterial(client, {
            ...line,
            projectId: id,
            companyId,
            createdBy: userId
          });
      if (result.error) return refuse(result.error, "Failed to save the part");
      return done("Part saved", result.data?.id);
    }
    case "upsertLabor": {
      const validation = await validator(projectElementLaborValidator).validate(
        formData
      );
      if (validation.error) return invalid(validation);
      const { id: lineId, ...line } = validation.data;
      if (lineId && !(await ownsLine("projectElementLabor", lineId))) {
        return refuse(null, "The line is not on this element");
      }
      const result = lineId
        ? await upsertProjectElementLabor(client, {
            ...line,
            id: lineId,
            companyId,
            updatedBy: userId
          })
        : await upsertProjectElementLabor(client, {
            ...line,
            projectId: id,
            companyId,
            createdBy: userId
          });
      if (result.error) return refuse(result.error, "Failed to save the labor");
      return done("Labor saved", result.data?.id);
    }
    case "upsertCost": {
      const validation = await validator(projectElementCostValidator).validate(
        formData
      );
      if (validation.error) return invalid(validation);
      const { id: lineId, ...line } = validation.data;
      if (lineId && !(await ownsLine("projectElementCost", lineId))) {
        return refuse(null, "The line is not on this element");
      }
      const result = lineId
        ? await upsertProjectElementCost(client, {
            ...line,
            id: lineId,
            companyId,
            updatedBy: userId
          })
        : await upsertProjectElementCost(client, {
            ...line,
            projectId: id,
            companyId,
            createdBy: userId
          });
      if (result.error) return refuse(result.error, "Failed to save the cost");
      return done("Cost saved", result.data?.id);
    }
    case "deleteMaterial":
    case "deleteLabor":
    case "deleteCost": {
      const lineId = formData.get("id");
      if (typeof lineId !== "string" || !lineId) {
        return refuse(null, "No line was given");
      }
      const table: PlanTable =
        intent === "deleteMaterial"
          ? "projectElementMaterial"
          : intent === "deleteLabor"
            ? "projectElementLabor"
            : "projectElementCost";
      if (!(await ownsLine(table, lineId))) {
        return refuse(null, "The line is not on this element");
      }
      const remove =
        intent === "deleteMaterial"
          ? deleteProjectElementMaterial
          : intent === "deleteLabor"
            ? deleteProjectElementLabor
            : deleteProjectElementCost;
      const result = await remove(client, lineId, companyId);
      if (result.error)
        return refuse(result.error, "Failed to delete the line");
      return done("Line deleted");
    }
    default:
      return refuse(null, "Unknown action");
  }
}

/**
 * A template element on its own page: the back arrow and the template's
 * breadcrumb, the element's name, and its planned materials, labor and
 * costs in one grid. Delete is in the ⋯ menu.
 */
export default function ServiceTemplateNodeRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { template, node, planLines, laborCategories } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "service");
  const [addRequest, setAddRequest] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const templatePath = path.to.serviceTemplate(id);
  const lineCount =
    planLines.materials.length +
    planLines.labor.length +
    planLines.costs.length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="flex h-[var(--header-height)] shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <nav
          aria-label={t`Breadcrumb`}
          className="flex min-w-0 items-center gap-1 text-sm"
        >
          <IconButton
            aria-label={t`Back`}
            icon={<LuArrowLeft />}
            variant="ghost"
            size="sm"
            onClick={() => navigate(templatePath)}
          />
          <Link
            to={templatePath}
            className="min-w-0 max-w-48 truncate rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {template.identifier ?? template.name}
          </Link>
          <LuChevronRight className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate px-1.5 py-0.5">
            {node.readableId}
          </span>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Copy text={node.readableId} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`More options`}
                icon={<LuEllipsisVertical />}
                variant="secondary"
                size="sm"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() => setAddRequest((n) => n + 1)}
              >
                <DropdownMenuIcon icon={<LuListPlus />} />
                <Trans>Add plan line</Trans>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                disabled={!canUpdate}
                onClick={() => setDeleting(true)}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                <Trans>Delete</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[800px] flex-col gap-8 px-8 py-8">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
              <ElementTypeIcon type={node.type} className="size-3.5" />
              {node.readableId}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              {node.name}
            </h1>
          </div>

          <section className="flex w-full flex-col gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              <Trans>Plan</Trans>
              {lineCount > 0 && (
                <span className="text-muted-foreground tabular-nums">
                  {lineCount}
                </span>
              )}
            </h2>
            <ElementPlanLines
              key={node.id}
              projectId={id}
              elementId={node.id}
              planLines={planLines}
              laborCategories={laborCategories}
              isDisabled={!canUpdate}
              action={path.to.serviceTemplateNode(id, node.id)}
              canSupply={false}
              addRequest={addRequest}
            />
          </section>
        </div>
      </div>

      {deleting && (
        <ConfirmDelete
          action={templatePath}
          name={node.name}
          text={t`The element and its planned materials, labor and costs leave the template. Service orders already started from it keep theirs.`}
          fields={{ intent: "delete", elementId: node.id }}
          onCancel={() => setDeleting(false)}
          onSubmit={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
