import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import type { TransactionSurface } from "@carbon/utils";
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
import SurfaceChips from "./SurfaceChips";

type AssignedRule = {
  ruleId: string;
  rule: {
    id: string;
    name: string;
    severity: "error" | "warn";
    message: string;
    active: boolean;
    surfaces?: TransactionSurface[];
  };
  /**
   * When set, this row was inherited from an ancestor storage unit. UI
   * shows an "Inherited from …" badge and disables the unassign action —
   * the user must go to the parent unit's drawer to remove it.
   */
  inheritedFromId?: string | null;
  inheritedFromName?: string | null;
};

type LibraryRule = {
  id: string;
  name: string;
  severity: "error" | "warn";
  active: boolean;
};

type TargetType = "item" | "workCenter";

type RuleAssignmentsListProps = {
  targetType: TargetType;
  targetId: string;
  assignments: AssignedRule[];
  library: LibraryRule[];
  /**
   * `card` (default) — full Card chrome with shadow + border. Use on
   * standalone tab pages (item details, etc).
   * `flat` — no Card wrapper; renders inside a ModalDrawer's body where the
   * drawer already provides the surface.
   */
  variant?: "card" | "flat";
};

// Target-specific copy. Keeps the card description grounded in the right
// nouns and surface list per rule type.
const TARGET_COPY: Record<TargetType, { noun: string; surfaceBlurb: string }> =
  {
    item: {
      noun: "item",
      surfaceBlurb:
        "receipts, shipments, transfers, inventory adjustments and bin moves"
    },
    workCenter: {
      noun: "work center",
      surfaceBlurb: "operation start/finish and material moves"
    }
  };

const ASSIGN_PATH = {
  item: path.to.storageRuleAssignItem,
  workCenter: path.to.storageRuleAssignWorkCenter
};

const UNASSIGN_PATH = {
  item: path.to.storageRuleUnassignItem,
  workCenter: path.to.storageRuleUnassignWorkCenter
};

const PERM_MODULE: Record<TargetType, "parts" | "resources"> = {
  item: "parts",
  workCenter: "resources"
};

