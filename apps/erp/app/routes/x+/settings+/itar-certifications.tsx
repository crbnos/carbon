import { CONTROLLED_ENVIRONMENT, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  ItarCertificationsTable,
  ItarEntityCertificationStatus
} from "~/modules/settings";
import {
  getItarCertificationReport,
  getItarEntityCertification
} from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`ITAR Certifications`,
  to: path.to.itarCertifications
};

/**
 * Last login is not stored in the app DB — it lives in Supabase Auth. Page
 * through the admin API (service role) and index by user id. This is a full
 * scan of the auth users; acceptable for an occasional compliance report.
 */
async function getLastLoginByUserId(): Promise<Map<string, string | null>> {
  const serviceRole = getCarbonServiceRole();
  const map = new Map<string, string | null>();
  const perPage = 1000;
  const maxPages = 50; // ~50k users backstop against an unbounded loop

  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await serviceRole.auth.admin.listUsers({
      page,
      perPage
    });
    if (error || !data?.users?.length) break;
    for (const user of data.users) {
      map.set(user.id, user.last_sign_in_at ?? null);
    }
    if (data.users.length < perPage) break;
  }

  return map;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  // Controlled environments only.
  if (!CONTROLLED_ENVIRONMENT) {
    throw redirect(path.to.settings);
  }

  const [report, entityCertification, lastLoginByUserId] = await Promise.all([
    getItarCertificationReport(client, companyId),
    getItarEntityCertification(client, companyId),
    getLastLoginByUserId()
  ]);

  // Never render this page from a failed read. A missing entity row and a failed
  // entity query both arrive as "no data", but they mean opposite things: the
  // first is a company that has not signed the Rider, the second is a company
  // whose status we do not know. Reporting the second as "Pending" would put a
  // false compliance finding in front of an auditor, so fail the page instead.
  if (report.error) {
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(report.error, "Failed to load ITAR certifications")
      )
    );
  }

  if (entityCertification.error) {
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(
          entityCertification.error,
          "Failed to load the entity certification"
        )
      )
    );
  }

  const rows = (report.data ?? []).map((row) => ({
    ...row,
    lastLogin: row.id ? (lastLoginByUserId.get(row.id) ?? null) : null
  }));

  return {
    data: rows,
    count: rows.length,
    entityCertification: entityCertification.data ?? null
  };
}

export default function ItarCertificationsRoute() {
  const { data, count, entityCertification } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ItarEntityCertificationStatus certification={entityCertification} />
      <ItarCertificationsTable data={data} count={count} />
    </VStack>
  );
}
