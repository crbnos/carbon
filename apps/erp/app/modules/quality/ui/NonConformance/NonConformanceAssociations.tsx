import { useCarbon } from "@carbon/auth";
import { Combobox, Hidden, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  cn,
  Count,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Skeleton,
  toast,
  useDisclosure,
  useMount,
  VStack,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuChevronRight,
  LuCirclePlus,
  LuContainer,
  LuFileText,
  LuHandCoins,
  LuHardHat,
  LuQrCode,
  LuSearch,
  LuShoppingCart,
  LuSquareUser,
  LuTruck,
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Hyperlink } from "~/components";
import { Customer, Supplier } from "~/components/Form";
import { LevelLine } from "~/components/TreeView";
import { usePermissions } from "~/hooks";
import type { action as associationAction } from "~/routes/x+/non-conformance+/$id.association.new";
import { path } from "~/utils/path";
import { nonConformanceAssociationValidator } from "../../quality.models";

export function NonConformanceAssociationsSkeleton() {
  return (
    <div className="flex flex-col gap-1 w-full">
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-7 w-1/2" />
    </div>
  );
}

export type NonConformanceAssociationKey =
  | "jobOperations"
  | "purchaseOrderLines"
  | "salesOrderLines"
  | "shipmentLines"
  | "receiptLines"
  | "trackedEntities"
  | "customers"
  | "suppliers";

export type NonConformanceAssociationNode = {
  key: NonConformanceAssociationKey;
  name: string;
  pluralName: string;
  module: string;
  children: {
    id: string;
    type: string;
    readableId: string;
    lineId: string;
  }[];
};

export function NonConformanceAssociationsTree({
  tree,
  nonConformanceId,
  itemId,
}: {
  tree: NonConformanceAssociationNode[];
  nonConformanceId: string;
  itemId?: string;
}) {
  const [filterText, setFilterText] = useState("");

  return (
    <VStack>
      <HStack className="w-full py">
        <InputGroup size="sm" className="flex flex-grow">
          <InputLeftElement>
            <LuSearch className="h-4 w-4" />
          </InputLeftElement>
          <Input
            placeholder="Search..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </InputGroup>
      </HStack>
      <VStack spacing={0}>
        {tree
          .sort((a, b) => a.name.localeCompare(b.name))
          .filter((node) => {
            if (node.key === "trackedEntities" && !itemId) {
              return false;
            }

            return true;
          })
          .map((node) => (
            <NonConformanceAssociationItem
              key={node.key}
              filterText={filterText}
              itemId={itemId}
              node={node}
              nonConformanceId={nonConformanceId}
            />
          ))}
      </VStack>
    </VStack>
  );
}

export function NonConformanceAssociationItem({
  node,
  filterText,
  nonConformanceId,
  itemId,
}: {
  node: NonConformanceAssociationNode;
  filterText: string;
  nonConformanceId: string;
  itemId?: string;
}) {
  const newAssociationModal = useDisclosure();
  const [isExpanded, setIsExpanded] = useState(
    node.children.length > 0 && node.children.length < 10
  );
  const permissions = usePermissions();

  if (!permissions.can("view", node.module)) {
    return null;
  }

  const filteredChildren = node.children.filter((child) =>
    child.readableId.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <>
      <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-2 text-sm w-full">
        <button
          className="flex flex-grow cursor-pointer items-center overflow-hidden font-medium"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          <div className="h-8 w-4 flex items-center justify-center">
            <LuChevronRight
              className={cn("size-4", isExpanded && "rotate-90")}
            />
          </div>
          <div className="flex flex-grow items-center justify-between gap-2">
            <span>{node.pluralName}</span>
            {filteredChildren.length > 0 && (
              <Count count={filteredChildren.length} />
            )}
          </div>
        </button>
        {permissions.can("create", node.module) && (
          <IconButton
            aria-label="Add"
            size="sm"
            variant="ghost"
            icon={<LuCirclePlus />}
            className="ml-auto"
            onClick={() => {
              newAssociationModal.onOpen();
            }}
          />
        )}
      </div>

      {isExpanded && (
        <div className="flex flex-col w-full">
          {node.children.length === 0 ? (
            <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-4">
              <LevelLine isSelected={false} />
              <div className="text-xs text-muted-foreground">
                No {node.name.toLowerCase()} found
              </div>
            </div>
          ) : (
            filteredChildren.map((child, index) => (
              <Hyperlink
                key={index}
                to={getAssociationLink(child, node.key)}
                className="flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-1 gap-4 text-sm hover:bg-muted/90 w-full font-medium whitespace-nowrap"
              >
                <LevelLine isSelected={false} className="mr-2" />
                {getAssociationIcon(node.key)}
                <span className="truncate">{child.readableId}</span>
              </Hyperlink>
            ))
          )}
        </div>
      )}
      {newAssociationModal.isOpen && (
        <NewAssociationModal
          open={newAssociationModal.isOpen}
          onClose={newAssociationModal.onClose}
          type={node.key}
          name={node.name}
          itemId={itemId}
        />
      )}
    </>
  );
}

