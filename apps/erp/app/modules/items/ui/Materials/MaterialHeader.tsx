import {
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Suspense } from "react";
import { LuEllipsisVertical, LuHistory, LuTrash } from "react-icons/lu";
import { Await, Link, useParams } from "react-router";
import { AuditLogDrawer } from "~/components/AuditLog";
import { DetailsTopbar } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import type { Material } from "../../types";
import { useMaterialNavigation } from "./useMaterialNavigation";

const MaterialHeader = () => {
  const links = useMaterialNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const { company } = useUser();
  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const auditDrawer = useDisclosure();

  const routeData = useRouteData<{ materialSummary: Material }>(
    path.to.material(itemId)
  );

  const rootRouteData = useRouteData<{
    auditLogEnabled: Promise<boolean>;
  }>(path.to.authenticatedRoot);

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Link to={path.to.materialDetails(itemId)}>
            <Heading size="h4" className="flex items-center gap-2">
              {/* <ModuleIcon icon={<MethodItemTypeIcon type="Material" />} /> */}
              <span>{routeData?.materialSummary?.readableIdWithRevision}</span>
            </Heading>
          </Link>
          <Copy
            text={routeData?.materialSummary?.readableIdWithRevision ?? ""}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label="More options"
                icon={<LuEllipsisVertical />}
                variant="secondary"
                size="sm"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <Suspense fallback={null}>
                <Await resolve={rootRouteData?.auditLogEnabled}>
                  {(auditLogEnabled) => {
                    return (
                      <>
                        {auditLogEnabled && (
                          <DropdownMenuItem onClick={auditDrawer.onOpen}>
                            <DropdownMenuIcon icon={<LuHistory />} />
                            History
                          </DropdownMenuItem>
                        )}
                      </>
                    );
                  }}
                </Await>
              </Suspense>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={
                  !permissions.can("delete", "parts") ||
                  !permissions.is("employee")
                }
                destructive
                onClick={deleteModal.onOpen}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                Delete Material
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HStack>
      </VStack>
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        <DetailsTopbar links={links} />
      </VStack>
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteItem(itemId)}
          isOpen={deleteModal.isOpen}
          name={
            routeData?.materialSummary?.readableIdWithRevision ?? "material"
          }
          text={`Are you sure you want to delete ${routeData?.materialSummary?.readableIdWithRevision}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
      {auditDrawer.isOpen && company?.id && (
        <AuditLogDrawer
          isOpen={auditDrawer.isOpen}
          onClose={auditDrawer.onClose}
          entityType="item"
          entityId={itemId}
          companyId={company.id}
        />
      )}
    </div>
  );
};

export default MaterialHeader;
