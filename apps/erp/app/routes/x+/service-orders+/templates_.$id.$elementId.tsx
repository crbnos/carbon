// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useNavigate, useParams } from "react-router";
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
import { path } from "~/utils/path";

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

  const refuse = async (err: unknown, message: string) => {
    if (err) {
      logger.error(message, {
        companyId,
        templateId: id,
        elementId,
        error: err
      });
    }
    return data({ success: false }, await flash(request, error(err, message)));
  };
  const done = async (message: string) =>
    data({ success: true }, await flash(request, success(message)));

  const node = await getTemplateNode(client, {
    templateId: id,
    elementId,
    companyId
  });
  if (node.error)
    return refuse(null, "The element is not part of this template");

  const formData = await request.formData();
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
      if (validation.error) return validationError(validation.error);
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
      return done("Part saved");
    }
    case "upsertLabor": {
      const validation = await validator(projectElementLaborValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
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
      return done("Labor saved");
    }
    case "upsertCost": {
      const validation = await validator(projectElementCostValidator).validate(
        formData
      );
      if (validation.error) return validationError(validation.error);
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
      return done("Cost saved");
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

/** A template node in a drawer over the tree: its plan lines. */
export default function ServiceTemplateNodeRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { node, planLines, laborCategories } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const permissions = usePermissions();

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && navigate(path.to.serviceTemplate(id))}
    >
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle className="flex min-w-0 items-center gap-2">
            <ElementTypeIcon type={node.type} />
            <span className="shrink-0 whitespace-nowrap font-mono text-sm text-muted-foreground">
              {node.readableId}
            </span>
            <span className="truncate">{node.name}</span>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <ElementPlanLines
            key={node.id}
            projectId={id}
            elementId={node.id}
            planLines={planLines}
            laborCategories={laborCategories}
            isDisabled={!permissions.can("update", "service")}
            action={path.to.serviceTemplateNode(id, node.id)}
            canSupply={false}
          />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
