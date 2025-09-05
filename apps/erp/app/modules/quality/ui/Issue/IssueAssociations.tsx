import { useCarbon } from "@carbon/auth";
import { Combobox, Hidden, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  cn,
  Count,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import { getItemReadableId } from "@carbon/utils";
import { Link, useFetcher, useParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuChevronRight,
  LuCirclePlus,
  LuContainer,
  LuEllipsisVertical,
  LuFileText,
  LuHandCoins,
  LuHardHat,
  LuQrCode,
  LuSearch,
  LuShoppingCart,
  LuSquareUser,
  LuTrash,
  LuTruck,
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Customer, Item, Supplier } from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { LevelLine } from "~/components/TreeView";
import { usePermissions } from "~/hooks";
import type { MethodItemType } from "~/modules/shared";
import type { action as associationAction } from "~/routes/x+/issue+/$id.association.new";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { issueAssociationValidator } from "../../quality.models";
import type { IssueAssociationKey, IssueAssociationNode } from "../../types";

export function IssueAssociationsSkeleton() {
  return (
    <div className="flex flex-col gap-1 w-full">
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-7 w-1/2" />
    </div>
  );
}

export function IssueAssociationsTree({
  tree,
  nonConformanceId,
  items,
}: {
  tree: IssueAssociationNode[];
  nonConformanceId: string;
  items?: string[];
}) {
  const [filterText, setFilterText] = useState("");
  const deleteDisclosure = useDisclosure();
  const [selectedChild, setSelectedChild] = useState<
    IssueAssociationNode["children"][number] | null
  >(null);

  const onDelete = (child: IssueAssociationNode["children"][number]) => {
    flushSync(() => {
      setSelectedChild(child);
    });
    deleteDisclosure.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedChild(null);
    deleteDisclosure.onClose();
  };

  return (
    <>
      <VStack className="px-2">
        <HStack className="w-full py-2">
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
              if (
                node.key === "trackedEntities" &&
                (!Array.isArray(items) || items.length == 0)
              ) {
                return false;
              }

              return true;
            })
            .map((node) => (
              <IssueAssociationItem
                key={node.key}
                filterText={filterText}
                items={items}
                node={node}
                nonConformanceId={nonConformanceId}
                onDelete={onDelete}
              />
            ))}
        </VStack>
      </VStack>
      {deleteDisclosure.isOpen && selectedChild?.id && (
        <ConfirmDelete
          action={path.to.deleteIssueAssociation(
            nonConformanceId,
            selectedChild.type,
            selectedChild.id
          )}
          name={`${selectedChild?.documentReadableId ?? ""}`}
          text={`Are you sure you want to deactivate the association with ${selectedChild?.documentReadableId}?`}
          isOpen={deleteDisclosure.isOpen}
          onCancel={onDeleteCancel}
          onSubmit={onDeleteCancel}
        />
      )}
    </>
  );
}

