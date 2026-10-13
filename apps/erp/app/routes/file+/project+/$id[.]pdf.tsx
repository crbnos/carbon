// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { ProjectReaderSection } from "@carbon/documents/pdf";
import { ensureFont, ProjectReaderPDF } from "@carbon/documents/pdf";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { formatQuantity, getPreferenceHeaders } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import type {
  ProjectElementType,
  RequirementStatus,
  TestCaseVerdict
} from "~/modules/projects";
import {
  buildReaderOutline,
  formatAllocation,
  formatRequirementTarget,
  getProject,
  getProjectElementDescriptions,
  getProjectElements,
  parseElementFilters
} from "~/modules/projects";
import type { VerificationElement } from "~/modules/projects/projects.models";
import { getProjectVerification } from "~/modules/projects/projects.server";
import { getCompany } from "~/modules/settings";

const logger = getLogger("erp", "project-reader", "pdf");

const TYPE_LABELS: Record<ProjectElementType, string> = {
  Folder: "Folder",
  System: "System",
  Requirement: "Requirement",
  Function: "Function",
  Task: "Task",
  "Test Case": "Test Case",
  Parameter: "Parameter"
};

const STATUS_LABELS: Record<RequirementStatus, string> = {
  Pass: "Pass",
  Fail: "Fail",
  Unverified: "Unverified"
};

const VERDICT_LABELS: Record<TestCaseVerdict, string> = {
  "Not Run": "Not Run",
  Pass: "Pass",
  Fail: "Fail",
  Inconclusive: "Inconclusive"
};

/**
 * The Reader layout as a PDF: the project's elements with the filters of the
 * query string, in tree order, one section each.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find project id");

  const searchParams = new URL(request.url).searchParams;
  const { filters, isFiltered } = parseElementFilters(searchParams);

  const [company, project, elements, descriptions] = await Promise.all([
    getCompany(client, companyId),
    getProject(client, companyId, id),
    getProjectElements(client, id, companyId, filters),
    getProjectElementDescriptions(client, id, companyId)
  ]);

  const error =
    company.error ?? project.error ?? elements.error ?? descriptions.error;
  if (error || !company.data || !project.data) {
    logger.error("Failed to load the project reader", {
      companyId,
      projectId: id,
      error
    });
    throw new Response("The project could not be found", { status: 404 });
  }

  // Verification reads every element: a filter could hide an input.
  const verification = await getProjectVerification(client, {
    companyId,
    projectId: id,
    elements: isFiltered
      ? undefined
      : ((elements.data ?? []) as VerificationElement[])
  });
  if (verification.error || !verification.data) {
    logger.error("Failed to load the project verification", {
      companyId,
      projectId: id,
      error: verification.error
    });
    throw new Response("The project could not be loaded", { status: 500 });
  }

  const ownerIds = [
    ...new Set(
      (elements.data ?? [])
        .map((element) => element.ownerId)
        .filter((ownerId): ownerId is string => Boolean(ownerId))
    )
  ];
  const owners =
    ownerIds.length > 0
      ? await client.from("user").select("id, fullName").in("id", ownerIds)
      : { data: [], error: null };
  if (owners.error) {
    logger.error("Failed to load the element owners", {
      companyId,
      projectId: id,
      error: owners.error
    });
  }
  const ownerName = new Map(
    (owners.data ?? []).map((owner) => [owner.id, owner.fullName])
  );
  const descriptionOf = new Map(
    (descriptions.data ?? []).map((row) => [row.id, row.description])
  );

  const { locale } = getPreferenceHeaders(request);
  const { verification: byElement, requirementStatus } = verification.data;

  const sections: ProjectReaderSection[] = buildReaderOutline(
    elements.data ?? []
  ).map(({ element, level, number }) => {
    const properties = [TYPE_LABELS[element.type]];
    if (element.state) properties.push(element.state.name);
    const owner = element.ownerId ? ownerName.get(element.ownerId) : null;
    if (owner) properties.push(owner);

    const facts: { label: string; value: string }[] = [];
    if (element.type === "Requirement") {
      facts.push({
        label: "Target",
        value: formatRequirementTarget(element, locale) ?? "—"
      });
      const status = requirementStatus[element.id];
      if (status) facts.push({ label: "Status", value: STATUS_LABELS[status] });
    }
    const own = byElement[element.id];
    if (element.type === "Parameter" && own?.kind === "Parameter") {
      const unit = element.parameterUnit ? ` ${element.parameterUnit}` : "";
      facts.push({
        label: "Value",
        value:
          own.computedValue === null
            ? (own.reason ?? "No value")
            : `${formatQuantity(own.computedValue, locale)}${unit}`
      });
      if (
        own.budgetValue !== null &&
        own.parentValue !== null &&
        element.allocationPercent !== null
      ) {
        facts.push({
          label: "Allocation",
          value: formatAllocation(
            own.budgetValue,
            Number(element.allocationPercent),
            own.parentValue,
            element.parameterUnit,
            locale
          )
        });
      }
    }
    if (element.type === "Test Case") {
      facts.push({
        label: "Verdict",
        value: VERDICT_LABELS[element.verdict ?? "Not Run"]
      });
    }

    const description = descriptionOf.get(element.id);
    return {
      id: element.id,
      level,
      number,
      readableId: element.readableId,
      name: element.name,
      properties,
      facts,
      description:
        description && typeof description === "object"
          ? (description as JSONContent)
          : null
    };
  });

  await ensureFont();
  const stream = await renderToStream(
    <ProjectReaderPDF
      company={company.data as any}
      project={{
        identifier: project.data.identifier,
        name: project.data.name
      }}
      sections={sections}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${company.data.name} - ${project.data.identifier ?? project.data.name}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
