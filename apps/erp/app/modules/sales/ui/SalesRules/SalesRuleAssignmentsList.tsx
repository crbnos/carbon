// Per-item "Sales rules" card — the sales-rule counterpart of
// `~/modules/inventory/ui/StorageRules/RuleAssignmentsList`. Forked (not parameterized)
// because that component hard-codes the STORAGE_RULES plan gate, the storage
// path constants, storage SurfaceChips, and targetType copy; a fork is the
// smaller diff and leaves storage behavior untouched.

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Combobox,
  HStack,
  IconButton,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { SALES_RULE_SURFACES, type SalesRuleSurface } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuLibrary, LuPlus, LuShieldCheck, LuTrash } from "react-icons/lu";
import { Form, Link, useFetcher } from "react-router";
import { Hyperlink } from "~/components";
import {
  UpgradeOverlayActions,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayIcon,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
} from "~/components/UpgradeOverlay";
import { usePermissions } from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { path } from "~/utils/path";

const SALES_RULE_SURFACE_LABELS: Record<SalesRuleSurface, string> = {
  quoteLine: "Quote line",
  salesOrderLine: "Sales order line",
  salesInvoiceLine: "Sales invoice line"
};

type AssignedSalesRule = {
  ruleId: string;
  salesRule: {
    id: string;
    name: string;
    severity: "error" | "warn";
    message: string;
    active: boolean;
    surfaces?: SalesRuleSurface[];
  };
  /**
   * `"__all__"` marks a broadcast rule (matched via the rule's item filters,
   * not an explicit assignment). UI shows the reach badge and suppresses
   * unassign — edit the rule's filters to remove it.
   */
  inheritedFromId?: string | null;
  inheritedFromName?: string | null;
};

type SalesRuleLibraryRule = {
  id: string;
  name: string;
  severity: "error" | "warn";
  active: boolean;
};

type SalesRuleAssignmentsListProps = {
  itemId: string;
  assignments: AssignedSalesRule[];
  library: SalesRuleLibraryRule[];
};

