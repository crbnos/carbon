import { HStack, Spinner, VStack } from "@carbon/react";
import { useEffect } from "react";
import { useFetchers, useParams, useSearchParams } from "react-router";
import {
  BoMExplorerProvider,
  BoMExplorerSearch,
  BoMExplorerTree,
  useBoMExplorer
} from "~/components/BoMExplorer";
import type { FlatTree, FlatTreeItem } from "~/components/TreeView";
import { useOptimisticLocation } from "~/hooks";
import { path } from "~/utils/path";
import type { QuoteMethod } from "../../types";

type QuoteBoMExplorerProps = {
  methods: FlatTree<QuoteMethod>;
  isSearchExpanded?: boolean;
  isAllExpanded?: boolean;
};

const QuoteBoMExplorer = ({
  methods,
  isSearchExpanded = false,
  isAllExpanded = false
}: QuoteBoMExplorerProps) => {
  return (
    <BoMExplorerProvider tree={methods} getNodePath={getNodePath}>
      <QuoteBoMExplorerContent
        methods={methods}
        isSearchExpanded={isSearchExpanded}
        isAllExpanded={isAllExpanded}
      />
    </BoMExplorerProvider>
  );
};

export default QuoteBoMExplorer;

function QuoteBoMExplorerContent({
  methods,
  isSearchExpanded,
  isAllExpanded
}: {
  methods: FlatTree<QuoteMethod>;
  isSearchExpanded: boolean;
  isAllExpanded: boolean;
}) {
  const location = useOptimisticLocation();
  const {
    selectNode,
    deselectAllNodes,
    expandAllBelowDepth,
    collapseAllBelowDepth
  } = useBoMExplorer();

  const fetchers = useFetchers();
  const getMethodFetcher = fetchers.find(
    (f) => f.formAction === path.to.quoteMethodGet
  );
  const isLoading =
    getMethodFetcher?.state === "loading" &&
    getMethodFetcher.formData?.get("quoteLineId") ===
      methods?.[0].data.quoteLineId;

  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to isAllExpanded changes
  useEffect(() => {
    if (isAllExpanded) {
      expandAllBelowDepth(0);
    } else {
      collapseAllBelowDepth(1);
    }
  }, [isAllExpanded]);

  const params = useParams();
  const [searchParams] = useSearchParams();
  const selectedMaterialId = searchParams.get("materialId");

  const explorerLineId = methods[0]?.data.quoteLineId;
  const isDetailsRouteForThisLine =
    params.quoteId &&
    params.lineId &&
    params.lineId === explorerLineId &&
    location.pathname === path.to.quoteLine(params.quoteId, params.lineId);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (!selectedMaterialId) {
      if (isDetailsRouteForThisLine) {
        const rootNode = methods.find((m) => m.data.isRoot);
        if (rootNode) {
          selectNode(rootNode.id);
          return;
        }
      }
      deselectAllNodes();
      return;
    }

    const node = methods.find(
      (m) => m.data.methodMaterialId === selectedMaterialId
    );
    if (node?.id) {
      selectNode(node.id);
    } else if (params.methodId) {
      const methodNode = methods.find(
        (m) => m.data.quoteMaterialMakeMethodId === params.methodId
      );
      if (methodNode?.id) {
        selectNode(methodNode.id);
      } else {
        deselectAllNodes();
      }
    } else {
      deselectAllNodes();
    }
  }, [selectedMaterialId, params.methodId, location.pathname]);

  return (
    <VStack className="flex flex-1 w-full">
      {isLoading ? (
        <div className="flex items-center justify-center py-8 w-full">
          <Spinner className="w-4 h-4" />
        </div>
      ) : (
        <>
          {isSearchExpanded && (
            <HStack className="w-full">
              <BoMExplorerSearch />
            </HStack>
          )}
          <BoMExplorerTree />
        </>
      )}
    </VStack>
  );
}

function getNodePath(node: FlatTreeItem<QuoteMethod>) {
  return node.data.isRoot
    ? path.to.quoteLine(node.data.quoteId, node.data.quoteLineId)
    : node.data.methodType === "Make to Order"
      ? path.to.quoteLineMakeMethod(
          node.data.quoteId,
          node.data.quoteLineId,
          node.data.quoteMaterialMakeMethodId
        )
      : path.to.quoteLineMakeMethod(
          node.data.quoteId,
          node.data.quoteLineId,
          node.data.quoteMakeMethodId
        );
}
