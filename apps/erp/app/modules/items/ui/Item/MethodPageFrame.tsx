// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { LuChevronLeft, LuChevronRight, LuLock } from "react-icons/lu";
import { Link, useLocation, useNavigate } from "react-router";
import { ConfigurationEditor } from "~/components/Configurator/ConfigurationEditor";
import type { Configuration } from "~/components/Configurator/types";
import { usePermissions } from "~/hooks";
import type { PartMethodPage } from "../../items.service";
import {
  ChangeNoticeDraftLockReason,
  getChangeNoticeDraftLock
} from "../ChangeNotice";
import MakeMethodTools from "./MakeMethodTools";
import { getAdjacentLineIds, getMethodSearch } from "./methodPageUtils";
import ReleaseLockAlert, { getReleaseLockFlags } from "./ReleaseLockAlert";

/** The read-only rules of today's editors, in one place for the method tabs. */
export function useMethodAccess(page: PartMethodPage) {
  const permissions = usePermissions();
  const { isProductionRevision, isReleaseLocked } = getReleaseLockFlags({
    revisionStatus: page.revisionStatus,
    releaseControl: page.releaseControl
  });
  const draftLock = getChangeNoticeDraftLock(
    page.makeMethod.changeOrderId,
    page.changeNotices
  );
  const isReadOnly =
    permissions.can("update", "parts") === false ||
    page.makeMethod.status !== "Draft" ||
    isReleaseLocked ||
    !!draftLock;

  return { draftLock, isProductionRevision, isReleaseLocked, isReadOnly };
}

/** Opens the configuration editor for a field. Render `editor` once. */
export function useMethodConfigurator(page: PartMethodPage) {
  const disclosure = useDisclosure();
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null
  );

  const onConfigure = (next: Configuration) => {
    flushSync(() => setConfiguration(next));
    disclosure.onOpen();
  };

  return {
    onConfigure,
    rulesByField: new Map(page.configurationRules.map((r) => [r.field, r])),
    editor:
      disclosure.isOpen && configuration ? (
        <ConfigurationEditor
          configuration={configuration}
          open={disclosure.isOpen}
          parameters={page.configurationParameters}
          onClose={disclosure.onClose}
        />
      ) : null
  };
}

export function MethodLockHint({ page }: { page: PartMethodPage }) {
  const { draftLock, isReadOnly } = useMethodAccess(page);
  if (!isReadOnly) return null;

  return (
    <Tooltip>
      <TooltipTrigger className="text-muted-foreground">
        <LuLock />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {page.makeMethod.status !== "Draft" ? (
          <Trans>
            This method version is read-only. Create a new version from the
            method menu to make changes.
          </Trans>
        ) : draftLock ? (
          <ChangeNoticeDraftLockReason lock={draftLock} />
        ) : (
          <Trans>You don't have permission to edit this method.</Trans>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function MethodReleaseAlert({ page }: { page: PartMethodPage }) {
  const { isProductionRevision, isReleaseLocked } = useMethodAccess(page);
  return isProductionRevision ? (
    <ReleaseLockAlert isLocked={isReleaseLocked} className="w-full" />
  ) : null;
}

export function MethodPageToolbar({ page }: { page: PartMethodPage }) {
  const location = useLocation();
  const { makeMethod, isSubAssembly, versions } = page;

  const getVersionPath = (versionId: string) => {
    const params = new URLSearchParams(getMethodSearch(location.search));
    params.set(isSubAssembly ? "makeMethodId" : "methodId", versionId);
    return `${location.pathname}?${params.toString()}`;
  };

  return (
    <>
      <MakeMethodTools
        itemId={makeMethod.itemId}
        makeMethods={versions}
        type="Part"
        currentMethodId={makeMethod.id}
        getVersionPath={getVersionPath}
      />
      <MethodReleaseAlert page={page} />
    </>
  );
}

/** One line above an opened line: where it sits, what it is, the next line. */
export function MethodLineNav({
  page,
  backLabel,
  backTo,
  title,
  subtitle,
  lineIds,
  currentId,
  getLinePath
}: {
  page: PartMethodPage;
  backLabel: ReactNode;
  backTo: string;
  title: ReactNode;
  subtitle?: ReactNode;
  lineIds: string[];
  currentId: string;
  getLinePath: (id: string) => string;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  // Next and previous keep the open tab, so a tab can be read line by line.
  const { search } = useLocation();
  const { previousId, nextId } = getAdjacentLineIds(lineIds, currentId);

  return (
    <>
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Link
            to={`${backTo}${getMethodSearch(search)}`}
            className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <LuChevronLeft className="size-4" />
            <span className="max-md:hidden">{backLabel}</span>
          </Link>
          <span className="text-muted-foreground max-md:hidden">/</span>
          <h2 className="truncate font-medium">{title}</h2>
          {subtitle && (
            <span className="truncate text-muted-foreground max-md:hidden">
              {subtitle}
            </span>
          )}
        </div>
        <HStack spacing={2} className="shrink-0">
          <MethodLockHint page={page} />
          <HStack spacing={1}>
            <IconButton
              aria-label={t`Previous`}
              icon={<LuChevronLeft />}
              variant="secondary"
              isDisabled={!previousId}
              onClick={() =>
                previousId && navigate(`${getLinePath(previousId)}${search}`)
              }
            />
            <IconButton
              aria-label={t`Next`}
              icon={<LuChevronRight />}
              variant="secondary"
              isDisabled={!nextId}
              onClick={() =>
                nextId && navigate(`${getLinePath(nextId)}${search}`)
              }
            />
          </HStack>
        </HStack>
      </div>
      <MethodReleaseAlert page={page} />
    </>
  );
}
