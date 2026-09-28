import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import type { BankCodeLabelKey } from "@carbon/utils";
import { getBankFieldConfig, maskAccountNumber } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import {
  LuEllipsisVertical,
  LuEye,
  LuEyeOff,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { Outlet, useNavigate, useParams } from "react-router";
import { New } from "~/components";
import { useCountries } from "~/components/Form/Country";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type { CustomerBankAccount } from "~/modules/sales/types";
import { path } from "~/utils/path";

type CustomerBankAccountsProps = {
  bankAccounts: CustomerBankAccount[];
};

const CustomerBankAccounts = ({ bankAccounts }: CustomerBankAccountsProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const permissions = usePermissions();
  const canEdit = permissions.can("create", "accounting");
  const isEmpty = !bankAccounts || bankAccounts.length === 0;

  const countries = useCountries();

  const deleteModal = useDisclosure();
  const [selected, setSelected] = useState<CustomerBankAccount>();

  // Presentation only. The loader returns the full account number, so this
  // deters shoulder-surfing and screenshots — it is not an access control.
  // Access is enforced by the accounting_view RLS policy on the table.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const toggleReveal = useCallback((id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // The routing identifier goes by a different name in each country, so the
  // row labels it the way the country writes it rather than showing a generic
  // "Bank Code" that tells the reader nothing.
  const BANK_CODE_LABELS: Record<BankCodeLabelKey, string> = {
    aba: t`ABA`,
    sortCode: t`Sort Code`,
    bsb: t`BSB`,
    ifsc: t`IFSC`,
    transit: t`Transit`,
    bankCode: t`Bank Code`
  };

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Bank Accounts</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction>{canEdit && <New to="new" />}</CardAction>
        </HStack>
        <CardContent>
          {isEmpty ? (
            <div className="my-8 text-center w-full">
              <p className="text-muted-foreground text-sm">
                <Trans>No bank accounts have been added yet.</Trans>
              </p>
            </div>
          ) : (
            <ul className="w-full divide-y divide-border">
              {bankAccounts.map((account) => {
                const identifier = account.accountNumber ?? "";
                const isRevealed = revealed.has(account.id);
                const config = getBankFieldConfig(account.countryCode);
                const bankCodeLabel = config.bankCodeLabel
                  ? BANK_CODE_LABELS[config.bankCodeLabel]
                  : null;
                const countryName =
                  countries.find((c) => c.value === account.countryCode)
                    ?.label ?? account.countryCode;

                return (
                  <li
                    key={account.id}
                    className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="truncate text-sm font-medium">
                          {account.name}
                        </p>
                        {account.currencyCode && (
                          <span className="shrink-0 font-mono text-sm text-muted-foreground">
                            {account.currencyCode}
                          </span>
                        )}
                      </div>

                      {(account.bankName || countryName) && (
                        <p className="truncate text-sm text-muted-foreground">
                          {[account.bankName, countryName]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}

                      <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <div className="flex items-center gap-1.5">
                          <dt className="text-sm font-medium">
                            {config.accountLabel === "iban" ? (
                              <Trans>IBAN</Trans>
                            ) : (
                              <Trans>Account</Trans>
                            )}
                          </dt>
                          <dd className="flex items-center gap-1 font-mono text-sm tabular-nums text-muted-foreground">
                            {isRevealed
                              ? identifier
                              : maskAccountNumber(identifier)}
                            {identifier && (
                              <IconButton
                                aria-label={
                                  isRevealed
                                    ? t`Hide account number`
                                    : t`Reveal account number`
                                }
                                icon={isRevealed ? <LuEyeOff /> : <LuEye />}
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleReveal(account.id)}
                              />
                            )}
                          </dd>
                        </div>

                        {bankCodeLabel && account.bankCode && (
                          <div className="flex items-center gap-1.5">
                            <dt className="text-sm font-medium">
                              {bankCodeLabel}
                            </dt>
                            <dd className="font-mono text-sm tabular-nums text-muted-foreground">
                              {account.bankCode}
                            </dd>
                          </div>
                        )}

                        {account.swiftBic && (
                          <div className="flex items-center gap-1.5">
                            <dt className="text-sm font-medium">
                              <Trans>SWIFT</Trans>
                            </dt>
                            <dd className="font-mono text-sm text-muted-foreground">
                              {account.swiftBic}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          aria-label={t`More`}
                          icon={<LuEllipsisVertical />}
                          variant="secondary"
                          className="shrink-0"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          disabled={!permissions.can("update", "accounting")}
                          onClick={() => navigate(account.id)}
                        >
                          <LuPencil className="mr-2" />
                          <Trans>Edit</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          destructive
                          disabled={!permissions.can("delete", "accounting")}
                          onClick={() => {
                            setSelected(account);
                            deleteModal.onOpen();
                          }}
                        >
                          <LuTrash className="mr-2" />
                          <Trans>Delete</Trans>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {selected?.id && (
        <ConfirmDelete
          action={path.to.deleteCustomerBankAccount(customerId, selected.id)}
          name={selected.name}
          text={t`Are you sure you want to delete this bank account?`}
          isOpen={deleteModal.isOpen}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}

      <Outlet />
    </>
  );
};

export default CustomerBankAccounts;
