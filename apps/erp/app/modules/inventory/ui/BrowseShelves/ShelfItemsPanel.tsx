import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  ScrollArea,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import {
  LuBox,
  LuExternalLink,
  LuMapPin,
  LuPackage,
  LuX
} from "react-icons/lu";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

export type ShelfItem = {
  itemId: string;
  name: string;
  readableIdWithRevision: string;
  unitOfMeasureCode: string;
  itemTrackingType: string;
  quantity: number;
};

type ShelfItemsPanelProps = {
  shelfName: string;
  locationName?: string;
  items: ShelfItem[];
  itemCount: number;
  totalQuantity: number;
};

const ShelfItemsPanel = ({
  shelfName,
  locationName,
  items,
  itemCount,
  totalQuantity
}: ShelfItemsPanelProps) => {
  const { locale } = useLocale();
  const [searchParams] = useSearchParams();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const locationId = searchParams.get("location");

  const formatter = Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true
  });

  const getItemPath = (itemId: string) => {
    const itemParams = new URLSearchParams();
    if (locationId) {
      itemParams.set("location", locationId);
    }
    return `${path.to.inventoryItem(itemId)}?${itemParams.toString()}`;
  };

  const handleClose = () => {
    navigate(`${path.to.browseShelves}?${params.toString()}`);
  };

  return (
    <>
      <div className="flex justify-between items-center border-b border-border p-2 bg-card w-full">
        <Button isIcon variant="ghost" onClick={handleClose}>
          <LuX className="w-4 h-4" />
        </Button>
        <span className="flex items-center font-semibold text-center gap-2">
          <LuPackage className="h-4 w-4" />
          {shelfName}
        </span>
        <div className="w-8" />
      </div>
      <ScrollArea className="h-[calc(100dvh-97px)]">
        <div className="p-4">
          <VStack spacing={4}>
            {locationName && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <LuMapPin className="h-4 w-4" />
                <span>{locationName}</span>
              </div>
            )}

            <div className="w-full grid gap-2 grid-cols-2">
              <Card>
                <CardHeader className="pb-4">
                  <CardDescription>
                    <VStack>Unique Items</VStack>
                  </CardDescription>
                  <CardTitle className="text-3xl">
                    {formatter.format(itemCount)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-4">
                  <CardDescription>
                    <VStack>Total Quantity</VStack>
                  </CardDescription>
                  <CardTitle className="text-3xl">
                    {formatter.format(totalQuantity)}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card className="w-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LuBox className="h-4 w-4" />
                  Items on this Shelf
                </CardTitle>
                <CardDescription>
                  {items.length} item{items.length !== 1 ? "s" : ""} with stock
                </CardDescription>
              </CardHeader>
              <CardContent>
                {items.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4 text-center">
                    No items found on this shelf
                  </p>
                ) : (
                  <Table className="table-fixed">
                    <Thead>
                      <Tr>
                        <Th className="w-1/3">Item</Th>
                        <Th className="w-1/4">Name</Th>
                        <Th className="w-1/6">Quantity</Th>
                        <Th className="w-1/6">UoM</Th>
                        <Th className="w-12" />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {items.map((item) => (
                        <Tr key={item.itemId}>
                          <Td>
                            <Link
                              to={getItemPath(item.itemId)}
                              className="text-primary hover:underline font-medium"
                            >
                              {item.readableIdWithRevision}
                            </Link>
                          </Td>
                          <Td>
                            <span
                              className="truncate block max-w-[200px]"
                              title={item.name}
                            >
                              {item.name}
                            </span>
                          </Td>
                          <Td>
                            <span className="tabular-nums font-medium">
                              {formatter.format(item.quantity)}
                            </span>
                          </Td>
                          <Td>
                            <Enumerable value={item.unitOfMeasureCode} />
                          </Td>
                          <Td>
                            <HStack className="justify-end">
                              <Link
                                to={getItemPath(item.itemId)}
                                className="text-muted-foreground hover:text-foreground"
                                title="View item inventory"
                              >
                                <LuExternalLink className="h-4 w-4" />
                              </Link>
                            </HStack>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </VStack>
        </div>
      </ScrollArea>
    </>
  );
};

export default ShelfItemsPanel;
