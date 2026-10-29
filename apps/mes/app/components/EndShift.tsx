// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { useCarbon } from "@carbon/auth";
import { Button, NavRailItem, Spinner, toast } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { LuCircleStop } from "react-icons/lu";
import { useFetcher } from "react-router";
import { useUser } from "~/hooks";
import type { action as endShiftAction } from "~/routes/x+/end-shift";
import { getActiveJobOperationsByEmployee } from "~/services/operations.service";
import type { Operation } from "~/services/types";
import { path } from "~/utils/path";
import { ToolSurface, useToolSurface } from "./MoreSheet";

export function EndShift() {
  const { t } = useLingui();
  const surface = useToolSurface("end-operations", t`End Operations`);
  const fetcher = useFetcher<typeof endShiftAction>();
  const user = useUser();

  const { carbon } = useCarbon();
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (fetcher.data?.success === true) {
      surface.done();
      toast.success(fetcher.data?.message ?? t`Operations ended`);
    }

    if (fetcher.data?.success === false) {
      toast.error(fetcher.data?.message ?? t`Failed to end operations`);
    }
  }, [fetcher.data?.success]);

  const openModal = async () => {
    flushSync(() => {
      setLoading(true);
      surface.open();
    });

    if (!carbon) return;
    const { data, error } = await getActiveJobOperationsByEmployee(carbon, {
      employeeId: user.id,
      companyId: user.company.id
    });
    if (error) {
      toast.error(t`Failed to fetch active operations`);
    }
    setOperations((data ?? []) as Operation[]);
    setLoading(false);
  };

  const description = (
    <Trans>
      Are you sure you want to end all production events? This will end all
      active operations without completing or finishing them.
    </Trans>
  );
  const list = loading ? (
    <div className="flex items-center justify-center w-full h-24">
      <Spinner />
    </div>
  ) : operations?.length === 0 ? (
    <div className="flex items-center justify-center w-full h-24 text-muted-foreground">
      <Trans>No active operations</Trans>
    </div>
  ) : (
    <div className="flex flex-col gap-4">
      {operations.map((operation) => (
        <div
          key={operation.id}
          className="flex items-start justify-between p-4 rounded-lg border"
        >
          <div className="flex flex-col gap-1">
            <div className="font-medium">{operation.jobReadableId}</div>
            <div className="text-sm text-muted-foreground">
              {operation.description}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-sm text-muted-foreground">
              {operation.itemReadableId}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
  const actions = (
    <>
      <Button type="button" onClick={surface.close} variant="secondary">
        <Trans>Cancel</Trans>
      </Button>
      <Button
        type="submit"
        isDisabled={fetcher.state !== "idle"}
        isLoading={fetcher.state !== "idle"}
        variant="destructive"
      >
        <Trans>End Operations</Trans>
      </Button>
    </>
  );

  return (
    <>
      <NavRailItem
        icon={<LuCircleStop />}
        label={t`End Operations`}
        onClick={openModal}
      />
      <ToolSurface
        surface={surface}
        description={description}
        body={list}
        footer={actions}
        wrap={(children) => (
          <fetcher.Form method="post" action={path.to.endShift}>
            {children}
          </fetcher.Form>
        )}
      />
    </>
  );
}