function getAssociationIcon(key: NonConformanceAssociationKey) {
  switch (key) {
    case "customers":
      return <LuSquareUser className="mr-2" />;
    case "suppliers":
      return <LuContainer className="mr-2" />;
    case "jobOperations":
      return <LuHardHat className="mr-2 text-amber-600" />;
    case "purchaseOrderLines":
      return <LuShoppingCart className="mr-2 text-blue-600" />;
    case "salesOrderLines":
      return <RiProgress8Line className="mr-2 text-green-600" />;
    case "shipmentLines":
      return <LuTruck className="mr-2 text-indigo-600" />;
    case "receiptLines":
      return <LuHandCoins className="mr-2 text-red-600" />;
    case "trackedEntities":
      return <LuQrCode className="mr-2" />;
    default:
      return <LuFileText className="mr-2" />;
  }
}

function NewCustomerAssociation() {
  return (
    <>
      <Customer name="id" label="Customer" />
    </>
  );
}

function NewSupplierAssociation() {
  return (
    <>
      <Supplier name="id" label="Supplier" />
    </>
  );
}

function NewJobOperationAssociation({ itemId }: { itemId?: string }) {
  const [jobs, setJobs] = useState<{ label: string; value: string }[]>([]);

  const [jobsAreLoading, setJobsAreLoading] = useState(true);
  const [jobOperations, setJobOperations] = useState<
    { label: string; value: string }[]
  >([]);
  const [jobOperationsAreLoading, setJobOperationsAreLoading] = useState(false);

  const { carbon } = useCarbon();

  async function fetchJobs() {
    if (!carbon) {
      toast.error("Failed to load data");
      return;
    }
    const { data, error } = await carbon.from("job").select("id, jobId");
    if (error) {
      toast.error("Failed to load jobs");
    }
    setJobs(data?.map((job) => ({ label: job.jobId, value: job.id })) ?? []);
    setJobsAreLoading(false);
  }

  async function fetchJobOperations(jobId: string) {
    if (!carbon) {
      toast.error("Failed to load data");
      return;
    }
    const { data, error } = await carbon
      .from("jobOperation")
      .select("id, description")
      .eq("jobId", jobId);

    if (error) {
      toast.error("Failed to load job operations");
    }

    setJobOperations(
      data?.map((job) => ({ label: job.description ?? "", value: job.id })) ??
        []
    );
    setJobOperationsAreLoading(false);
  }

  useMount(() => {
    fetchJobs();
  });

  return (
    <>
      <Combobox
        name="id"
        label="Job"
        options={jobs}
        isLoading={jobsAreLoading}
        onChange={(value) => {
          if (value) {
            flushSync(() => {
              setJobOperationsAreLoading(true);
            });
            fetchJobOperations(value.value);
          } else {
            setJobOperations([]);
          }
        }}
      />
      <Combobox
        name="lineId"
        label="Job Operation"
        options={jobOperations}
        isLoading={jobOperationsAreLoading}
      />
    </>
  );
}

