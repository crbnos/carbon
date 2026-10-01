// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import template from "lodash.template";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { documents } from "./data/quality";

function interpolateContent(
  content: any,
  data: { company: { name: string } }
): any {
  if (typeof content === "string") {
    return template(content)(data);
  }

  if (Array.isArray(content)) {
    return content.map((item) => interpolateContent(item, data));
  }

  if (content && typeof content === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(content)) {
      if (key === "text" && typeof value === "string") {
        result[key] = template(value)(data);
      } else {
        result[key] = interpolateContent(value, data);
      }
    }
    return result;
  }

  return content;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    create: "quality"
  });

  const [currentDocuments, company] = await Promise.all([
    client.from("qualityDocument").select("*").eq("companyId", companyId),
    client.from("company").select("name").eq("id", companyId).single()
  ]);

  if (currentDocuments.error) {
    return data(
      { success: false, message: currentDocuments.error.message },
      { status: 500 }
    );
  }

  if (currentDocuments.data.length > 0) {
    return data(
      { success: false, message: "Documents already exist" },
      { status: 400 }
    );
  }

  if (company.error || !company.data) {
    return data(
      { success: false, message: "Company not found" },
      { status: 404 }
    );
  }

  const interpolatedDocuments = documents.map((document) => ({
    ...document,
    content: interpolateContent(document.content, { company: company.data }),
    companyId,
    createdBy: userId
  }));

  const insertDocuments = await client
    .from("qualityDocument")
    .insert(interpolatedDocuments);

  if (insertDocuments.error) {
    return data(
      { success: false, message: insertDocuments.error.message },
      { status: 500 }
    );
  }

  return { success: true, message: "Successfully seeded documents" };
}
