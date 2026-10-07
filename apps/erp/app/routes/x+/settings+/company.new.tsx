// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { updateCompanySession } from "@carbon/auth/session.server";
import { enableAuditLog } from "@carbon/ee/audit.server";
import { validationError, validator } from "@carbon/form";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { insertEmployeeJob } from "~/modules/people";
import { upsertLocation } from "~/modules/resources";
import {
  companyValidator,
  insertCompany,
  seedCompany
} from "~/modules/settings";
import { getPermissionCacheKey } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "settings", "company");

// The form lives in the topbar and only posts here. A tab left open across a
// deployment cannot submit it: React Router reloads the document at this URL
// instead, which without a loader is a 400. Send that reload back to the page
// it came from.
export function loader({ request }: LoaderFunctionArgs) {
  const referrer = requestReferrer(request);
  throw redirect(
    referrer && !referrer.startsWith(path.to.newCompany)
      ? referrer
      : path.to.authenticatedRoot
  );
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertIsPost(request);
    const { userId } = await requirePermissions(request, {
      update: ["settings", "users"]
    });
    const formData = await request.formData();
    const validation = await validator(companyValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const client = getCarbonServiceRole();

    const companyInsert = await insertCompany(client, validation.data);
    if (companyInsert.error) {
      logger.error("Failed to insert company", { error: companyInsert.error });
      throw new Error("Fatal: failed to insert company");
    }

    let companyId = companyInsert.data?.id;
    if (!companyId) {
      throw new Error("Fatal: failed to get company ID");
    }

    const seed = await seedCompany(
      client,
      getDatabaseClient(),
      companyId,
      userId
    );
    if (seed.error) {
      logger.error("Failed to seed company", { error: seed.error });
      throw new Error("Fatal: failed to seed company");
    }

    // Controlled environments (ITAR/CUI, NIST 800-171 3.3.1) capture audit from
    // day one — enable it at company creation, not just when settings are opened.
    if (CONTROLLED_ENVIRONMENT) {
      await enableAuditLog(client, companyId).catch((err) =>
        logger.error("Failed to enable audit log for new company", {
          error: err
        })
      );
    }

    // TODO: move all of this to transaction
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    const { baseCurrencyCode, ...locationData } = validation.data;
    const locationInsert = await upsertLocation(client, {
      ...locationData,
      name: "Headquarters",
      companyId,
      // timezone comes from locationData — HQ shares the company's timezone.
      createdBy: userId
    });

    if (locationInsert.error) {
      logger.error("Failed to insert location", {
        error: locationInsert.error
      });
      throw new Error("Fatal: failed to insert location");
    }

    const locationId = locationInsert.data?.id;
    if (!locationId) {
      throw new Error("Fatal: failed to get location ID");
    }

    const [job] = await Promise.all([
      insertEmployeeJob(client, {
        id: userId,
        companyId,
        locationId
      }),
      redis.del(getPermissionCacheKey(userId))
    ]);

    if (job.error) {
      logger.error("Failed to insert job", { error: job.error });
      throw new Error("Fatal: failed to insert job");
    }

    const { data: companyRecord } = await client
      .from("company")
      .select("companyGroupId")
      .eq("id", companyId)
      .single();

    const sessionCookie = await updateCompanySession(
      request,
      companyId,
      companyRecord?.companyGroupId ?? ""
    );
    const companyIdCookie = setCompanyId(companyId);

    throw redirect(path.to.authenticatedRoot, {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    });
  } catch (error) {
    // Thrown Response = React Router control flow (the success redirect above,
    // or validationError) — rethrow untouched or the client gets nothing.
    if (error instanceof Response) throw error;
    logger.error("Company create failed: {message}", {
      message: error instanceof Error ? error.message : String(error),
      error
    });
    throw error;
  }
}
