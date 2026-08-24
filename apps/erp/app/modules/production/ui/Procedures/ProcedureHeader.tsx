import {
  Badge,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense, useEffect } from "react";
import {
  LuEllipsisVertical,
  LuPanelLeft,
  LuPanelRight,
  LuTrash
} from "react-icons/lu";
import { Await, useParams } from "react-router";
import { VersionMenu } from "~/components";
import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Procedure } from "../../types";
import ProcedureForm from "./ProcedureForm";
import ProcedureStatus from "./ProcedureStatus";

const ProcedureHeader = () => {
  const { id } = useParams();
  const { t } = useLingui();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    procedure: Procedure;
    versions: PostgrestResponse<Procedure>;
  }>(path.to.procedure(id));

  const permissions = usePermissions();
  const { toggleExplorer, toggleProperties } = usePanels();
  const newVersionDisclosure = useDisclosure();
  const deleteDisclosure = useDisclosure();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    newVersionDisclosure.onClose();
  }, [id]);

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <IconButton
            aria-label={t`Toggle Explorer`}
            icon={<LuPanelLeft />}
            onClick={toggleExplorer}
            variant="ghost"
          />
          <Heading size="h4" className="flex items-center gap-2">
            <span>{routeData?.procedure?.name}</span>
            <Badge variant="outline">V{routeData?.procedure?.version}</Badge>
            <ProcedureStatus status={routeData?.procedure?.status} />
          </Heading>
          <Copy text={routeData?.procedure?.name ?? ""} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`More options`}
                icon={<LuEllipsisVertical />}
                variant="secondary"
                size="sm"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                disabled={
                  !permissions.can("delete", "production") ||
                  !permissions.is("employee")
                }
                destructive
                onClick={deleteDisclosure.onOpen}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                <Trans>Delete Procedure</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HStack>
      </VStack>
      <div className="flex flex-shrink-0 gap-1 items-center justify-end">
        <Suspense fallback={null}>
          <Await resolve={routeData?.versions}>
            {(versions) => {
              const allVersions =
                versions?.data ??
                (routeData?.procedure ? [routeData.procedure] : []);
              return (
                <VersionMenu
                  versions={allVersions}
                  currentVersionId={id}
                  getKey={(v) => v.id}
                  getHref={(v) => path.to.procedure(v.id)}
                  renderLabel={(v) => (
                    <>
                      <Badge variant="outline">V{v.version}</Badge>
                      <span>{v.name}</span>
                    </>
                  )}
                  renderStatus={(v) => <ProcedureStatus status={v.status} />}
                  onNewVersion={
                    permissions.can("create", "production")
                      ? newVersionDisclosure.onOpen
                      : undefined
                  }
                />
              );
            }}
          </Await>
        </Suspense>
        <IconButton
          aria-label={t`Toggle Properties`}
          icon={<LuPanelRight />}
          onClick={toggleProperties}
          variant="ghost"
        />
      </div>
      {newVersionDisclosure.isOpen && (
        <ProcedureForm
          type="copy"
          initialValues={{
            name: routeData?.procedure?.name ?? "",
            version: (routeData?.procedure?.version ?? 0) + 1,
            processId: routeData?.procedure?.processId ?? "",
            content: JSON.stringify(routeData?.procedure?.content) ?? "",
            copyFromId: routeData?.procedure?.id ?? ""
          }}
          open={newVersionDisclosure.isOpen}
          onClose={newVersionDisclosure.onClose}
        />
      )}
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteProcedure(id)}
          isOpen={deleteDisclosure.isOpen}
          name={routeData?.procedure?.name ?? "procedure"}
          text={t`Are you sure you want to delete ${routeData?.procedure?.name}? This cannot be undone.`}
          onCancel={() => {
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
};

export default ProcedureHeader;
