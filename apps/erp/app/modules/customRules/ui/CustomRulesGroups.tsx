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
  ScrollArea,
  Status,
  useDisclosure,
  VStack
} from "@carbon/react";
import type { TargetType, TransactionSurface } from "@carbon/utils";
import { memo, useCallback, useMemo } from "react";
import {
  LuEllipsisVertical,
  LuPackage,
  LuPencil,
  LuPlus,
  LuTrash,
  LuWarehouse
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import { Empty } from "~/components";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import SurfaceChips from "./SurfaceChips";

type RuleListItem = {
  id: string;
  name: string;
  targetType: TargetType;
  severity: "error" | "warn";
  active: boolean;
  appliesToAll: boolean;
  filteredItemTypes?: string[];
  filteredItemGroupIds?: string[];
  surfaces?: TransactionSurface[];
  assignmentCount?: number;
  description?: string | null;
  message?: string;
};

// How a rule reaches its targets, for the badge + assignment display.
// Item rules use type/group filters (empty = all items); other targets use the
// appliesToAll broadcast flag.
function ruleReach(rule: RuleListItem): {
  broadcastLabel: string | null;
  showAssignments: boolean;
} {
  if (rule.targetType === "item") {
    const types = rule.filteredItemTypes ?? [];
    const groups = rule.filteredItemGroupIds ?? [];
    if (types.length === 0 && groups.length === 0) {
      return { broadcastLabel: "All items", showAssignments: false };
    }
    const parts: string[] = [];
    if (types.length)
      parts.push(`${types.length} type${types.length > 1 ? "s" : ""}`);
    if (groups.length)
      parts.push(`${groups.length} group${groups.length > 1 ? "s" : ""}`);
    return { broadcastLabel: parts.join(" · "), showAssignments: true };
  }
  return {
    broadcastLabel: rule.appliesToAll ? "Applies to all" : null,
    showAssignments: !rule.appliesToAll
  };
}

type CustomRulesGroupsProps = {
  rules: RuleListItem[];
};

const TARGET_LABEL: Record<TargetType, string> = {
  item: "Item",
  storageUnit: "Storage unit",
  workCenter: "Work center"
};

type SectionCardProps = {
  title: string;
  description: string;
  icon: JSX.Element;
  newRuleHref: string;
  newRuleLabel: string;
  canCreate: boolean;
  rules: RuleListItem[];
};

const RuleSectionCard = memo(
  ({
    title,
    description,
    icon,
    newRuleHref,
    newRuleLabel,
    canCreate,
    rules
  }: SectionCardProps) => (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              {icon}
              {title}
            </CardTitle>
            <CardDescription className="mt-1 max-w-[60ch] text-sm text-pretty">
              {description}
            </CardDescription>
          </div>
          {canCreate && (
            <Button variant="primary" leftIcon={<LuPlus />} asChild>
              <Link to={newRuleHref}>{newRuleLabel}</Link>
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
              <CustomRuleCard key={r.id} rule={r} />
            ))}
          </VStack>
        )}
      </CardContent>
    </Card>
  )
);
RuleSectionCard.displayName = "RuleSectionCard";