export default function RuleAssignmentsList({
  targetType,
  targetId,
  assignments,
  library,
  variant = "card"
}: RuleAssignmentsListProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const { isGated } = usePlanGate({ feature: "STORAGE_RULES" });
  const module = PERM_MODULE[targetType];
  const canCreate = permissions.can("create", module);
  const canDelete = permissions.can("delete", module);
  const targetCopy = TARGET_COPY[targetType];
  const description = `Enforce constraints on ${targetCopy.surfaceBlurb} for this ${targetCopy.noun}.`;

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
      action: ASSIGN_PATH[targetType](targetId)
    });
  };

  const isEmpty = assignments.length === 0;

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">
            <Trans>Rules</Trans>
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
      {!isEmpty && canCreate && (
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
            <Link to={`${path.to.newStorageRule}?targetType=${targetType}`}>
              <Trans>Add rule</Trans>
            </Link>
          </Button>
        </div>
      )}
    </div>
  );

  if (isGated) {
    const gatedBody = (
      <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
        <UpgradeOverlayIcon>
          <LuShieldCheck className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Upgrade to unlock {targetCopy.noun} rules</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>{description}</UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <UpgradeOverlayUpgradeButton />
        </UpgradeOverlayActions>
      </div>
    );
    if (variant === "flat") {
      return (
        <div className="flex flex-col gap-4">
          {header}
          {gatedBody}
        </div>
      );
    }
    return (
      <Card className="flex-grow">
        <CardHeader>
          <CardTitle>
            <Trans>Rules</Trans>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{gatedBody}</CardContent>
      </Card>
    );
  }

  const body = isEmpty ? (
    <EmptyState
      availableOptions={availableOptions}
      canCreate={canCreate}
      onAssign={handleAssign}
      targetNoun={targetCopy.noun}
    />
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
          {variant === "card" && (
            <Th>
              <Trans>Message</Trans>
            </Th>
          )}
          <Th />
        </Tr>
      </Thead>
      <Tbody>
        {assignments.map((a) => {
          const isBroadcast = a.inheritedFromId === "__all__";
          const isLocked = isBroadcast;
          return (
            <Tr key={a.ruleId}>
              <Td className="whitespace-nowrap">
                <HStack className="gap-2 items-center flex-wrap">
                  <Hyperlink to={path.to.storageRule(a.ruleId)}>
                    <HStack className="gap-2 items-center">
                      <LuShieldCheck className="text-muted-foreground shrink-0" />
                      <span>{a.rule.name}</span>
                    </HStack>
                  </Hyperlink>
                  {isBroadcast && (
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase tracking-wide"
                    >
                      <Trans>Applies to all</Trans>
                    </Badge>
                  )}
                </HStack>
              </Td>
              <Td>
                {a.rule.severity === "error" ? (
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
                <SurfaceChips
                  surfaces={a.rule.surfaces}
                  targetType={targetType}
                />
              </Td>
              <Td>
                {a.rule.active ? (
                  <Status color="green">
                    <Trans>Active</Trans>
                  </Status>
                ) : (
                  <Status color="gray">
                    <Trans>Inactive</Trans>
                  </Status>
                )}
              </Td>
              {variant === "card" && (
                <Td className="w-full max-w-0">
                  <p className="text-muted-foreground truncate max-w-xl">
                    {a.rule.message}
                  </p>
                </Td>
              )}
              <Td className="text-right">
                <Form
                  method="post"
                  action={UNASSIGN_PATH[targetType](targetId, a.ruleId)}
                >
                  <IconButton
                    type="submit"
                    icon={<LuTrash />}
                    aria-label={
                      isBroadcast
                        ? t`Edit the rule to remove the "Applies to all" flag`
                        : t`Unassign rule`
                    }
                    title={
                      isBroadcast
                        ? t`Edit the rule to remove the "Applies to all" flag`
                        : undefined
                    }
                    variant="ghost"
                    size="sm"
                    isDisabled={!canDelete || isLocked}
                  />
                </Form>
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );

  if (variant === "flat") {
    return (
      <div className="flex flex-col gap-4">
        {header}
        {body}
      </div>
    );
  }

  return (
    <Card className="flex-grow">
      <CardHeader>{header}</CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

type EmptyStateProps = {
  availableOptions: { value: string; label: string }[];
  canCreate: boolean;
  onAssign: (ruleId: string) => void;
  targetNoun: string;
};

function EmptyState({
  availableOptions,
  canCreate,
  onAssign,
  targetNoun
}: EmptyStateProps) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <LuShieldCheck className="size-6 text-muted-foreground" />
      </div>

      <div className="flex flex-col gap-1.5 max-w-md">
        <p className="text-base font-medium">
          <Trans>No rules assigned</Trans>
        </p>
        <p className="text-sm text-muted-foreground">
          Pick an existing rule from the library or create a new one to start
          enforcing constraints on this {targetNoun}.
        </p>
      </div>

      {canCreate && (
        <HStack className="gap-2 flex-wrap justify-center pt-1">
          {availableOptions.length > 0 ? (
            <>
              <Combobox
                value=""
                options={availableOptions}
                onChange={onAssign}
                placeholder={t`Add from library…`}
              />
              <Button
                asChild
                variant="secondary"
                size="sm"
                leftIcon={<LuPlus />}
              >
                <Link to={path.to.newStorageRule}>
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
                <Link to={path.to.storageRules}>
                  <Trans>Browse library</Trans>
                </Link>
              </Button>
              <Button asChild size="sm" leftIcon={<LuPlus />}>
                <Link to={path.to.newStorageRule}>
                  <Trans>Create new rule</Trans>
                </Link>
              </Button>
            </>
          )}
        </HStack>
      )}
    </div>
  );
}
