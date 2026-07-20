import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import { LuPlus } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { Empty } from "~/components";
import { usePermissions } from "~/hooks";
import {
  type ApprovalDocumentType,
  type ApprovalRule,
  approvalDocumentTypesWithAmounts
} from "~/modules/shared";
import { path } from "~/utils/path";
import ApprovalRuleCard from "./ApprovalRuleCard";

type ApprovalRulesProps = {
  poRules: ApprovalRule[];
  qdRules: ApprovalRule[];
  supplierRules: ApprovalRule[];
  jeRules: ApprovalRule[];
  paymentRules: ApprovalRule[];
  purchaseInvoiceRules: ApprovalRule[];
  memoRules: ApprovalRule[];
  enforceNoSelfApproval: boolean;
};

// A rule's ceiling is the next-higher tier's minimum (null for the top tier).
const makeNextTierFloor = (rules: ApprovalRule[]) => {
  const floors = Array.from(
    new Set(rules.map((r) => r.lowerBoundAmount ?? 0))
  ).sort((a, b) => a - b);
  return (lowerBoundAmount: number): number | null =>
    floors.find((f) => f > lowerBoundAmount) ?? null;
};

// Amount-tiered card (Purchase Order pattern): a company can configure multiple
// rules per document type keyed by a dollar floor, each with a "New Rule" button.
const AmountTieredRuleCard = ({
  documentType,
  title,
  description,
  rules,
  canCreate
}: {
  documentType: ApprovalDocumentType;
  title: ReactNode;
  description: ReactNode;
  rules: ApprovalRule[];
  canCreate: boolean;
}) => {
  const nextTierFloor = useMemo(() => makeNextTierFloor(rules), [rules]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription className="text-sm">{description}</CardDescription>
          </div>
          {canCreate && (
            <Button variant="primary" leftIcon={<LuPlus />} asChild>
              <Link to={path.to.newApprovalRule(documentType)}>
                <Trans>New Rule</Trans>
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
            {rules
              .filter((r) => r.id)
              .map((rule) => (
                <ApprovalRuleCard
                  key={rule.id}
                  rule={rule}
                  documentType={documentType}
                  upperBound={nextTierFloor(rule.lowerBoundAmount ?? 0)}
                />
              ))}
          </VStack>
        )}
      </CardContent>
    </Card>
  );
};

