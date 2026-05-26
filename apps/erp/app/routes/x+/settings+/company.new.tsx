import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { updateCompanySession } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redis } from "@carbon/kv";
import { getLocalTimeZone } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { insertEmployeeJob } from "~/modules/people/people.service.server";
import { upsertLocation } from "~/modules/resources/resources.service.server";
import { companyValidator } from "~/modules/settings";
import {
  insertCompany,
  seedCompany
} from "~/modules/settings/settings.service.server";
import { getPermissionCacheKey } from "~/modules/users/users.server";
import { path } from "~/utils/path";

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

  const companyInsert = await insertCompany(validation.data);
  if (companyInsert.error) {
    console.error(companyInsert.error);
    throw new Error("Fatal: failed to insert company");
  }

  let companyId = companyInsert.data?.id;
  if (!companyId) {
    throw new Error("Fatal: failed to get company ID");
  }

  const seed = await seedCompany();
  if (seed.error) {
    console.error(seed.error);
    throw new Error("Fatal: failed to seed company");
  }

  // TODO: move all of this to transaction
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { baseCurrencyCode, ...locationData } = validation.data;
  const locationInsert = await upsertLocation({
    ...locationData,
    name: "Headquarters",
    companyId,
    timezone: getLocalTimeZone(),
    createdBy: userId
  });

  if (locationInsert.error) {
    console.error(locationInsert.error);
    throw new Error("Fatal: failed to insert location");
  }

  const locationId = locationInsert.data?.id;
  if (!locationId) {
    throw new Error("Fatal: failed to get location ID");
  }

  const [job] = await Promise.all([
    insertEmployeeJob({
      id: userId,
      locationId
    }),
    redis.del(getPermissionCacheKey(userId))
  ]);

  if (job.error) {
    console.error(job.error);
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
