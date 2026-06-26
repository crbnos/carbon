import type { AuditLogEntry } from "@carbon/database/audit.types";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  ChoiceCardGroup,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  LabelWithHelp,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  Skeleton,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuEllipsisVertical,
  LuHistory,
  LuSquareUser,
  LuTrash,
  LuUsers
} from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Empty } from "~/components";
import AuditLogDrawer, {
  AuditLogEntryCard
} from "~/components/AuditLog/AuditLogDrawer";
import { EditableNumber } from "~/components/Editable";
import {
  Boolean as BooleanField,
  Customer,
  CustomerType,
  DatePicker,
  Hidden,
  Item,
  Submit,
  TextArea
} from "~/components/Form";
import Grid from "~/components/Grid";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import { priceOverrideValidator } from "../../sales.models";
import type { PriceOverrideBreak } from "../../types";

type ScopeType = "customer" | "customerType";

type PriceOverrideFormProps = {
  initialValues: z.infer<typeof priceOverrideValidator>;
  initialBreaks?: PriceOverrideBreak[];
  initialScope?: ScopeType;
  onClose: () => void;
};

const PriceOverrideForm = ({
  initialValues,
  initialBreaks,
  initialScope,
  onClose
}: PriceOverrideFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const auditDisclosure = useDisclosure();

  const [scope, setScope] = useState<ScopeType>(() => {
    if (initialValues.customerId) return "customer";
    if (initialValues.customerTypeId) return "customerType";
    return initialScope ?? "customer";
  });

  const [breaks, setBreaks] = useState<PriceOverrideBreak[]>(() => {
    const seed =
      Array.isArray(initialBreaks) && initialBreaks.length > 0
        ? initialBreaks.map((b) => ({
            id: b.id,
            quantity: Number(b.quantity) || 0,
            overridePrice: Number(b.overridePrice) || 0,
            active: b.active !== false
          }))
        : [{ quantity: 1, overridePrice: 0, active: true }];
    return seed.sort((a, b) => a.quantity - b.quantity);
  });

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  // Early-termination controls — only sales:delete can edit once live.
  const canTerminate = permissions.can("delete", "sales");
  const lifecycleLocked = isEditing && !canTerminate;

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={priceOverrideValidator}
            method="post"
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <div className="flex items-center justify-between gap-2">
                <ModalDrawerTitle>
                  {isEditing ? t`Edit Price Override` : t`New Price Override`}
                </ModalDrawerTitle>
                {isEditing && initialValues.id && (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<LuHistory />}
                    onClick={auditDisclosure.onOpen}
                  >
                    {t`History`}
                  </Button>
                )}
              </div>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="breaks" value={JSON.stringify(breaks)} />
              <VStack spacing={4}>
                <Item name="itemId" label={t`Item`} type="Part" />

                <ChoiceCardGroup<ScopeType>
                  label={t`Apply To`}
                  value={scope}
                  onChange={setScope}
                  options={[
                    {
                      value: "customer",
                      title: t`Specific Customer`,
                      description: t`Override price for a single customer`,
                      icon: <LuSquareUser />
                    },
                    {
                      value: "customerType",
                      title: t`Customer Type`,
                      description: t`Override price for all customers of a type`,
                      icon: <LuUsers />
                    }
                  ]}
                />

                {scope === "customer" && (
                  <>
                    <Customer name="customerId" label={t`Customer`} />
                    <Hidden name="customerTypeId" value="" />
                  </>
                )}

                {scope === "customerType" && (
                  <>
                    <CustomerType
                      name="customerTypeId"
                      label={t`Customer Type`}
                    />
                    <Hidden name="customerId" value="" />
                  </>
                )}

                <PriceBreaks
                  breaks={breaks}
                  onChange={setBreaks}
                  baseCurrency={baseCurrency}
                  isDisabled={isDisabled}
                  overrideId={initialValues.id}
                  companyId={company?.id}
                />

                <div className="grid grid-cols-2 gap-3 w-full">
                  <BooleanField
                    name="active"
                    label={t`Active`}
                    termId="price-override-active"
                    isDisabled={lifecycleLocked}
                  />
                  <BooleanField
                    name="applyRulesOnTop"
                    label={t`Apply pricing rules`}
                    termId="price-override-apply-rules-on-top"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 w-full">
                  <DatePicker name="validFrom" label={t`Valid From`} />
                  <DatePicker
                    name="validTo"
                    label={t`Valid To`}
                    isDisabled={lifecycleLocked}
                  />
                </div>

                <TextArea name="notes" label={t`Notes`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
      {isEditing && initialValues.id && company?.id && (
        <AuditLogDrawer
          isOpen={auditDisclosure.isOpen}
          onClose={auditDisclosure.onClose}
          entityType="priceOverride"
          entityId={initialValues.id}
          companyId={company.id}
          planRestricted={false}
        />
      )}
    </ModalDrawerProvider>
  );
};