export default function SalesRuleAssignmentsList({
  itemId,
  assignments,
  library
}: SalesRuleAssignmentsListProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const { isGated } = usePlanGate({ feature: "SALES_RULES" });
  // Assignment mutations are gated on `update: "sales"` (the assign/unassign
  // routes), so the UI mirrors that single permission.
  const canUpdate = permissions.can("update", "sales");
  const description = t`Enforce checks on quote, sales order, and sales invoice lines for this item.`;

  const assignedSet = useMemo(
    () => new Set(assignments.map((a) => a.ruleId)),
    [assignments]
  );

  const available = useMemo(
    () => library.filter((r) => r.active && !assignedSet.has(r.id)),
    [library, assignedSet]
  );

  const availableOptions = useMemo(
    () => available.map((r) => ({ value: r.id, label: r.name })),
    [available]
  );

  const handleAssign = (ruleId: string) => {
    if (!ruleId) return;
    const fd = new FormData();
    fd.set("ruleId", ruleId);
    fetcher.submit(fd, {
      method: "post",
      action: path.to.salesRuleAssign(itemId)
    });
  };

  const isEmpty = assignments.length === 0;

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">
            <Trans>Sales rules</Trans>
          </h2>
          {!isEmpty && (
            <span className="text-sm font-normal text-muted-foreground tabular-nums">
              {assignments.length}
            </span>
          )}
        </div>
        <p className="mt-1 max-w-[64ch] text-sm text-muted-foreground text-pretty">
          {description}
        </p>
      </div>
      {!isEmpty && canUpdate && (
        <div className="flex shrink-0 items-center gap-2">
          {availableOptions.length > 0 && (
            <Combobox
              size="md"
              value=""
              options={availableOptions}
              onChange={handleAssign}
              placeholder={t`Add from library…`}
              className="w-[200px]"
            />
          )}
          <Button variant="primary" leftIcon={<LuPlus />} asChild>
            <Link to={path.to.newSalesRule}>
              <Trans>Add rule</Trans>
            </Link>
          </Button>
        </div>
      )}
    </div>
  );

  if (isGated) {
    return (
      <Card className="flex-grow">
        <CardHeader>{header}</CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
            <UpgradeOverlayIcon>
              <LuShieldCheck className="size-6 text-muted-foreground" />
            </UpgradeOverlayIcon>
            <UpgradeOverlayContent>
              <UpgradeOverlayTitle>
                <Trans>Upgrade to unlock sales rules</Trans>
              </UpgradeOverlayTitle>
              <UpgradeOverlayDescription>
                {description}
              </UpgradeOverlayDescription>
            </UpgradeOverlayContent>
            <UpgradeOverlayActions>
              <UpgradeOverlayUpgradeButton />
            </UpgradeOverlayActions>
          </div>
        </CardContent>
      </Card>
    );
  }

  const body = isEmpty ? (
    <div className="flex flex-col items-center justify-center gap-5 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <LuShieldCheck className="size-6 text-muted-foreground" />
      </div>

      <div className="flex flex-col gap-1.5 max-w-md">
        <p className="text-base font-medium">
          <Trans>No rules assigned</Trans>
        </p>
        <p className="text-sm text-muted-foreground">
          <Trans>
            Pick an existing rule from the library or create a new one to start
            enforcing checks on this item.
          </Trans>
        </p>
      </div>

      {canUpdate && (
        <HStack className="gap-2 flex-wrap justify-center pt-1">
          {availableOptions.length > 0 ? (
            <>
              <Combobox
                value=""
                options={availableOptions}
                onChange={handleAssign}
                placeholder={t`Add from library…`}
              />
              <Button
                asChild
                variant="secondary"
                size="sm"
                leftIcon={<LuPlus />}
              >
                <Link to={path.to.newSalesRule}>
                  <Trans>Create new rule</Trans>
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button
                asChild
                variant="secondary"
                size="sm"
                leftIcon={<LuLibrary />}
              >
                <Link to={path.to.salesRules}>
                  <Trans>Browse library</Trans>
                </Link>
              </Button>
              <Button asChild size="sm" leftIcon={<LuPlus />}>
                <Link to={path.to.newSalesRule}>
                  <Trans>Create new rule</Trans>
                </Link>
              </Button>
            </>
          )}
        </HStack>
      )}
    </div>
  ) : (
    <Table>
      <Thead>
        <Tr>
          <Th>
            <Trans>Name</Trans>
          </Th>
          <Th>
            <Trans>Severity</Trans>
          </Th>
          <Th>
            <Trans>Surfaces</Trans>
          </Th>
          <Th>
            <Trans>Status</Trans>
          </Th>
          <Th>
            <Trans>Message</Trans>
          </Th>
          <Th />
        </Tr>
      </Thead>
      <Tbody>
        {assignments.map((a) => {
          const isBroadcast = a.inheritedFromId === "__all__";
          const surfaces =
            a.salesRule.surfaces && a.salesRule.surfaces.length > 0
              ? a.salesRule.surfaces
              : [...SALES_RULE_SURFACES];
          return (
            <Tr key={a.ruleId}>
              <Td className="whitespace-nowrap">
                <HStack className="gap-2 items-center flex-wrap">
                  <Hyperlink to={path.to.salesRule(a.ruleId)}>
                    <HStack className="gap-2 items-center">
                      <LuShieldCheck className="text-muted-foreground shrink-0" />
                      <span>{a.salesRule.name}</span>
                    </HStack>
                  </Hyperlink>
                  {isBroadcast && (
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase tracking-wide"
                    >
                      {a.inheritedFromName ?? <Trans>All items</Trans>}
                    </Badge>
                  )}
                </HStack>
              </Td>
              <Td>
                {a.salesRule.severity === "error" ? (
                  <Badge variant="red">
                    <Trans>Error</Trans>
                  </Badge>
                ) : (
                  <Badge variant="yellow">
                    <Trans>Warning</Trans>
                  </Badge>
                )}
              </Td>
              <Td>
                <div className="flex items-center gap-1">
                  {surfaces.map((s) => (
                    <Badge key={s} variant="secondary">
                      {SALES_RULE_SURFACE_LABELS[s]}
                    </Badge>
                  ))}
                </div>
              </Td>
              <Td>
                {a.salesRule.active ? (
                  <Status color="green">
                    <Trans>Active</Trans>
                  </Status>
                ) : (
                  <Status color="gray">
                    <Trans>Inactive</Trans>
                  </Status>
                )}
              </Td>
              <Td className="w-full max-w-0">
                <p className="text-muted-foreground truncate max-w-xl">
                  {a.salesRule.message}
                </p>
              </Td>
              <Td className="text-right">
                <Form
                  method="post"
                  action={path.to.salesRuleUnassign(itemId, a.ruleId)}
                >
                  <IconButton
                    type="submit"
                    icon={<LuTrash />}
                    aria-label={
                      isBroadcast
                        ? t`Edit the rule's item filters to remove it`
                        : t`Unassign rule`
                    }
                    title={
                      isBroadcast
                        ? t`Edit the rule's item filters to remove it`
                        : undefined
                    }
                    variant="ghost"
                    size="sm"
                    isDisabled={!canUpdate || isBroadcast}
                  />
                </Form>
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );

  return (
    <Card className="flex-grow">
      <CardHeader>{header}</CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