function NewPurchaseOrderLineAssociation({ itemId }: { itemId?: string }) {
  const [purchaseOrders, setPurchaseOrders] = useState<
    { label: string; value: string }[]
  >([]);
  const [purchaseOrdersAreLoading, setPurchaseOrdersAreLoading] =
    useState(true);
  const [purchaseOrderLines, setPurchaseOrderLines] = useState<
    { label: string; value: string }[]
  >([]);
  const [purchaseOrderLinesAreLoading, setPurchaseOrderLinesAreLoading] =
    useState(false);
  const { carbon } = useCarbon();

  async function fetchPurchaseOrders() {
    if (!carbon) {
      toast.error("Failed to load data");
      return;
    }
    const { data, error } = await carbon
      .from("purchaseOrder")
      .select("id, purchaseOrderId");

    if (error) {
      toast.error("Failed to load purchase orders");
      return;
    }

    setPurchaseOrders(
      data?.map((po) => ({
        label: po.purchaseOrderId ?? "",
        value: po.id,
      })) ?? []
    );
    setPurchaseOrdersAreLoading(false);
  }

  async function fetchPurchaseOrderLines(purchaseOrderId: string) {
    if (!carbon) {
      toast.error("Failed to load data");
      return;
    }

    if (!purchaseOrderId) {
      setPurchaseOrderLines([]);
      setPurchaseOrderLinesAreLoading(false);
      return;
    }
    const { data, error } = await carbon
      .from("purchaseOrderLine")
      .select("id, itemId, item(name)")
      .eq("purchaseOrderId", purchaseOrderId);

    if (error) {
      toast.error("Failed to load purchase order lines");
    }

    setPurchaseOrderLines(
      data?.map((line) => ({
        label: line.item?.name ?? `Line ${line.id}`,
        value: line.id,
      })) ?? []
    );
    setPurchaseOrderLinesAreLoading(false);
  }

  useMount(() => {
    fetchPurchaseOrders();
  });

  return (
    <>
      <Combobox
        name="id"
        label="Purchase Order"
        options={purchaseOrders}
        isLoading={purchaseOrdersAreLoading}
        onChange={(value) => {
          if (value) {
            flushSync(() => {
              setPurchaseOrderLinesAreLoading(true);
            });
            fetchPurchaseOrderLines(value.value);
          } else {
            setPurchaseOrderLines([]);
          }
        }}
      />
      <Combobox
        name="lineId"
        label="Purchase Order Line"
        options={purchaseOrderLines}
        isLoading={purchaseOrderLinesAreLoading}
      />
    </>
  );
}