function PriceBreaks({
  breaks,
  onChange,
  baseCurrency,
  isDisabled,
  overrideId,
  companyId
}: {
  breaks: PriceOverrideBreak[];
  onChange: React.Dispatch<React.SetStateAction<PriceOverrideBreak[]>>;
  baseCurrency: string;
  isDisabled: boolean;
  overrideId?: string;
  companyId?: string;
}) {
  const { t } = useLingui();
  const formatter = useCurrencyFormatter();

  const [historyBreakId, setHistoryBreakId] = useState<string | null>(null);
  const fetcher = useFetcher<{ entries: AuditLogEntry[] }>();
  const lastFetchedRef = useRef<string | null>(null);

  // Per-break history: the server filters by recordId so the drawer shows
  // just this rung's timeline (add → price changes → toggle → delete).
  useEffect(() => {
    if (!historyBreakId) {
      lastFetchedRef.current = null;
      return;
    }
    if (!companyId) return;
    const key = historyBreakId;
    if (lastFetchedRef.current === key) return;
    lastFetchedRef.current = key;
    const params = new URLSearchParams({
      entityType: "priceOverrideBreak",
      entityId: historyBreakId,
      companyId
    });
    fetcher.load(`/api/audit-log?${params.toString()}`);
  }, [historyBreakId, companyId, fetcher]);

  const breakHistoryEntries = fetcher.data?.entries ?? [];
  const isHistoryLoading = fetcher.state === "loading";
  const canShowHistory = Boolean(overrideId && companyId);

  const activeCount = breaks.filter((b) => b.active !== false).length;

  const removeRow = useCallback(
    (index: number) => {
      onChange((prev) => prev.filter((_, i) => i !== index));
    },
    [onChange]
  );

  const addRow = useCallback(() => {
    onChange((prev) => {
      const maxQty = prev.reduce((m, b) => Math.max(m, b.quantity), 0);
      return [
        ...prev,
        { quantity: maxQty + 1, overridePrice: 0, active: true }
      ];
    });
  }, [onChange]);

  const toggleActive = useCallback(
    (index: number, next: boolean) => {
      onChange((prev) =>
        prev.map((b, i) => (i === index ? { ...b, active: next } : b))
      );
    },
    [onChange]
  );

  // Grid mutation is a no-op — edits land via local state + form submit.
  const noOpMutation = useCallback(
    async (
      _accessorKey: string,
      _newValue: unknown,
      _row: PriceOverrideBreak
    ) =>
      ({
        data: null,
        error: null,
        count: null,
        status: 200,
        statusText: "OK"
      }) as const,
    []
  );

  const editableComponents = useMemo(
    () => ({
      quantity: EditableNumber(noOpMutation),
      overridePrice: EditableNumber(noOpMutation, {
        formatOptions: { style: "currency", currency: baseCurrency }
      })
    }),
    [noOpMutation, baseCurrency]
  );

  const columns = useMemo<ColumnDef<PriceOverrideBreak>[]>(
    () => [
      {
        accessorKey: "quantity",
        header: t`Quantity`,
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[80px]">
            <span>{row.original.quantity}</span>
            {!isDisabled && (
              <div className="relative w-6 h-5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label={t`Price break actions`}
                      icon={<LuEllipsisVertical />}
                      size="md"
                      className="absolute right-[-1px] top-[-6px]"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {canShowHistory && row.original.id ? (
                      <DropdownMenuItem
                        onClick={() =>
                          setHistoryBreakId(row.original.id ?? null)
                        }
                      >
                        <DropdownMenuIcon icon={<LuHistory />} />
                        {t`View History`}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onClick={() => removeRow(row.index)}
                      destructive
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      {t`Delete Price Break`}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </HStack>
        )
      },
      {
        accessorKey: "overridePrice",
        header: t`Override Price`,
        cell: ({ row }) => formatter.format(row.original.overridePrice)
      },
      {
        accessorKey: "active",
        header: t`Active`,
        cell: ({ row }) => {
          // Guard against disabling the last active break — it would leave
          // the override with zero applicable rungs and silently fall through
          // to the base price, which is never what the user wants. Suggest
          // the parent-level Active toggle instead.
          const isLastActive =
            row.original.active !== false && activeCount <= 1;
          const switchEl = (
            <Switch
              variant="small"
              checked={row.original.active !== false}
              disabled={isDisabled || isLastActive}
              onCheckedChange={(next) => toggleActive(row.index, next === true)}
              aria-label={t`Toggle break active`}
            />
          );
          if (!isLastActive) return switchEl;
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">{switchEl}</span>
              </TooltipTrigger>
              <TooltipContent>
                {t`Can't disable the only active break. Add another break or toggle the override's Active instead.`}
              </TooltipContent>
            </Tooltip>
          );
        }
      }
    ],
    [
      isDisabled,
      removeRow,
      formatter,
      t,
      toggleActive,
      activeCount,
      canShowHistory
    ]
  );

  return (
    <div className="space-y-3 w-full">
      <span className="font-medium text-sm">
        <LabelWithHelp
          termId="price-override-price-breaks"
          variant="inline"
        >{t`Price Breaks`}</LabelWithHelp>
      </span>
      <Grid<PriceOverrideBreak>
        data={breaks}
        columns={columns}
        canEdit={!isDisabled}
        editableComponents={editableComponents}
        onDataChange={onChange}
        onNewRow={!isDisabled ? addRow : undefined}
        contained={false}
      />
      {canShowHistory && (
        <Drawer
          open={historyBreakId !== null}
          onOpenChange={(open) => {
            if (!open) setHistoryBreakId(null);
          }}
        >
          <DrawerContent size="lg" position="left">
            <DrawerHeader>
              <DrawerTitle className="flex items-center gap-2">
                <LuHistory className="size-5" />
                <Trans>Price Break History</Trans>
              </DrawerTitle>
            </DrawerHeader>
            <DrawerBody>
              {isHistoryLoading ? (
                <VStack spacing={3}>
                  <Skeleton className="w-full h-[151px]" />
                  <Skeleton className="w-full h-[151px]" />
                </VStack>
              ) : breakHistoryEntries.length === 0 ? (
                <Empty />
              ) : (
                <VStack spacing={3}>
                  {breakHistoryEntries.map((entry) => (
                    <AuditLogEntryCard key={entry.id} entry={entry} />
                  ))}
                </VStack>
              )}
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}

export default PriceOverrideForm;
