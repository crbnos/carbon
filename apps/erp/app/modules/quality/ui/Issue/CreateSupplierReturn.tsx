import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Combobox,
  HStack,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuUndo2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";

/**
 * The Issue → supplier-return bridge: drafts a purchaseReturnOrder covering
 * the uncovered 'Return to Supplier' quantities. The server resolves the
 * supplier from the issue's associations; the picker here is the explicit
 * override for ambiguous (multi-supplier) issues. Idempotent server-side.
 */
export function CreateSupplierReturn({
  issueId,
  hasReturnToSupplier,
  isDisabled
}: {
  issueId: string;
  hasReturnToSupplier: boolean;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const [suppliers] = useSuppliers();
  const [supplierId, setSupplierId] = useState("");

  if (!hasReturnToSupplier || !permissions.can("create", "purchasing")) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t`Supplier Return`}</CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          <p className="text-sm text-muted-foreground">
            {t`Draft a supplier return for the quantities dispositioned Return to Supplier. Quantities already covered by a linked return are excluded, and this issue cannot close while a linked return is open.`}
          </p>
          <HStack className="w-full" spacing={4}>
            <div className="min-w-[240px]">
              <Combobox
                size="sm"
                value={supplierId}
                options={suppliers.map((s) => ({
                  value: s.id,
                  label: s.name
                }))}
                placeholder={t`Supplier (optional — auto-resolved)`}
                onChange={(value) => setSupplierId(value ?? "")}
              />
            </div>
            <Button
              leftIcon={<LuUndo2 />}
              isDisabled={isDisabled}
              isLoading={fetcher.state !== "idle"}
              onClick={() => {
                const formData = new FormData();
                if (supplierId) formData.append("supplierId", supplierId);
                fetcher.submit(formData, {
                  method: "post",
                  action: path.to.issueSupplierReturn(issueId)
                });
              }}
            >
              {t`Create Supplier Return`}
            </Button>
          </HStack>
        </VStack>
      </CardContent>
    </Card>
  );
}
