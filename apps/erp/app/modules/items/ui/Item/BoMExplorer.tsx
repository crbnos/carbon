import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { LuDownload, LuEllipsisVertical } from "react-icons/lu";
import { useParams, useSearchParams } from "react-router";
import {
  BoMExplorerActions,
  BoMExplorerProvider,
  BoMExplorerSearch,
  BoMExplorerTree,
  BoMExportMenuItems,
  useBoMExplorer
} from "~/components/BoMExplorer";
import { OnshapeSync } from "~/components/OnshapeSync";
import type { FlatTreeItem } from "~/components/TreeView";
import { useIntegrations } from "~/hooks/useIntegrations";
import type { ItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import type { MakeMethod, Method } from "../../types";

type BoMExplorerProps = {
  itemType: ItemType;
  makeMethod: MakeMethod;
  methods: FlatTreeItem<Method>[];
  methodId?: string;
  filterText?: string;
  hideSearch?: boolean;
};

const BoMExplorer = ({
  itemType,
  makeMethod,
  methods,
  methodId: methodIdProp,
  filterText,
  hideSearch
}: BoMExplorerProps) => {
  const params = useParams();

  const { itemId } = params;
  if (!itemId) throw new Error("itemId not found");
  const methodId = methodIdProp ?? params.methodId;
  if (!methodId) throw new Error("methodId not found");

  const {
    id: makeMethodId,
    version: makeMethodVersion,
    status: makeMethodStatus
  } = makeMethod;

  const getNodePath = (node: FlatTreeItem<Method>) =>
    node.data.isRoot
      ? getRootLink(itemType, itemId, methodId)
      : getMaterialLink(
          itemType,
          itemId,
          methodId,
          node.data.replenishmentSystem !== "Buy"
            ? node.data.materialMakeMethodId
            : node.data.makeMethodId
        );

  return (
    <BoMExplorerProvider
      tree={methods}
      getNodePath={getNodePath}
      getRootVersion={() => makeMethodVersion}
      filterText={filterText}
    >
      <ItemBoMExplorerContent
        methods={methods}
        makeMethodId={makeMethodId}
        makeMethodStatus={makeMethodStatus}
        itemId={itemId}
        hideSearch={hideSearch}
      />
    </BoMExplorerProvider>
  );
};

export default BoMExplorer;

function ItemBoMExplorerContent({
  methods,
  makeMethodId,
  makeMethodStatus,
  itemId,
  hideSearch
}: {
  methods: FlatTreeItem<Method>[];
  makeMethodId: string;
  makeMethodStatus: MakeMethod["status"];
  itemId: string;
  hideSearch?: boolean;
}) {
  const integrations = useIntegrations();
  const params = useParams();
  const { selectNode, deselectAllNodes } = useBoMExplorer();

  const [searchParams] = useSearchParams();
  const selectedMaterialId = searchParams.get("materialId");
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (!selectedMaterialId) {
      deselectAllNodes();
      return;
    }

    if (selectedMaterialId) {
      const node = methods.find(
        (m) => m.data.methodMaterialId === selectedMaterialId
      );
      if (node?.id) selectNode(node?.id);
    } else if (params.methodId) {
      const node = methods.find(
        (m) => m.data.materialMakeMethodId === params.methodId
      );
      if (node?.id) selectNode(node?.id);
    }
  }, [selectedMaterialId, params.methodId]);

  return (
    <VStack className="h-full">
      {!hideSearch && (
        <HStack className="w-full justify-between flex-shrink-0">
          <BoMExplorerSearch />
          <BoMExplorerActions>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <DropdownMenuIcon icon={<LuDownload />} />
                <Trans>Export</Trans>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <BoMExportMenuItems
                  csvHref={(withOperations) =>
                    path.to.api.billOfMaterialsCsv(makeMethodId, withOperations)
                  }
                  jsonHref={(withOperations) =>
                    path.to.api.billOfMaterials(makeMethodId, withOperations)
                  }
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </BoMExplorerActions>
        </HStack>
      )}
      {integrations.has("onshape") && (
        <div className="flex flex-shrink-0 w-full">
          <OnshapeSync
            makeMethodId={makeMethodId}
            itemId={itemId}
            isDisabled={makeMethodStatus !== "Draft"}
          />
        </div>
      )}
      <BoMExplorerTree />
    </VStack>
  );
}

export function BoMActions({ makeMethodId }: { makeMethodId: string }) {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={t`Actions`}
          variant="secondary"
          size="sm"
          icon={<LuEllipsisVertical />}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <DropdownMenuIcon icon={<LuDownload />} />
            <Trans>Export</Trans>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <BoMExportMenuItems
              csvHref={(withOperations) =>
                path.to.api.billOfMaterialsCsv(makeMethodId, withOperations)
              }
              jsonHref={(withOperations) =>
                path.to.api.billOfMaterials(makeMethodId, withOperations)
              }
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getRootLink(itemType: ItemType, itemId: string, methodId: string) {
  switch (itemType) {
    case "Part":
      return `${path.to.partDetails(itemId)}?methodId=${methodId}`;
    case "Tool":
      return `${path.to.toolDetails(itemId)}?methodId=${methodId}`;
    case "Service":
      return `${path.to.serviceDetails(itemId)}?methodId=${methodId}`;
    default:
      throw new Error(`Unimplemented BoMExplorer itemType: ${itemType}`);
  }
}

function getMaterialLink(
  itemType: ItemType,
  itemId: string,
  methodId: string,
  makeMethodId: string
) {
  switch (itemType) {
    case "Part":
      return `${path.to.partMake(itemId, makeMethodId)}?methodId=${methodId}`;
    case "Tool":
      return `${path.to.toolMake(itemId, makeMethodId)}?methodId=${methodId}`;
    case "Service":
      return `${path.to.serviceMake(itemId, makeMethodId)}?methodId=${methodId}`;
    default:
      throw new Error(`Unimplemented BoMExplorer itemType: ${itemType}`);
  }
}
