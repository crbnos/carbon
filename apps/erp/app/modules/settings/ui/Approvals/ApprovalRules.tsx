import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  VStack
} from "@carbon/react";
import { memo } from "react";
import { LuPlus } from "react-icons/lu";
import { Link } from "react-router";
import { Empty } from "~/components";
import { usePermissions } from "~/hooks";
import {
  type ApprovalRule,
  approvalDocumentTypesWithAmounts
} from "~/modules/shared";
import { path } from "~/utils/path";
import ApprovalRuleCard from "./ApprovalRuleCard";

type ApprovalRulesProps = {
  poRules: ApprovalRule[];
  qdRules: ApprovalRule[];
};

const ApprovalRules = memo(({ poRules, qdRules }: ApprovalRulesProps) => {
  const permissions = usePermissions();
  const canCreate = permissions.can("update", "settings");

  return (
    <ScrollArea className="h-full w-full">
      <div className="py-12 px-4 max-w-[60rem] mx-auto">
        <div className="mb-8">
          <Heading size="h2">Approval Rules</Heading>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Purchase Orders</CardTitle>
                <CardDescription className="text-sm">
                  Require approval for purchase orders based on amount
                  thresholds
                </CardDescription>
              </div>
              {canCreate && (
                <Button variant="primary" leftIcon={<LuPlus />} asChild>
                  <Link to={path.to.newApprovalRule("purchaseOrder")}>
                    New Rule
                  </Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {poRules.length === 0 ? (
              <Empty className="my-4" />
            ) : (
              <VStack spacing={3} className="items-stretch">
                {poRules
                  .filter((r) => r.id)
                  .map((rule) => (
                    <ApprovalRuleCard
                      key={rule.id}
                      rule={rule}
                      documentType="purchaseOrder"
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
                <CardTitle className="text-lg">Quality Documents</CardTitle>
                <CardDescription className="text-sm">
                  Require approval for quality documents in your workflow
                </CardDescription>
              </div>
              {canCreate &&
                (approvalDocumentTypesWithAmounts.includes("qualityDocument") ||
                  qdRules.length === 0) && (
                  <Button variant="primary" leftIcon={<LuPlus />} asChild>
                    <Link to={path.to.newApprovalRule("qualityDocument")}>
                      New Rule
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
      </div>
    </ScrollArea>
  );
});

ApprovalRules.displayName = "ApprovalRules";
export default ApprovalRules;
