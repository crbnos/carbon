import { Button, Card, HStack } from "@carbon/react";
import { LuArrowUpRight } from "react-icons/lu";
import { RiProgress2Line, RiProgress4Line } from "react-icons/ri";

const chartData = [
  { month: "January", desktop: 186, mobile: 80 },
  { month: "February", desktop: 305, mobile: 200 },
  { month: "March", desktop: 237, mobile: 120 },
  { month: "April", desktop: 73, mobile: 190 },
  { month: "May", desktop: 209, mobile: 130 },
  { month: "June", desktop: 214, mobile: 140 },
];

export default function SalesDashboard() {
  return (
    <div className="flex flex-col gap-4 w-full p-4">
      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-3">
        <Card className="p-4 rounded-xl items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground shadow-md">
              <RiProgress2Line className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
            >
              View RFQs
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">42</h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open RFQs
            </p>
          </div>
        </Card>

        <Card className="p-4 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground shadow-md">
              <RiProgress4Line className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
            >
              View Quotes
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">12</h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Quotes
            </p>
          </div>
        </Card>

        <Card className="p-4 items-start justify-start gap-y-4">
          <HStack className="justify-between w-full items-start mb-4">
            <div className="bg-muted/80 border border-border rounded-xl p-2 text-foreground shadow-md">
              <RiProgress4Line className="size-5" />
            </div>
            <Button
              size="sm"
              rightIcon={<LuArrowUpRight />}
              variant="secondary"
            >
              View Orders
            </Button>
          </HStack>
          <div className="flex flex-col gap-2">
            <h3 className="text-3xl font-medium tracking-tight">3</h3>
            <p className="text-sm text-muted-foreground tracking-tight">
              Open Sales Orders
            </p>
          </div>
        </Card>
      </div>

      <div className="grid w-full gap-4 grid-cols-1 lg:grid-cols-2"></div>
    </div>
  );
}
