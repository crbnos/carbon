// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { getActiveMethodsMissingPullFrom } from "~/modules/settings/settings.service";
import { MethodsMissingPullFromTable } from "~/modules/settings/ui/StrictBackflush";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import { pageInMemory } from "~/utils/query";

const logger = getLogger("erp", "settings-items");

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const methods = await getActiveMethodsMissingPullFrom(
    getDatabaseClient(),
    companyId
  );
  if (methods.error) {
    logger.error("Failed to read methods missing a Pull From", {
      companyId,
      error: methods.error
    });
    // An empty table would read as "nothing to fix".
    throw redirect(
      path.to.itemsSettings,
      await flash(
        request,
        error(methods.error, "Failed to load the methods missing a Pull From")
      )
    );
  }

  const page = pageInMemory(
    methods.data ?? [],
    new URL(request.url).searchParams,
    (method) => [
      method.readableId,
      method.name,
      ...method.materials,
      ...method.locations
    ]
  );
  return { methods: page.rows, count: page.count };
}

export default function MethodsMissingPullFromRoute() {
  const { methods, count } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.itemsSettings);
      }}
    >
      <DrawerContent size="xl">
        <DrawerHeader>
          <DrawerTitle>
            <Trans>Active Methods Missing a Pull From</Trans>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="p-0 max-md:p-0">
          <MethodsMissingPullFromTable data={methods} count={count} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
