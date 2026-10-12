// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  LabelWithHelp,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, useMemo, useState } from "react";
import {
  LuBan,
  LuCirclePause,
  LuCirclePlay,
  LuEllipsisVertical,
  LuPencil
} from "react-icons/lu";
import {
  Hidden,
  Number as NumberField,
  Submit,
  TextArea
} from "~/components/Form";
import { useCurrencyFormatter, useQuantityFormatter, useUser } from "~/hooks";
import { useCurrencyDecimals } from "~/hooks/useCurrencies";
import {
  inTreeOrder,
  serviceBillableItemValidator
} from "../../service.models";
import type { ServiceBillableItem, ServiceWorkNode } from "../../types";
import { BillableItemStatus } from "../ServiceStatus";
import { CoveragePill } from "../Work/CoveragePill";

type Group = {
  key: string;
  node: ServiceWorkNode | null;
  depth: number;
  items: ServiceBillableItem[];
};

/**
 * The items each node will bill, in the order of the work tree, with who
 * pays (coverage), quantity, unit price, amount and status. An item that is
 * not billed takes **Edit Price**, **Hold** (or **Release**) and **Write
 * Off** (with a reason). A node with a fixed price shows it: the invoice
 * bills that node as one line at its price.
 */
export default function BillableItemsTable({
  items,
  nodes,
  action,
  isDisabled
}: {
  items: ServiceBillableItem[];
  nodes: ServiceWorkNode[];
  /** The billing route, which reviews an item. */
  action: string;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const formatCurrency = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const [editing, setEditing] = useState<ServiceBillableItem | null>(null);
  const [writingOff, setWritingOff] = useState<ServiceBillableItem | null>(
    null
  );
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to update the item`)
  });

  const groups = useMemo<Group[]>(() => {
    const byNode = new Map<string, ServiceBillableItem[]>();
    const other: ServiceBillableItem[] = [];
    const nodeIds = new Set(nodes.map((node) => node.id));
    for (const item of items) {
      if (item.projectElementId && nodeIds.has(item.projectElementId)) {
        byNode.set(item.projectElementId, [
          ...(byNode.get(item.projectElementId) ?? []),
          item
        ]);
      } else {
        other.push(item);
      }
    }
    const result: Group[] = inTreeOrder(nodes)
      .filter(({ node }) => byNode.has(node.id) || node.fixedPrice !== null)
      .map(({ node, depth }) => ({
        key: node.id,
        node,
        depth,
        items: byNode.get(node.id) ?? []
      }));
    if (other.length > 0) {
      result.push({ key: "other", node: null, depth: 0, items: other });
    }
    return result;
  }, [items, nodes]);

  const setStatus = (
    item: ServiceBillableItem,
    status: "Unbilled" | "On Hold"
  ) => fetcher.submit({ id: item.id, status }, { method: "post", action });

  const totals = useMemo(() => {
    let unbilled = 0;
    let billed = 0;
    for (const item of items) {
      if (item.status === "Unbilled") unbilled += Number(item.amount);
      if (item.status === "Billed") billed += Number(item.amount);
    }
    return { unbilled, billed };
  }, [items]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Billing</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">
                <Trans>Unbilled</Trans>
              </span>
              <span className="font-medium tabular-nums">
                {formatCurrency.format(totals.unbilled)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">
                <Trans>Billed</Trans>
              </span>
              <span className="font-medium tabular-nums">
                {formatCurrency.format(totals.billed)}
              </span>
            </div>
          </div>

          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                Nothing to bill yet. Time, parts and expenses charged to the
                work show here.
              </Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th className="w-full">
                    <Trans>Item</Trans>
                  </Th>
                  <Th>
                    <LabelWithHelp termId="coverage" variant="inline">
                      <Trans>Coverage</Trans>
                    </LabelWithHelp>
                  </Th>
                  <Th className="text-right">
                    <Trans>Quantity</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Unit Price</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Amount</Trans>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {groups.map((group) => (
                  <Fragment key={group.key}>
                    <Tr className="bg-muted/40">
                      <Td colSpan={4}>
                        <div
                          className="flex min-w-0 items-center gap-2 font-medium"
                          style={{ paddingLeft: `${group.depth * 16}px` }}
                        >
                          {group.node ? (
                            <>
                              <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                                {group.node.readableId}
                              </span>
                              <span className="truncate">
                                {group.node.name}
                              </span>
                            </>
                          ) : (
                            <Trans>Other charges</Trans>
                          )}
                        </div>
                      </Td>
                      <Td className="text-right tabular-nums whitespace-nowrap">
                        {group.node?.fixedPrice !== null &&
                          group.node?.fixedPrice !== undefined && (
                            <span className="font-medium">
                              {formatCurrency.format(
                                Number(group.node.fixedPrice)
                              )}
                            </span>
                          )}
                      </Td>
                      <Td colSpan={2} className="whitespace-nowrap">
                        {group.node?.fixedPrice !== null &&
                          group.node?.fixedPrice !== undefined && (
                            <span className="text-xs text-muted-foreground">
                              <Trans>Fixed price</Trans>
                            </span>
                          )}
                      </Td>
                    </Tr>
                    {group.items.map((item) => {
                      const canReview =
                        !isDisabled &&
                        !item.reversalOfId &&
                        (item.status === "Unbilled" ||
                          item.status === "On Hold");
                      return (
                        <Tr key={item.id}>
                          <Td>
                            <div
                              className="flex min-w-0 flex-col"
                              style={{
                                paddingLeft: `${group.depth * 16 + 16}px`
                              }}
                            >
                              <span className="truncate">
                                {item.description}
                              </span>
                              {item.statusReason && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {item.statusReason}
                                </span>
                              )}
                            </div>
                          </Td>
                          <Td>
                            {item.coverage ? (
                              <CoveragePill coverage={item.coverage} />
                            ) : (
                              "—"
                            )}
                          </Td>
                          <Td className="text-right tabular-nums whitespace-nowrap">
                            {formatQuantity(Number(item.quantity))}
                          </Td>
                          <Td className="text-right tabular-nums whitespace-nowrap">
                            {formatCurrency.format(Number(item.unitPrice))}
                          </Td>
                          <Td className="text-right tabular-nums whitespace-nowrap">
                            {formatCurrency.format(Number(item.amount))}
                          </Td>
                          <Td>
                            <BillableItemStatus status={item.status} />
                          </Td>
                          <Td>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <IconButton
                                  aria-label={t`Item actions`}
                                  icon={<LuEllipsisVertical />}
                                  variant="ghost"
                                  size="sm"
                                  isDisabled={!canReview}
                                />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => setEditing(item)}
                                >
                                  <DropdownMenuIcon icon={<LuPencil />} />
                                  <Trans>Edit Price</Trans>
                                </DropdownMenuItem>
                                {item.status === "On Hold" ? (
                                  <DropdownMenuItem
                                    onClick={() => setStatus(item, "Unbilled")}
                                  >
                                    <DropdownMenuIcon icon={<LuCirclePlay />} />
                                    <Trans>Release</Trans>
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    onClick={() => setStatus(item, "On Hold")}
                                  >
                                    <DropdownMenuIcon
                                      icon={<LuCirclePause />}
                                    />
                                    <Trans>Hold</Trans>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  destructive
                                  onClick={() => setWritingOff(item)}
                                >
                                  <DropdownMenuIcon icon={<LuBan />} />
                                  <Trans>Write Off</Trans>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Fragment>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <EditPriceModal
          action={action}
          item={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {writingOff && (
        <WriteOffModal
          action={action}
          item={writingOff}
          onClose={() => setWritingOff(null)}
        />
      )}
    </>
  );
}

/** Changes an unbilled item's unit price; its amount follows. */
function EditPriceModal({
  action,
  item,
  onClose
}: {
  action: string;
  item: ServiceBillableItem;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  const currencyCode = company.baseCurrencyCode ?? "USD";
  const decimals = useCurrencyDecimals(currencyCode);
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onSuccess: () => onClose(),
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to update the price`)
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={serviceBillableItemValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{ id: item.id, unitPrice: Number(item.unitPrice) }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Edit Price</Trans>
            </ModalTitle>
            <ModalDescription>{item.description}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <NumberField
                name="unitPrice"
                label={t`Unit Price`}
                minValue={0}
                formatOptions={INPUT_FORMAT.rate(currencyCode, decimals)}
                step={INPUT_STEP.rate}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/** Writes an item off so it is never billed. The reason is required. */
function WriteOffModal({
  action,
  item,
  onClose
}: {
  action: string;
  item: ServiceBillableItem;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onSuccess: () => onClose(),
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to write off the item`)
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={serviceBillableItemValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            id: item.id,
            status: "Written Off",
            statusReason: ""
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Write Off</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                {item.description} is never billed. Its cost stays on the order.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <Hidden name="status" />
            <VStack spacing={4}>
              <TextArea name="statusReason" label={t`Reason`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false} variant="destructive">
              <Trans>Write Off</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
