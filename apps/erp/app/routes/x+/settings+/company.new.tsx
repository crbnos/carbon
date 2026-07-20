import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { updateCompanySession } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { getLocalTimeZone } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { insertEmployeeJob } from "~/modules/people";
import { upsertLocation } from "~/modules/resources";
import {
  companyValidator,
  insertCompany,
  seedCompany
} from "~/modules/settings";
import { getPermissionCacheKey } from "~/modules/users/users.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "settings", "company");

export async function action({ request }: ActionFunctionArgs) {
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

  const seed = await seedCompany(client, companyId, userId);
  if (seed.error) {
    logger.error("Failed to seed company", { error: seed.error });
    throw new Error("Fatal: failed to seed company");
  }

  // TODO: move all of this to transaction
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { baseCurrencyCode, ...locationData } = validation.data;
  const locationInsert = await upsertLocation(client, {
    ...locationData,
    name: "Headquarters",
    companyId,
    timezone: getLocalTimeZone(),
    createdBy: userId
  });

  if (locationInsert.error) {
    logger.error("Failed to insert location", { error: locationInsert.error });
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
}
