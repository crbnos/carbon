import { HStack, Spinner, VStack } from "@carbon/react";
import { createContext, useContext, useEffect, useState } from "react";
import { useFetchers, useParams, useSearchParams } from "react-router";
import type { BoMExplorerNodeData } from "~/components/BoMExplorer";
import {
  BoMExplorerActions,
  BoMExplorerProvider,
  BoMExplorerRow,
  BoMExplorerSearch,
  BoMExplorerTree,
  BoMExportMenuItems,
  useBoMExplorer
} from "~/components/BoMExplorer";
import type { FlatTree, FlatTreeItem } from "~/components/TreeView";
import { useOptimisticLocation } from "~/hooks";
import { path } from "~/utils/path";
import type { JobMethod } from "../../production.service";
import type { ItemOrderStatus } from "../../types";
import { JobOrderStatusBadge } from "./JobOrderStatus";

// Keyed by material id (= the tree node's methodMaterialId); built by the loader.
export type JobOrderStatusData = Record<string, ItemOrderStatus>;

const OrderStatusContext = createContext<JobOrderStatusData>({});

type JobBoMExplorerProps = {
  method: FlatTree<JobMethod>;
  orderStatus?: Promise<JobOrderStatusData>;
};

const JobBoMExplorer = ({ method, orderStatus }: JobBoMExplorerProps) => {
  const [orderStatusData, setOrderStatusData] =
    useState<JobOrderStatusData | null>(null);

  // Streamed as a promise so the tree renders before the badges resolve.
  useEffect(() => {
    if (!orderStatus) return;
    const promise = orderStatus;
    let active = true;
    async function resolveOrderStatus() {
      try {
        const data = await promise;
        if (active) setOrderStatusData(data);
      } catch {
        // Ignore — purchased items simply render without an order badge.
      }
    }
    resolveOrderStatus();
    return () => {
      active = false;
    };
  }, [orderStatus]);

  return (
    <OrderStatusContext.Provider value={orderStatusData ?? {}}>
      <BoMExplorerProvider tree={method} getNodePath={getNodePath}>
        <JobBoMExplorerContent method={method} />
      </BoMExplorerProvider>
    </OrderStatusContext.Provider>
  );
};

export default JobBoMExplorer;

function JobBoMExplorerContent({ method }: { method: FlatTree<JobMethod> }) {
  const location = useOptimisticLocation();
  const { jobId, methodId } = useParams();
  const { selectNode, deselectAllNodes } = useBoMExplorer();

  const fetchers = useFetchers();
  const getMethodFetcher = fetchers.find(
    (f) => f.formAction === path.to.jobMethodGet
  );
  const isLoading = getMethodFetcher?.state === "loading";

  const [searchParams] = useSearchParams();
  const selectedMaterialId = searchParams.get("materialId");
  const isDetailsRoute =
    jobId && location.pathname === path.to.jobDetails(jobId);

  // biome-ignore lint/correctness/useExhaustiveDependencies: supress
  useEffect(() => {
    if (!selectedMaterialId) {
      if (isDetailsRoute) {
        const rootNode = method.find((m) => m.data.isRoot);
        if (rootNode) {
          selectNode(rootNode.id);
          return;
        }
      }
      deselectAllNodes();
      return;
    }

    if (selectedMaterialId) {
      const node = method.find(
        (m) => m.data.methodMaterialId === selectedMaterialId
      );
      if (node) {
        selectNode(node.id);
      }
    } else if (methodId) {
      const node = method.find(
        (m) => m.data.jobMaterialMakeMethodId === methodId
      );
      if (node) {
        selectNode(node.id);
      }
    }
  }, [selectedMaterialId, methodId, location.pathname, jobId]);

  return (
    <VStack className="flex-1 h-full w-full">
      {isLoading ? (
        <div className="flex items-center justify-center py-8 w-full">
          <Spinner className="w-4 h-4" />
        </div>
      ) : (
        <>
          <HStack className="w-full flex-shrink-0">
            <BoMExplorerSearch />
            {jobId && (
              <BoMExplorerActions triggerVariant="ghost">
                <BoMExportMenuItems
                  csvHref={(withOperations) =>
                    path.to.api.jobBillOfMaterialsCsv(jobId, withOperations)
                  }
                  jsonHref={(withOperations) =>
                    path.to.api.jobBillOfMaterials(jobId, withOperations)
                  }
                />
              </BoMExplorerActions>
            )}
          </HStack>
          <BoMExplorerTree>
            {({ node, state }) => (
              <BoMExplorerRow node={node} state={state}>
                <JobNodeOrderStatus node={node} />
              </BoMExplorerRow>
            )}
          </BoMExplorerTree>
        </>
      )}
    </VStack>
  );
}

function JobNodeOrderStatus({
  node
}: {
  node: FlatTreeItem<BoMExplorerNodeData>;
}) {
  const orderStatusByMaterialId = useContext(OrderStatusContext);

  // Show the procurement badge for any material that has order status —
  // purchased, pulled from inventory, or a buy-and-make part. Make to Order
  // materials are manufactured, not procured, so they never show a status icon.
  if (node.data.isRoot || node.data.methodType === "Make to Order") return null;

  const orderStatus = node.data.methodMaterialId
    ? orderStatusByMaterialId[node.data.methodMaterialId]
    : undefined;

  return <JobOrderStatusBadge status={orderStatus} />;
}

function getNodePath(node: FlatTreeItem<JobMethod>) {
  return node.data.isRoot
    ? path.to.jobDetails(node.data.jobId)
    : node.data.methodType === "Make to Order"
      ? path.to.jobMakeMethod(
          node.data.jobId,
          node.data.jobMaterialMakeMethodId
        )
      : path.to.jobMakeMethod(node.data.jobId, node.data.jobMakeMethodId);
}