const CustomRulesGroups = memo(({ rules }: CustomRulesGroupsProps) => {
  const permissions = usePermissions();
  const canCreate = permissions.can("create", "settings");

  // Split by targetType. Item + storageUnit shown; workCenter hidden until
  // entry point + MES modal ship.
  const { itemRules, storageUnitRules } = useMemo(() => {
    const itemRules: RuleListItem[] = [];
    const storageUnitRules: RuleListItem[] = [];
    for (const r of rules) {
      if (r.targetType === "item") itemRules.push(r);
      else if (r.targetType === "storageUnit") storageUnitRules.push(r);
    }
    return { itemRules, storageUnitRules };
  }, [rules]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <div className="flex flex-col gap-1 w-full">
          <Heading size="h3" className="tracking-tight text-balance">
            Custom Rules
          </Heading>
          <p className="max-w-[72ch] text-sm text-muted-foreground text-pretty">
            Predicate-driven guards that fire on inventory transactions. Block
            with errors or warn with acknowledge-to-continue.
          </p>
        </div>

        <RuleSectionCard
          title="Item rules"
          description="Fire on receipts, shipments, transfers and inventory adjustments. Target items."
          icon={<LuPackage className="size-4 text-muted-foreground" />}
          newRuleHref={`${path.to.newCustomRule}?targetType=item`}
          newRuleLabel="Item Rule"
          canCreate={canCreate}
          rules={itemRules}
        />

        <RuleSectionCard
          title="Storage unit rules"
          description="Fire on place, pick and transfers. Target storage units."
          icon={<LuWarehouse className="size-4 text-muted-foreground" />}
          newRuleHref={`${path.to.newCustomRule}?targetType=storageUnit`}
          newRuleLabel="Storage Unit Rule"
          canCreate={canCreate}
          rules={storageUnitRules}
        />

        {/*
          Production rules card — hidden until work center rule wiring
          (entry point on the work centers list, drawer/tab to manage
          assignments, MES violation modal) ships. To restore: split
          workCenter rules out of `rules` above and render a third
          RuleSectionCard with `newRuleHref` pointing to targetType=workCenter.
        */}
      </VStack>
    </ScrollArea>
  );
});

CustomRulesGroups.displayName = "CustomRulesGroups";
export default CustomRulesGroups;

const CustomRuleCard = memo(({ rule }: { rule: RuleListItem }) => {
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const deleteDisclosure = useDisclosure();

  const canEdit = permissions.can("update", "settings");
  const canDelete = permissions.can("delete", "settings");
  const { broadcastLabel, showAssignments } = ruleReach(rule);

  const handleEdit = useCallback(() => {
    navigate(`${path.to.customRule(rule.id)}?${params.toString()}`);
  }, [navigate, params, rule.id]);

  return (
    <>
      <Card className="p-0 border">
        <Accordion type="multiple" className="w-full">
          <AccordionItem value={rule.id} className="border-none">
            <div className="relative">
              <AccordionTrigger className="px-6 py-6 hover:no-underline w-full">
                <HStack spacing={4} className="flex-1 justify-between pr-12">
                  <div className="flex items-center gap-3 min-w-0">
                    <Heading size="h4" as="h3" className="truncate">
                      {rule.name}
                    </Heading>
                    <Badge variant="secondary">
                      {TARGET_LABEL[rule.targetType]}
                    </Badge>
                    {rule.severity === "error" ? (
                      <Badge variant="red">Error</Badge>
                    ) : (
                      <Badge variant="yellow">Warn</Badge>
                    )}
                    {broadcastLabel && (
                      <Badge variant="outline">{broadcastLabel}</Badge>
                    )}
                  </div>
                  <Status
                    color={rule.active ? "green" : "gray"}
                    className="text-xs font-medium"
                  >
                    {rule.active ? "Active" : "Inactive"}
                  </Status>
                </HStack>
              </AccordionTrigger>
              <div className="absolute right-12 top-1/2 -translate-y-1/2 z-10">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="More options"
                      icon={<LuEllipsisVertical />}
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={!canEdit}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit();
                      }}
                    >
                      <LuPencil className="mr-2 h-4 w-4" />
                      Edit Rule
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      disabled={!canDelete}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDisclosure.onOpen();
                      }}
                    >
                      <LuTrash className="mr-2 h-4 w-4" />
                      Delete Rule
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
                    <span className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                      Message
                    </span>
                    <p className="text-sm">{rule.message}</p>
                  </div>
                )}
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                      Triggers
                    </span>
                    <SurfaceChips
                      surfaces={rule.surfaces}
                      targetType={rule.targetType}
                    />
                  </div>
                  {showAssignments && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                        Assignments
                      </span>
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
        action={path.to.deleteCustomRule(rule.id)}
        isOpen={deleteDisclosure.isOpen}
        name={`${TARGET_LABEL[rule.targetType]} rule "${rule.name}"`}
        text="Are you sure you want to delete this custom rule? Assignments will also be removed."
        onCancel={deleteDisclosure.onClose}
        onSubmit={deleteDisclosure.onClose}
      />
    </>
  );
});

CustomRuleCard.displayName = "CustomRuleCard";
