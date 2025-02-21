import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  Heading,
  IconButton,
  VStack,
  useDisclosure,
} from "@carbon/react";

import { Await, Link, useParams } from "@remix-run/react";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Procedure } from "../../types";
import ProcedureStatus from "./ProcedureStatus";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense, useEffect } from "react";
import {
  LuChevronDown,
  LuCirclePlus,
  LuGitPullRequestArrow,
  LuPanelLeft,
  LuPanelRight,
} from "react-icons/lu";
import ProcedureForm from "./ProcedureForm";
import { usePanels } from "~/components/Layout";

const ProcedureHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    procedure: Procedure;
    versions: PostgrestResponse<Procedure>;
  }>(path.to.procedure(id));

  const permissions = usePermissions();
  const { toggleExplorer, toggleProperties } = usePanels();
  const newVersionDisclosure = useDisclosure();

  useEffect(() => {
    newVersionDisclosure.onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <IconButton
            aria-label="Toggle Explorer"
            icon={<LuPanelLeft />}
            onClick={toggleExplorer}
            variant="ghost"
          />
          <Heading size="h4" className="flex items-center gap-2">
            <span>{routeData?.procedure?.name}</span>
            <Badge variant="gray">V{routeData?.procedure?.version}</Badge>
            <ProcedureStatus status={routeData?.procedure?.status} />
          </Heading>
        </HStack>
      </VStack>
      <div className="flex flex-shrink-0 gap-1 items-center justify-end">
        <Suspense fallback={null}>
          <Await resolve={routeData?.versions}>
            {(versions) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    leftIcon={<LuGitPullRequestArrow />}
                    rightIcon={<LuChevronDown />}
                  >
                    Versions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {permissions.can("create", "production") && (
                    <DropdownMenuItem onClick={newVersionDisclosure.onOpen}>
                      <DropdownMenuIcon icon={<LuCirclePlus />} />
                      New Version
                    </DropdownMenuItem>
                  )}
                  {versions?.data && versions.data.length > 0 && (
                    <>
                      <DropdownMenuLabel>Version History</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {versions.data.map((version) => (
                        <Link
                          key={version.id}
                          to={path.to.procedure(version.id)}
                          className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                        >
                          <span className="mr-2">V{version.version}</span>
                          {version.name}
                        </Link>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </Await>
        </Suspense>
        <IconButton
          aria-label="Toggle Properties"
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
            copyFromId: routeData?.procedure?.id ?? "",
          }}
          open={newVersionDisclosure.isOpen}
          onClose={newVersionDisclosure.onClose}
        />
      )}
    </div>
  );
};

export default ProcedureHeader;