export function IssueAssociationItem({
  node,
  filterText,
  nonConformanceId,
  items,
  onDelete,
}: {
  node: IssueAssociationNode;
  filterText: string;
  nonConformanceId: string;
  items?: string[];
  onDelete: (child: IssueAssociationNode["children"][number]) => void;
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
    child.documentReadableId.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <>
      <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-2 text-sm w-full hover:bg-muted/90">
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
        <div className="flex flex-col w-full px-2">
          {node.children.length === 0 ? (
            <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-4">
              <LevelLine isSelected={false} />
              <div className="text-xs text-muted-foreground">
                No {node.name.toLowerCase()} found
              </div>
            </div>
          ) : (
            filteredChildren.map((child, index) => (
              <div
                key={index}
                className="group/association relative flex w-full"
              >
                <Link
                  to={getAssociationLink(child, node.key)}
                  className="flex pr-7 h-8 cursor-pointer items-center overflow-hidden rounded-sm px-1 gap-2 text-sm hover:bg-muted/90 w-full font-medium whitespace-nowrap"
                >
                  <LevelLine isSelected={false} />
                  {getAssociationIcon(node.key)}
                  <span className="truncate">{child.documentReadableId}</span>
                </Link>
                {permissions.can("delete", node.module) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        aria-label="Options"
                        icon={<LuEllipsisVertical />}
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1 flex-shrink-0 opacity-0 group-hover/association:opacity-100 data-[state=open]:opacity-100 text-foreground/70 hover:text-foreground"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        destructive
                        onSelect={() => {
                          onDelete(child);
                        }}
                      >
                        <DropdownMenuIcon icon={<LuTrash />} />
                        Delete Association
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
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
          items={items}
        />
      )}
    </>
  );
}

function getAssociationIcon(key: IssueAssociationKey) {
  switch (key) {
    case "items":
      return <AiOutlinePartition />;
    case "customers":
      return <LuSquareUser />;
    case "suppliers":
      return <LuContainer />;
    case "jobOperations":
      return <LuHardHat className="text-amber-600" />;
    case "purchaseOrderLines":
      return <LuShoppingCart className="text-blue-600" />;
    case "salesOrderLines":
      return <RiProgress8Line className="text-green-600" />;
    case "shipmentLines":
      return <LuTruck className="text-indigo-600" />;
    case "receiptLines":
      return <LuHandCoins className="text-red-600" />;
    case "trackedEntities":
      return <LuQrCode />;
    default:
      return <LuFileText />;
  }
}

function NewItemAssociation() {
  const [itemType, setItemType] = useState<MethodItemType | "Item">("Item");
  const onTypeChange = (t: MethodItemType | "Item") => {
    setItemType(t as MethodItemType);
  };

  return (
    <>
      <Item
        name="id"
        label={itemType}
        // @ts-ignore
        type={itemType}
        replenishmentSystem="Buy"
        onTypeChange={onTypeChange}
      />
    </>
  );
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

function NewJobOperationAssociation({ items }: { items?: string[] }) {
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

function NewPurchaseOrderLineAssociation({ items }: { items?: string[] }) {
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

    let query = carbon
      .from("purchaseOrderLine")
      .select("id, itemId, item(name)")
      .eq("purchaseOrderId", purchaseOrderId);

    if (items) {
      query = query.in("itemId", items);
    }

    const { data, error } = await query;

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

function NewSalesOrderLineAssociation({ items }: { items?: string[] }) {
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

    let query = carbon
      .from("salesOrderLine")
      .select("id, itemId, item(name)")
      .eq("salesOrderId", salesOrderId);

    if (items) {
      query = query.in("itemId", items);
    }

    const { data, error } = await query;

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

function NewShipmentLineAssociation({ items }: { items?: string[] }) {
  const { carbon } = useCarbon();
  const [storedItems] = useItems();
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

    let query = carbon
      .from("shipmentLine")
      .select("id, itemId")
      .eq("shipmentId", shipmentId);

    if (items) {
      query = query.in("itemId", items);
    }

    const { data, error } = await query;

    if (error) {
      toast.error("Failed to load shipment lines");
    }

    setShipmentLines(
      data?.map((line) => ({
        label: getItemReadableId(storedItems, line.itemId) ?? `Line ${line.id}`,
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

function NewReceiptLineAssociation({ items }: { items?: string[] }) {
  const { carbon } = useCarbon();
  const [storedItems] = useItems();
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

    let query = carbon
      .from("receiptLine")
      .select("id, itemId")
      .eq("receiptId", receiptId);

    if (items) {
      query = query.in("itemId", items);
    }

    const { data, error } = await query;

    if (error) {
      toast.error("Failed to load receipt lines");
    }

    setReceiptLines(
      data?.map((line) => ({
        label: getItemReadableId(storedItems, line.itemId) ?? `Line ${line.id}`,
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
        name="documentLineId"
        label="Receipt Line"
        options={receiptLines}
        isLoading={receiptLinesAreLoading}
      />
    </>
  );
}

function NewTrackedEntityAssociation({ items }: { items?: string[] }) {
  const { carbon } = useCarbon();
  const [trackedEntities, setTrackedEntities] = useState<
    { label: string; value: string }[]
  >([]);
  const [trackedEntitiesAreLoading, setTrackedEntitiesAreLoading] =
    useState(true);

  useMount(() => {
    fetchTrackedEntities();
  });

  async function fetchTrackedEntities() {
    if (!carbon || !items) {
      toast.error("Failed to load data");
      return;
    }

    const { data, error } = await carbon
      .from("trackedEntity")
      .select("id")
      .eq("sourceDocument", "Item")
      .in("sourceDocumentId", items!);

    if (error) {
      toast.error("Failed to load tracked entities");
    }

    setTrackedEntities(
      data?.map((entity) => ({
        label: entity.id,
        value: entity.id,
      })) ?? []
    );
    setTrackedEntitiesAreLoading(false);
  }

  return (
    <Combobox
      name="id"
      label="Tracked Entity"
      options={trackedEntities}
      isLoading={trackedEntitiesAreLoading}
    />
  );
}

function NewAssociationModal({
  open,
  onClose,
  type,
  name,
  items,
}: {
  open: boolean;
  onClose: () => void;
  type: IssueAssociationKey;
  name: string;
  items?: string[];
}) {
  const { id } = useParams();
  if (!id) throw new Error("No issue ID found");

  const fetcher = useFetcher<typeof associationAction>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }

    if (fetcher.data?.success === false && fetcher.data?.message) {
      toast.error(fetcher?.data?.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success, onClose]);

  function renderFields(type: IssueAssociationKey) {
    switch (type) {
      case "items":
        return <NewItemAssociation />;
      case "customers":
        return <NewCustomerAssociation />;
      case "suppliers":
        return <NewSupplierAssociation />;
      case "jobOperations":
        return <NewJobOperationAssociation items={items} />;
      case "purchaseOrderLines":
        return <NewPurchaseOrderLineAssociation items={items} />;
      case "salesOrderLines":
        return <NewSalesOrderLineAssociation items={items} />;
      case "shipmentLines":
        return <NewShipmentLineAssociation items={items} />;
      case "receiptLines":
        return <NewReceiptLineAssociation items={items} />;
      case "trackedEntities":
        return <NewTrackedEntityAssociation items={items} />;
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
          action={path.to.newIssueAssociation(id)}
          validator={issueAssociationValidator}
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
  child: IssueAssociationNode["children"][number],
  key: IssueAssociationKey
) {
  switch (key) {
    case "jobOperations":
      return path.to.jobDetails(child.documentId);
    case "purchaseOrderLines":
      if (!child.documentLineId) return "#";
      return path.to.purchaseOrderLine(child.documentId, child.documentLineId);
    case "salesOrderLines":
      if (!child.documentLineId) return "#";
      return path.to.salesOrderLine(child.documentId, child.documentLineId);
    case "shipmentLines":
      if (!child.documentLineId) return "#";
      return path.to.shipment(child.documentId);
    case "receiptLines":
      if (!child.documentLineId) return "#";
      return path.to.receipt(child.documentId);
    case "trackedEntities":
      return `${path.to.traceabilityGraph}?trackedEntityId=${child.documentId}`;
    case "customers":
      return path.to.customer(child.documentId);
    case "suppliers":
      return path.to.supplier(child.documentId);
    default:
      return "#";
  }
}
