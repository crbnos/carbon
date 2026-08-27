import { VStack } from "@carbon/react";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import RepairChargesTable from "~/modules/sales/ui/Repairs/RepairChargesTable";
import RepairOrderHeader from "~/modules/sales/ui/Repairs/RepairOrderHeader";
import RepairOrderLinesTable from "~/modules/sales/ui/Repairs/RepairOrderLinesTable";
import type {
  RepairOrderCharge,
  RepairOrderLine
} from "~/modules/sales/ui/Repairs/types";
import { path } from "~/utils/path";

export default function RepairOrderDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    repairOrder: any;
    lines: RepairOrderLine[];
    charges: RepairOrderCharge[];
    warrantyTerms: { id: string; name: string }[];
  }>(path.to.repairOrder(id));

  if (!routeData?.repairOrder) {
    throw new Error("Failed to load repair order");
  }

  return (
    <VStack spacing={0} className="h-full overflow-y-auto">
      <RepairOrderHeader
        repairOrder={routeData.repairOrder}
        lines={routeData.lines}
      />
      <div className="w-full p-2 flex flex-col gap-4">
        <RepairOrderLinesTable
          repairOrderId={id}
          status={routeData.repairOrder.status}
          lines={routeData.lines}
          warrantyTerms={routeData.warrantyTerms}
        />
        <RepairChargesTable
          repairOrderId={id}
          status={routeData.repairOrder.status}
          charges={routeData.charges}
          lines={routeData.lines}
        />
      </div>
    </VStack>
  );
}
