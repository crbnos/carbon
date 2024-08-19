import { redis } from "@carbon/redis";
import { validationError, validator } from "@carbon/remix-validated-form";
import { getLocalTimeZone } from "@internationalized/date";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import logger from "~/lib/logger";
import { getSupabaseServiceRole } from "~/lib/supabase";
import { insertEmployeeJob } from "~/modules/people";
import { upsertLocation } from "~/modules/resources";
import {
  companyValidator,
  insertCompany,
  seedCompany,
} from "~/modules/settings";
import { getPermissionCacheKey } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { updateCompanySession } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: ["settings", "users"],
  });
  const formData = await request.formData();
  const validation = await validator(companyValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  const client = getSupabaseServiceRole();

  const companyInsert = await insertCompany(client, validation.data);
  if (companyInsert.error) {
    logger.error(companyInsert.error);
    throw new Error("Fatal: failed to insert company");
  }

  let companyId = companyInsert.data?.id;
  if (!companyId) {
    throw new Error("Fatal: failed to get company ID");
  }

  const seed = await seedCompany(client, companyId, userId);
  if (seed.error) {
    logger.error(seed.error);
    throw new Error("Fatal: failed to seed company");
  }

  // TODO: move all of this to transaction
  const [locationInsert] = await Promise.all([
    upsertLocation(client, {
      ...validation.data,
      name: "Headquarters",
      companyId,
      timezone: getLocalTimeZone(),
      createdBy: userId,
    }),
  ]);

  if (locationInsert.error) {
    logger.error(locationInsert.error);
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
      locationId,
    }),
    redis.del(getPermissionCacheKey(userId)),
  ]);

  if (job.error) {
    logger.error(job.error);
    throw new Error("Fatal: failed to insert job");
  }

  throw redirect(path.to.authenticatedRoot, {
    headers: {
      "Set-Cookie": await updateCompanySession(request, companyId),
    },
  });
}