// Company-wide toggle: when on, a document's requester can never approve their
// own request. Disabling permits self-approval and is surfaced as a standing
// exception in the Segregation of Duties report.
const NoSelfApprovalToggle = ({
  enforceNoSelfApproval,
  canUpdate
}: {
  enforceNoSelfApproval: boolean;
  canUpdate: boolean;
}) => {
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  const [enabled, setEnabled] = useState(enforceNoSelfApproval);

  const handleToggle = useCallback(
    (checked: boolean) => {
      setEnabled(checked);
      fetcher.submit(
        { intent: "enforceNoSelfApproval", enabled: checked.toString() },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  useEffect(() => {
    if (fetcher.data?.success === true && fetcher.data?.message) {
      toast.success(fetcher.data.message);
    }
    if (fetcher.data?.success === false && fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.message, fetcher.data?.success]);

  return (
    <Card className="w-full">
      <CardHeader>
        <HStack className="justify-between items-center">
          <div>
            <CardTitle>
              <Trans>Prevent Self-Approval</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Block the person who submitted a document from approving it.
                Disabling this permits self-approval and is flagged as a
                standing exception in the Segregation of Duties report.
              </Trans>
            </CardDescription>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={!canUpdate || fetcher.state !== "idle"}
          />
        </HStack>
      </CardHeader>
    </Card>
  );
};

const ApprovalRules = memo(
  ({
    poRules,
    qdRules,
    supplierRules,
    jeRules,
    paymentRules,
    purchaseInvoiceRules,
    memoRules,
    enforceNoSelfApproval
  }: ApprovalRulesProps) => {
    const permissions = usePermissions();
    const canCreate = permissions.can("update", "settings");

    return (
      <ScrollArea className="h-full w-full">
        <div className="py-12 px-4 max-w-[60rem] mx-auto">
          <div className="mb-8">
            <Heading size="h2">
              <Trans>Approval Rules</Trans>
            </Heading>
          </div>

          <VStack spacing={4}>
            <NoSelfApprovalToggle
              enforceNoSelfApproval={enforceNoSelfApproval}
              canUpdate={canCreate}
            />

            <AmountTieredRuleCard
              documentType="purchaseOrder"
              title={<Trans>Purchase Orders</Trans>}
              description={
                <Trans>
                  Require approval for purchase orders based on amount
                  thresholds
                </Trans>
              }
              rules={poRules}
              canCreate={canCreate}
            />

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      <Trans>Quality Documents</Trans>
                    </CardTitle>
                    <CardDescription className="text-sm">
                      <Trans>
                        Require approval for quality documents in your workflow
                      </Trans>
                    </CardDescription>
                  </div>
                  {canCreate &&
                    (approvalDocumentTypesWithAmounts.includes(
                      "qualityDocument"
                    ) ||
                      qdRules.length === 0) && (
                      <Button variant="primary" leftIcon={<LuPlus />} asChild>
                        <Link to={path.to.newApprovalRule("qualityDocument")}>
                          <Trans>New Rule</Trans>
                        </Link>
                      </Button>
                    )}
                </div>
              </CardHeader>
              <CardContent>
                {qdRules.length === 0 ? (
                  <Empty className="my-4" />
                ) : (
                  <VStack spacing={3} className="items-stretch">
                    {qdRules
                      .filter((r) => r.id)
                      .map((rule) => (
                        <ApprovalRuleCard
                          key={rule.id}
                          rule={rule}
                          documentType="qualityDocument"
                        />
                      ))}
                  </VStack>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      <Trans>Suppliers</Trans>
                    </CardTitle>
                    <CardDescription className="text-sm">
                      <Trans>
                        Require approval before suppliers can be set to Active
                      </Trans>
                    </CardDescription>
                  </div>
                  {canCreate && supplierRules.length === 0 && (
                    <Button variant="primary" leftIcon={<LuPlus />} asChild>
                      <Link to={path.to.newApprovalRule("supplier")}>
                        <Trans>New Rule</Trans>
                      </Link>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {supplierRules.length === 0 ? (
                  <Empty className="my-4" />
                ) : (
                  <VStack spacing={3} className="items-stretch">
                    {supplierRules
                      .filter((r) => r.id)
                      .map((rule) => (
                        <ApprovalRuleCard
                          key={rule.id}
                          rule={rule}
                          documentType="supplier"
                        />
                      ))}
                  </VStack>
                )}
              </CardContent>
            </Card>

            <AmountTieredRuleCard
              documentType="journalEntry"
              title={<Trans>Journal Entries</Trans>}
              description={
                <Trans>
                  Require approval for manual journal entries based on amount
                  thresholds
                </Trans>
              }
              rules={jeRules}
              canCreate={canCreate}
            />

            <AmountTieredRuleCard
              documentType="payment"
              title={<Trans>Payments</Trans>}
              description={
                <Trans>
                  Require approval for payments based on amount thresholds
                </Trans>
              }
              rules={paymentRules}
              canCreate={canCreate}
            />

            <AmountTieredRuleCard
              documentType="purchaseInvoice"
              title={<Trans>Purchase Invoices</Trans>}
              description={
                <Trans>
                  Require approval for purchase invoices based on amount
                  thresholds
                </Trans>
              }
              rules={purchaseInvoiceRules}
              canCreate={canCreate}
            />

            <AmountTieredRuleCard
              documentType="memo"
              title={<Trans>Credit/Debit Memos</Trans>}
              description={
                <Trans>
                  Require approval for credit and debit memos based on amount
                  thresholds
                </Trans>
              }
              rules={memoRules}
              canCreate={canCreate}
            />
          </VStack>
        </div>
      </ScrollArea>
    );
  }
);

ApprovalRules.displayName = "ApprovalRules";
export default ApprovalRules;
