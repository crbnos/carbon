import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Combobox,
  HStack,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { memo, useEffect, useMemo, useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { usePermissions, useUser } from "~/hooks";
import type { PlanningAction } from "~/modules/production";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

// The MRP action worklist (spec §P1.7): one row per persisted planningAction.
// Buy actions surface on the purchasing planning page, Make actions on the
// production page — this component serves both. Apply posts ONLY the mapped
// lowercase action + planningActionIds; the server executes from the persisted
// row (Task 8 IDOR bind). Committed targets get "Review on PO/Job" navigation
// instead of a one-click apply.

const WIRE_ACTION: Record<string, string> = {
  Order: "order",
  Make: "order",
  Expedite: "expedite",
  Defer: "defer",
  Increase: "increase",
  Decrease: "decrease",
  Cancel: "cancel"
};

const TYPE_COLORS: Record<
  string,
  "blue" | "green" | "orange" | "red" | "yellow" | "purple" | "gray"
> = {
  Order: "blue",
  Make: "blue",
  Expedite: "orange",
  Defer: "yellow",
  Increase: "purple",
  Decrease: "purple",
  Cancel: "red"
};

type ApplyResponse = {
  success: boolean;
  message: string;
  applied?: string[];
  requiresManualAction?: { id: string }[];
  errors?: string[];
};

const PlanningActionsTable = memo(
  ({
    actions,
    kind,
    locationId,
    updatePath
  }: {
    actions: PlanningAction[];
    kind: "Buy" | "Make";
    locationId: string;
    updatePath: string;
  }) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const user = useUser();
    const [people] = usePeople();
    const fetcher = useFetcher<ApplyResponse>();

    const [scope, setScope] = useState<"mine" | "all">("mine");
    const [typeFilter, setTypeFilter] = useState<string>("");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [assignTo, setAssignTo] = useState<string>("");

    const canUpdate = permissions.can(
      "update",
      kind === "Buy" ? "purchasing" : "production"
    );

    useEffect(() => {
      if (fetcher.data?.message) {
        if (fetcher.data.success) {
          toast.success(fetcher.data.message);
        } else {
          toast.error(fetcher.data.message);
        }
        setSelected(new Set());
      }
    }, [fetcher.data]);

    const personName = useMemo(() => {
      const map = new Map(people.map((p) => [p.id, p.name]));
      return (id: string | null) => (id ? (map.get(id) ?? null) : null);
    }, [people]);

    const typeOptions = useMemo(() => {
      const present = [...new Set(actions.map((a) => a.type))];
      return [
        { value: "", label: t`All types` },
        ...present.map((type) => ({ value: type, label: type }))
      ];
    }, [actions, t]);

    // Dismissed rows are suppressed from the worklist — the diff-write keeps
    // them dormant until the underlying need changes materially (spec §P1.4)
    const openActions = useMemo(
      () => actions.filter((a) => a.status === "Open"),
      [actions]
    );

    const visible = useMemo(
      () =>
        openActions.filter((action) => {
          if (scope === "mine" && action.assignee !== user.id) return false;
          if (typeFilter && action.type !== typeFilter) return false;
          return true;
        }),
      [openActions, scope, typeFilter, user.id]
    );

    const mineCount = useMemo(
      () => openActions.filter((a) => a.assignee === user.id).length,
      [openActions, user.id]
    );

    const toggle = (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    const toggleAll = () => {
      setSelected((prev) =>
        prev.size === visible.length
          ? new Set()
          : new Set(visible.map((a) => a.id))
      );
    };

    const submit = (payload: Record<string, unknown>) => {
      fetcher.submit(JSON.stringify({ locationId, ...payload }), {
        method: "post",
        action: updatePath,
        encType: "application/json"
      });
    };

    // Order/Make rows flow through the existing order drawer, and committed
    // targets link out for review — neither is batch-applyable here.
    const isApplyable = (row: PlanningAction) => {
      const wire = WIRE_ACTION[row.type];
      return (
        !row.requiresManualAction && wire !== undefined && wire !== "order"
      );
    };

    const applyActions = (rows: PlanningAction[]) => {
      // ONE batched request — a fetcher holds a single in-flight submission,
      // so one request per wire action superseded all but the last. The route
      // derives each row's behavior from its own persisted type.
      const planningActionIds = rows.filter(isApplyable).map((row) => row.id);
      if (planningActionIds.length === 0) return;
      submit({ action: "apply", planningActionIds });
    };

    const selectedRows = visible.filter((a) => selected.has(a.id));
    const applyableSelectedCount = selectedRows.filter(isApplyable).length;

    if (openActions.length === 0) return null;

    return (
      <Card className="rounded-none border-x-0 border-t-0">
        <CardHeader className="pb-2">
          <HStack className="w-full justify-between">
            <div>
              <CardTitle>
                <Trans>Planning Actions</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Suggested by the last MRP run. Apply acts on uncommitted
                  supply; sent orders link out for review.
                </Trans>
              </CardDescription>
            </div>
            <HStack spacing={2}>
              <Button
                size="sm"
                variant={scope === "mine" ? "primary" : "secondary"}
                onClick={() => setScope("mine")}
              >
                {t`My actions`} · {mineCount}
              </Button>
              <Button
                size="sm"
                variant={scope === "all" ? "primary" : "secondary"}
                onClick={() => setScope("all")}
              >
                {t`All`} · {openActions.length}
              </Button>
              <div className="w-[160px]">
                <Combobox
                  size="sm"
                  value={typeFilter}
                  options={typeOptions}
                  onChange={setTypeFilter}
                  placeholder={t`All types`}
                />
              </div>
            </HStack>
          </HStack>
          {selectedRows.length > 0 && canUpdate && (
            <HStack spacing={2} className="pt-2">
              <Button
                size="sm"
                isDisabled={
                  applyableSelectedCount === 0 || fetcher.state !== "idle"
                }
                onClick={() => applyActions(selectedRows)}
              >
                {t`Apply`} · {applyableSelectedCount}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={fetcher.state !== "idle"}
                onClick={() =>
                  submit({
                    action: "dismiss",
                    planningActionIds: selectedRows.map((a) => a.id)
                  })
                }
              >
                {t`Dismiss`}
              </Button>
              <div className="w-[200px]">
                <Combobox
                  size="sm"
                  value={assignTo}
                  options={people.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={setAssignTo}
                  placeholder={t`Assign to...`}
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={!assignTo || fetcher.state !== "idle"}
                onClick={() =>
                  submit({
                    action: "assign",
                    planningActionIds: selectedRows.map((a) => a.id),
                    assignee: assignTo
                  })
                }
              >
                {t`Assign`}
              </Button>
            </HStack>
          )}
        </CardHeader>
        <CardContent className="max-h-[300px] overflow-y-auto p-0">
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 py-4">
              {scope === "mine" ? (
                <Trans>No actions assigned to you</Trans>
              ) : (
                <Trans>No planning actions</Trans>
              )}
            </p>
          ) : (
            <TableBase>
              <Thead>
                <Tr>
                  <Th className="w-[40px]">
                    <Checkbox
                      checked={
                        visible.length > 0 && selected.size === visible.length
                      }
                      onCheckedChange={toggleAll}
                    />
                  </Th>
                  <Th>
                    <Trans>Item</Trans>
                  </Th>
                  <Th>
                    <Trans>Action</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Quantity</Trans>
                  </Th>
                  <Th>
                    <Trans>Date</Trans>
                  </Th>
                  <Th>
                    <Trans>Assignee</Trans>
                  </Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((action) => {
                  const reviewLink = action.requiresManualAction
                    ? action.purchaseOrderId
                      ? path.to.purchaseOrder(action.purchaseOrderId)
                      : action.jobId
                        ? path.to.job(action.jobId)
                        : null
                    : null;
                  return (
                    <Tr key={action.id}>
                      <Td>
                        <Checkbox
                          checked={selected.has(action.id)}
                          onCheckedChange={() => toggle(action.id)}
                        />
                      </Td>
                      <Td>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {action.itemReadableId ?? action.itemId}
                          </span>
                          <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                            {action.itemName}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        <HStack spacing={1}>
                          <Badge variant={TYPE_COLORS[action.type] ?? "gray"}>
                            {action.type}
                          </Badge>
                          {action.isASAP && (
                            <Badge variant="red">
                              <Trans>ASAP</Trans>
                            </Badge>
                          )}
                        </HStack>
                        {(action.reason || action.policyName) && (
                          <div className="text-xs text-muted-foreground max-w-[260px] truncate">
                            {action.reason ?? action.policyName}
                          </div>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {action.suggestedQuantity}
                      </Td>
                      <Td>{formatDate(action.suggestedDate)}</Td>
                      <Td>
                        <span className="text-sm text-muted-foreground">
                          {personName(action.assignee) ?? t`Unassigned`}
                        </span>
                      </Td>
                      <Td>
                        {reviewLink ? (
                          <Button
                            asChild
                            size="sm"
                            variant="secondary"
                            rightIcon={<LuExternalLink />}
                          >
                            <Link to={reviewLink}>
                              {action.purchaseOrderId ? (
                                <Trans>Review on PO</Trans>
                              ) : (
                                <Trans>Review on Job</Trans>
                              )}
                            </Link>
                          </Button>
                        ) : WIRE_ACTION[action.type] !== "order" ? (
                          <Button
                            size="sm"
                            isDisabled={!canUpdate || fetcher.state !== "idle"}
                            onClick={() => applyActions([action])}
                          >
                            <Trans>Apply</Trans>
                          </Button>
                        ) : null}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </TableBase>
          )}
        </CardContent>
      </Card>
    );
  }
);

PlanningActionsTable.displayName = "PlanningActionsTable";

export default PlanningActionsTable;
