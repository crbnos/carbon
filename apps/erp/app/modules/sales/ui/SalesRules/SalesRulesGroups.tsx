// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// List for Sales → Sales Rules. Mirrors
// `~/modules/inventory/ui/StorageRules/StorageRulesGroups` minus the targetType
// split; permission checks use `sales`.

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  ScrollArea,
  Status,
  Subheading,
  useDisclosure,
  VStack
} from "@carbon/react";
import { SALES_RULE_SURFACES, type SalesRuleSurface } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { memo, useCallback } from "react";
import {
  LuEllipsisVertical,
  LuPencil,
  LuPlus,
  LuShieldCheck,
  LuTrash
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { Empty } from "~/components";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import { SALES_RULE_SURFACE_LABELS } from "./SalesRulesTable";

type SalesRuleListItem = {
  id: string;
  name: string;
  severity: "error" | "warn";
  active: boolean;
  filteredItemTypes?: string[] | null;
  filteredItemGroupIds?: string[] | null;
  surfaces?: SalesRuleSurface[] | null;
  assignmentCount?: number;
  description?: string | null;
  message?: string;
};

// Sales rules reach items through type/group filters; empty = all items.
function ruleReach(
  rule: SalesRuleListItem,
  t: ReturnType<typeof useLingui>["t"]
): {
  broadcastLabel: string | null;
  showAssignments: boolean;
} {
  const types = rule.filteredItemTypes?.length ?? 0;
  const groups = rule.filteredItemGroupIds?.length ?? 0;
  if (types === 0 && groups === 0) {
    return { broadcastLabel: t`All items`, showAssignments: false };
  }
  const parts: string[] = [];
  if (types) parts.push(types === 1 ? t`1 type` : t`${types} types`);
  if (groups) parts.push(groups === 1 ? t`1 group` : t`${groups} groups`);
  return { broadcastLabel: parts.join(" · "), showAssignments: true };
}

type SalesRulesGroupsProps = {
  rules: SalesRuleListItem[];
};

const SalesRulesGroups = memo(({ rules }: SalesRulesGroupsProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const permissions = usePermissions();
  const canCreate = permissions.can("create", "sales");

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] bg-card">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4 max-md:py-4"
      >
        <div className="flex flex-col gap-1 w-full">
          <Heading
            size="h3"
            className="tracking-tight text-balance max-md:sr-only"
          >
            <Trans>Sales Rules</Trans>
          </Heading>
          <p className="max-w-[72ch] text-sm text-muted-foreground text-pretty">
            <Trans>
              Predicate-driven guards that fire on sales lines. Block with
              errors or warn with acknowledge-to-continue.
            </Trans>
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <LuShieldCheck className="size-4 text-muted-foreground" />
                  <Trans>Sales rules</Trans>
                </CardTitle>
                <CardDescription className="mt-1 max-w-[60ch] text-sm text-pretty">
                  <Trans>
                    Fire on quote lines, sales order lines and sales invoice
                    lines.
                  </Trans>
                </CardDescription>
              </div>
              {canCreate && (
                <Button variant="primary" leftIcon={<LuPlus />} asChild>
                  <Link to={`${path.to.newSalesRule}?${params.toString()}`}>
                    {t`Sales Rule`}
                  </Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {rules.length === 0 ? (
              <Empty className="my-4" />
            ) : (
              <VStack spacing={3} className="items-stretch">
                {rules.map((r) => (
                  <SalesRuleCard key={r.id} rule={r} />
                ))}
              </VStack>
            )}
          </CardContent>
        </Card>
      </VStack>
    </ScrollArea>
  );
});

SalesRulesGroups.displayName = "SalesRulesGroups";
export default SalesRulesGroups;

const SalesRuleCard = memo(({ rule }: { rule: SalesRuleListItem }) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const deleteDisclosure = useDisclosure();

  const canEdit = permissions.can("update", "sales");
  const canDelete = permissions.can("delete", "sales");
  const { broadcastLabel, showAssignments } = ruleReach(rule, t);
  const surfaces =
    rule.surfaces && rule.surfaces.length > 0
      ? rule.surfaces
      : [...SALES_RULE_SURFACES];

  const handleEdit = useCallback(() => {
    navigate(`${path.to.salesRule(rule.id)}?${params.toString()}`);
  }, [navigate, params, rule.id]);

  return (
    <>
      <Card className="p-0 border">
        <Accordion type="multiple" className="w-full">
          <AccordionItem value={rule.id} className="border-none">
            <div className="relative">
              <AccordionTrigger className="px-6 py-6 hover:no-underline w-full max-md:px-4 max-md:py-4 max-md:min-w-0">
                <HStack
                  spacing={4}
                  className="flex-1 justify-between pr-12 max-md:min-w-0 max-md:flex-wrap max-md:space-x-0 max-md:gap-2 max-md:pr-14"
                >
                  <div className="flex items-center gap-3 min-w-0 max-md:basis-full">
                    <Heading size="h4" as="h3" className="truncate">
                      {rule.name}
                    </Heading>
                    {rule.severity === "error" ? (
                      <Badge variant="red" className="max-md:shrink-0">
                        <Trans>Error</Trans>
                      </Badge>
                    ) : (
                      <Badge variant="yellow" className="max-md:shrink-0">
                        <Trans>Warn</Trans>
                      </Badge>
                    )}
                    {broadcastLabel && (
                      <Badge variant="outline" className="max-md:shrink-0">
                        {broadcastLabel}
                      </Badge>
                    )}
                  </div>
                  <Status
                    color={rule.active ? "green" : "gray"}
                    className="text-xs font-medium"
                  >
                    {rule.active ? t`Active` : t`Inactive`}
                  </Status>
                </HStack>
              </AccordionTrigger>
              <div className="absolute right-12 top-1/2 -translate-y-1/2 z-10">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label={t`More options`}
                      icon={<LuEllipsisVertical />}
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      shortcut={MENU_ITEM_SHORTCUTS.edit}
                      disabled={!canEdit}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit();
                      }}
                    >
                      <LuPencil className="mr-2 h-4 w-4" />
                      <Trans>Edit Rule</Trans>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      shortcut={MENU_ITEM_SHORTCUTS.delete}
                      destructive
                      disabled={!canDelete}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDisclosure.onOpen();
                      }}
                    >
                      <LuTrash className="mr-2 h-4 w-4" />
                      <Trans>Delete Rule</Trans>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <AccordionContent className="px-6 pb-5">
              <VStack spacing={3}>
                {rule.description && (
                  <p className="text-sm text-muted-foreground">
                    {rule.description}
                  </p>
                )}
                {rule.message && (
                  <div className="flex flex-col gap-1">
                    <Subheading variant="heavy">
                      <Trans>Message</Trans>
                    </Subheading>
                    <p className="text-sm">{rule.message}</p>
                  </div>
                )}
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex flex-col gap-1">
                    <Subheading variant="heavy">
                      <Trans>Triggers</Trans>
                    </Subheading>
                    <div className="flex items-center gap-1">
                      {surfaces.map((s) => (
                        <Badge key={s} variant="secondary">
                          {t(SALES_RULE_SURFACE_LABELS[s])}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {showAssignments && (
                    <div className="flex flex-col gap-1">
                      <Subheading variant="heavy">
                        <Trans>Assignments</Trans>
                      </Subheading>
                      <span className="tabular-nums text-sm">
                        {rule.assignmentCount ?? 0}
                      </span>
                    </div>
                  )}
                </div>
              </VStack>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
      <ConfirmDelete
        action={path.to.deleteSalesRule(rule.id)}
        isOpen={deleteDisclosure.isOpen}
        name={t`Sales rule "${rule.name}"`}
        text={t`Are you sure you want to delete this sales rule? Assignments will also be removed.`}
        onCancel={deleteDisclosure.onClose}
        onSubmit={deleteDisclosure.onClose}
      />
    </>
  );
});

SalesRuleCard.displayName = "SalesRuleCard";