function NewSalesOrderLineAssociation({ itemId }: { itemId?: string }) {
  const { carbon } = useCarbon();
  const [salesOrders, setSalesOrders] = useState<
    { label: string; value: string }[]
  >([]);
  const [salesOrdersAreLoading, setSalesOrdersAreLoading] = useState(true);
  const [salesOrderLines, setSalesOrderLines] = useState<
    { label: string; value: string }[]
  >([]);
  const [salesOrderLinesAreLoading, setSalesOrderLinesAreLoading] =
    useState(false);

  async function fetchSalesOrders() {
    if (!carbon) {
      toast.error("Failed to load data");
      return;
    }
    const { data, error } = await carbon
      .from("salesOrder")
      .select("id, salesOrderId");

    if (error) {
      toast.error("Failed to load sales orders");
    }

    setSalesOrders(
      data?.map((order) => ({
        label: order.salesOrderId ?? "",
        value: order.id,
      })) ?? []
    );
    setSalesOrdersAreLoading(false);
  }

  async function fetchSalesOrderLines(salesOrderId: string) {
    if (!carbon) {
      toast.error("Failed to load data");
      return;
    }

    if (!salesOrderId) {
      setSalesOrderLines([]);
      setSalesOrderLinesAreLoading(false);
      return;
    }

    const { data, error } = await carbon
      .from("salesOrderLine")
      .select("id, itemId, item(name)")
      .eq("salesOrderId", salesOrderId);

    if (error) {
      toast.error("Failed to load sales order lines");
    }

    setSalesOrderLines(
      data?.map((line) => ({
        label: line.item?.name ?? `Line ${line.id}`,
        value: line.id,
      })) ?? []
    );
    setSalesOrderLinesAreLoading(false);
  }

  useMount(() => {
    fetchSalesOrders();
  });

  return (
    <>
      <Combobox
        name="id"
        label="Sales Order"
        options={salesOrders}
        isLoading={salesOrdersAreLoading}
        onChange={(value) => {
          if (value) {
            flushSync(() => {
              setSalesOrderLinesAreLoading(true);
            });
            fetchSalesOrderLines(value.value);
          } else {
            setSalesOrderLines([]);
          }
        }}
      />
      <Combobox
        name="lineId"
        label="Sales Order Line"
        options={salesOrderLines}
        isLoading={salesOrderLinesAreLoading}
      />
    </>
  );
}

function NewShipmentLineAssociation({ itemId }: { itemId?: string }) {
  const { carbon } = useCarbon();
  const [shipments, setShipments] = useState<
    { label: string; value: string }[]
  >([]);
  const [shipmentsAreLoading, setShipmentsAreLoading] = useState(true);
  const [shipmentLines, setShipmentLines] = useState<
    { label: string; value: string }[]
  >([]);
  const [shipmentLinesAreLoading, setShipmentLinesAreLoading] = useState(false);

  async function fetchShipments() {
    if (!carbon) {
      toast.error("Failed to load data");
      return;
    }
    const { data, error } = await carbon
      .from("shipment")
      .select("id, shipmentId");

    if (error) {
      toast.error("Failed to load shipments");
    }

    setShipments(
      data?.map((shipment) => ({
        label: `Shipment ${shipment.shipmentId}`,
        value: shipment.id,
      })) ?? []
    );
    setShipmentsAreLoading(false);
  }

  async function fetchShipmentLines(shipmentId: string) {
    if (!carbon) {
      toast.error("Failed to load data");
      return;
    }
    const { data, error } = await carbon
      .from("shipmentLine")
      .select("id, itemReadableId")
      .eq("shipmentId", shipmentId);

    if (error) {
      toast.error("Failed to load shipment lines");
    }

    setShipmentLines(
      data?.map((line) => ({
        label: line.itemReadableId ?? `Line ${line.id}`,
        value: line.id,
      })) ?? []
    );
    setShipmentLinesAreLoading(false);
  }

  useMount(() => {
    fetchShipments();
  });

  return (
    <>
      <Combobox
        name="id"
        label="Shipment"
        options={shipments}
        isLoading={shipmentsAreLoading}
        onChange={(value) => {
          if (value) {
            flushSync(() => {
              setShipmentLinesAreLoading(true);
            });
            fetchShipmentLines(value.value);
          } else {
            setShipmentLines([]);
          }
        }}
      />
      <Combobox
        name="lineId"
        label="Shipment Line"
        options={shipmentLines}
        isLoading={shipmentLinesAreLoading}
      />
    </>
  );
}

