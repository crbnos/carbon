import {
  Badge,
  Button,
  Card,
  CardAction,
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
import { usePermissions } from "~/hooks";
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
};

type LibraryRule = {
  id: string;
  name: string;
  severity: "error" | "warn";
  active: boolean;
};

type ItemRuleAssignmentsProps = {
  itemId: string;
  assignments: AssignedRule[];
  library: LibraryRule[];
};

export default function ItemRuleAssignments({
  itemId,
  assignments,
  library
}: ItemRuleAssignmentsProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const canCreate = permissions.can("create", "parts");
  const canDelete = permissions.can("delete", "parts");

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
      action: path.to.itemRuleAssign(itemId)
    });
  };

  const isEmpty = assignments.length === 0;

  return (
    <Card className="flex-grow">
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>
            <HStack className="gap-2 items-baseline">
              <span>
                <Trans>Rules</Trans>
              </span>
              {!isEmpty && (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {assignments.length}
                </span>
              )}
            </HStack>
          </CardTitle>
          <CardDescription>
            <Trans>
              Enforce constraints on receipts, shipments, transfers and job
              operations for this item.
            </Trans>
          </CardDescription>
        </CardHeader>
        {!isEmpty && canCreate && (
          <CardAction>
            <HStack className="gap-2">
              {availableOptions.length > 0 && (
                <Combobox
                  size="sm"
                  value=""
                  options={availableOptions}
                  onChange={handleAssign}
                  placeholder={t`Add from library…`}
                />
              )}
              <Button asChild variant="secondary" size="sm">
                <Link to={path.to.newItemRule}>
                  <Trans>Add rule</Trans>
                </Link>
              </Button>
            </HStack>
          </CardAction>
        )}
      </HStack>

      <CardContent>
        {isEmpty ? (
          <EmptyState
            availableOptions={availableOptions}
            canCreate={canCreate}
            onAssign={handleAssign}
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
                <Th>
                  <Trans>Message</Trans>
                </Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {assignments.map((a) => (
                <Tr key={a.ruleId}>
                  <Td className="whitespace-nowrap">
                    <Hyperlink to={path.to.itemRule(a.ruleId)}>
                      <HStack className="gap-2 items-center">
                        <LuShieldCheck className="text-muted-foreground shrink-0" />
                        <span>{a.rule.name}</span>
                      </HStack>
                    </Hyperlink>
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
                    <SurfaceChips surfaces={a.rule.surfaces} />
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
                  <Td className="w-full max-w-0">
                    <p className="text-muted-foreground truncate max-w-xl">
                      {a.rule.message}
                    </p>
                  </Td>
                  <Td className="text-right">
                    <Form
                      method="post"
                      action={path.to.itemRuleUnassign(itemId, a.ruleId)}
                    >
                      <IconButton
                        type="submit"
                        icon={<LuTrash />}
                        aria-label={t`Unassign rule`}
                        variant="ghost"
                        size="sm"
                        isDisabled={!canDelete}
                      />
                    </Form>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

type EmptyStateProps = {
  availableOptions: { value: string; label: string }[];
  canCreate: boolean;
  onAssign: (ruleId: string) => void;
};

function EmptyState({
  availableOptions,
  canCreate,
  onAssign
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
          <Trans>
            Pick an existing rule from the library or create a new one to start
            enforcing constraints on this item.
          </Trans>
        </p>
      </div>

      {canCreate && (
        <HStack className="gap-2 flex-wrap justify-center pt-1">
          {availableOptions.length > 0 ? (
            <>
              <Combobox
                size="sm"
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
                <Link to={path.to.newItemRule}>
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
                <Link to={path.to.itemRules}>
                  <Trans>Browse library</Trans>
                </Link>
              </Button>
              <Button asChild size="sm" leftIcon={<LuPlus />}>
                <Link to={path.to.newItemRule}>
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