function NewReceiptLineAssociation({ itemId }: { itemId?: string }) {
  const { carbon } = useCarbon();
  const [receipts, setReceipts] = useState<{ label: string; value: string }[]>(
    []
  );
  const [receiptsAreLoading, setReceiptsAreLoading] = useState(true);
  const [receiptLines, setReceiptLines] = useState<
    { label: string; value: string }[]
  >([]);
  const [receiptLinesAreLoading, setReceiptLinesAreLoading] = useState(false);

  async function fetchReceipts() {
    if (!carbon) {
      toast.error("Failed to load data");
      return;
    }
    const { data, error } = await carbon
      .from("receipt")
      .select("id, receiptId");

    if (error) {
      toast.error("Failed to load receipts");
    }

    setReceipts(
      data?.map((receipt) => ({
        label: `Receipt ${receipt.receiptId}`,
        value: receipt.id,
      })) ?? []
    );
    setReceiptsAreLoading(false);
  }

  async function fetchReceiptLines(receiptId: string) {
    if (!carbon) {
      toast.error("Failed to load data");
      return;
    }
    const { data, error } = await carbon
      .from("receiptLine")
      .select("id, itemReadableId")
      .eq("receiptId", receiptId);

    if (error) {
      toast.error("Failed to load receipt lines");
    }

    setReceiptLines(
      data?.map((line) => ({
        label: line.itemReadableId ?? `Line ${line.id}`,
        value: line.id,
      })) ?? []
    );
    setReceiptLinesAreLoading(false);
  }

  useMount(() => {
    fetchReceipts();
  });

  return (
    <>
      <Combobox
        name="id"
        label="Receipt"
        options={receipts}
        isLoading={receiptsAreLoading}
        onChange={(value) => {
          if (value) {
            flushSync(() => {
              setReceiptLinesAreLoading(true);
            });
            fetchReceiptLines(value.value);
          } else {
            setReceiptLines([]);
          }
        }}
      />
      <Combobox
        name="lineId"
        label="Receipt Line"
        options={receiptLines}
        isLoading={receiptLinesAreLoading}
      />
    </>
  );
}

function NewAssociationModal({
  open,
  onClose,
  type,
  name,
  itemId,
}: {
  open: boolean;
  onClose: () => void;
  type: NonConformanceAssociationKey;
  name: string;
  itemId?: string;
}) {
  const { id } = useParams();
  if (!id) throw new Error("No non-conformance ID found");

  const fetcher = useFetcher<typeof associationAction>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }

    if (fetcher.data?.success === false && fetcher.data?.message) {
      toast.error(fetcher?.data?.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success, onClose]);

  function renderFields(type: NonConformanceAssociationKey) {
    switch (type) {
      case "customers":
        return <NewCustomerAssociation />;
      case "suppliers":
        return <NewSupplierAssociation />;
      case "jobOperations":
        return <NewJobOperationAssociation itemId={itemId} />;
      case "purchaseOrderLines":
        return <NewPurchaseOrderLineAssociation itemId={itemId} />;
      case "salesOrderLines":
        return <NewSalesOrderLineAssociation itemId={itemId} />;
      case "shipmentLines":
        return <NewShipmentLineAssociation itemId={itemId} />;
      case "receiptLines":
        return <NewReceiptLineAssociation itemId={itemId} />;
      default:
        return null;
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.newNonConformanceAssociation(id)}
          validator={nonConformanceAssociationValidator}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>New {name}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="type" value={type} />
            <VStack spacing={4}>{renderFields(type)}</VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Submit>Add</Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function getAssociationLink(
  child: NonConformanceAssociationNode["children"][number],
  key: NonConformanceAssociationKey
) {
  switch (key) {
    case "jobOperations":
      return path.to.jobDetails(child.id);
    case "purchaseOrderLines":
      if (!child.lineId) return "#";
      return path.to.purchaseOrderLine(child.id, child.lineId);
    case "salesOrderLines":
      if (!child.lineId) return "#";
      return path.to.salesOrderLine(child.id, child.lineId);
    case "shipmentLines":
      if (!child.lineId) return "#";
      return path.to.shipment(child.id);
    case "receiptLines":
      if (!child.lineId) return "#";
      return path.to.receipt(child.id);
    case "trackedEntities":
      if (!child.lineId) return "#";
      return `${path.to.traceabilityGraph}?trackedEntityId==${child.id}`;
    case "customers":
      return path.to.customer(child.id);
    case "suppliers":
      return path.to.supplier(child.id);
    default:
      return "#";
  }
}
