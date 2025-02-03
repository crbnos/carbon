import { error, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useDebounce,
  VStack,
} from "@carbon/react";
import { Editor, generateHTML } from "@carbon/react/Editor";
import { useRouteData } from "@carbon/remix";
import { formatDate, formatRelativeTime } from "@carbon/utils";
import { useNumberFormatter } from "@react-aria/i18n";
import { Await, Link, useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { nanoid } from "nanoid";
import { Suspense, useState } from "react";
import {
  LuEllipsisVertical,
  LuFactory,
  LuHammer,
  LuHandCoins,
  LuTruck,
} from "react-icons/lu";
import {
  Documents,
  EmployeeAvatar,
  Empty,
  Hyperlink,
  SupplierAvatar,
} from "~/components";
import { ConfiguratorDataTypeIcon } from "~/components/Configurator/Icons";
import { usePermissions, useUser } from "~/hooks";
import type { BatchDetails, BatchProperty } from "~/modules/inventory";
import {
  getBatch,
  getBatchFiles,
  getBatchProperties,
} from "~/modules/inventory/inventory.service";
import BatchHeader from "~/modules/inventory/ui/Batches/BatchHeader";
import type { Handle } from "~/utils/handle";
import { getPrivateUrl, path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Batches",
  to: path.to.batches,
  module: "inventory",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    bypassRls: true,
  });

  const { batchId } = params;
  if (!batchId) throw new Error("Batch ID is required");

  const batch = await getBatch(client, batchId, companyId);
  if (batch.error) {
    throw redirect(
      path.to.batches,
      await flash(request, error(batch.error, "Failed to load batch"))
    );
  }

  const batchProperties = await getBatchProperties(
    client,
    [batch.data.itemId],
    companyId
  );

  const receiptLineIds = batch.data.receiptLineTracking.map(
    (receiptLine) => receiptLine.receiptLineId
  );

  return defer({
    batch: batch.data,
    batchProperties: batchProperties?.data ?? [],
    receiptFiles: getBatchFiles(client, companyId, {
      receiptLineIds,
      batchId,
    }) ?? { data: [], error: null },
  });
}

export default function BatchDetailRoute() {
  const { receiptFiles } = useLoaderData<typeof loader>();
  const { batchId } = useParams();
  if (!batchId) throw new Error("Could not find batchId");

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <BatchHeader />
      <div className="flex h-[calc(100dvh-99px)] overflow-y-auto scrollbar-hide w-full">
        <VStack
          spacing={4}
          className="h-full p-2 w-full max-w-5xl mx-auto pb-32"
        >
          <BatchSummary />
          <BatchTransactions />
          <BatchNotes />
          <Suspense fallback={null}>
            <Await resolve={receiptFiles}>
              {(files) => (
                <Documents
                  writeBucket="inventory"
                  writeBucketPermission="inventory"
                  files={files.data ?? []}
                  sourceDocumentId={batchId}
                />
              )}
            </Await>
          </Suspense>
        </VStack>
      </div>
    </div>
  );
}

function BatchSummary() {
  const { batchId } = useParams();
  if (!batchId) throw new Error("Could not find batchId");

  const routeData = useRouteData<{
    batch: BatchDetails;
    batchProperties: BatchProperty[];
  }>(path.to.batch(batchId));

  const numberFormatter = useNumberFormatter();
  if (!routeData?.batch) throw new Error("Could not find batch");

  const { batch, batchProperties } = routeData;

  const properties = batch.properties
    ? Object.entries(batch.properties)
        .reduce<(BatchProperty & { value: string | number | boolean })[]>(
          (acc, [key, value]) => {
            const property = batchProperties.find((p) => p.id === key);
            if (property) {
              acc.push({ ...property, value });
            }
            return acc;
          },
          []
        )
        .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center">
          <div className="flex flex-col gap-1">
            <CardTitle>{batch.item.readableId}</CardTitle>
            <CardDescription className="flex flex-col gap-2">
              <span>{batch.item.name}</span>
              <div>
                {batch.source === "Purchased" ? (
                  <Badge variant="green">Purchased</Badge>
                ) : (
                  <Badge variant="blue">Manufactured</Badge>
                )}
              </div>
            </CardDescription>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <SupplierAvatar supplierId={batch.supplierId ?? null} />
            {batch.manufacturingDate && (
              <span className="text-muted-foreground text-sm">
                Manufactured {formatDate(batch.manufacturingDate)}
              </span>
            )}
            {batch.expirationDate && (
              <span className="text-muted-foreground text-sm">
                Expires {formatDate(batch.expirationDate)}
              </span>
            )}
          </div>
        </HStack>
      </CardHeader>
      <CardContent>
        <VStack>
          {properties.map((property) => (
            <div
              key={property.id}
              className="flex items-center justify-between p-6 rounded-lg border w-full"
            >
              <HStack spacing={4} className="flex-1">
                <div className="bg-muted border rounded-full flex items-center justify-center p-2">
                  <ConfiguratorDataTypeIcon
                    type={property.dataType}
                    className="w-4 h-4"
                  />
                </div>

                <span className="text-sm font-medium">{property.label}</span>
              </HStack>
              <span className="text-base font-medium">
                {property.dataType === "boolean" ? (
                  <Checkbox isChecked={property.value as boolean} />
                ) : property.dataType === "numeric" ? (
                  numberFormatter.format(property.value as number)
                ) : (
                  property.value
                )}
              </span>
            </div>
          ))}
        </VStack>
      </CardContent>
    </Card>
  );
}

function BatchTransactions() {
  const { batchId } = useParams();
  if (!batchId) throw new Error("Could not find batchId");

  const routeData = useRouteData<{
    batch: BatchDetails;
  }>(path.to.batch(batchId));

  if (!routeData?.batch) return null;

  const { batch } = routeData;

  // Combine all tracking types and sort by time
  const allTransactions = [
    ...batch.receiptLineTracking.map((tracking) => ({
      ...tracking,
      type: "received" as const,
    })),
    ...(batch.jobMaterialTracking || []).map((tracking) => ({
      ...tracking,
      type: "consumed" as const,
    })),
    ...(batch.jobProductionTracking || []).map((tracking) => ({
      ...tracking,
      type: "produced" as const,
    })),
  ].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <Card>
      <Tabs defaultValue="all">
        <HStack className="justify-between w-full">
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
          </CardHeader>
          <CardAction>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="received">Received</TabsTrigger>
              <TabsTrigger value="consumed">Consumed</TabsTrigger>
              <TabsTrigger value="produced">Produced</TabsTrigger>
              <TabsTrigger value="shipped">Shipped</TabsTrigger>
            </TabsList>
          </CardAction>
        </HStack>
        <CardContent>
          <TabsContent className="w-full" value="all">
            <VStack className="w-full" spacing={4}>
              {allTransactions.length === 0 ? (
                <Empty className="text-sm text-muted-foreground">
                  No transactions found
                </Empty>
              ) : (
                allTransactions.map((transaction) => {
                  if (transaction.type === "received") {
                    return (
                      <ReceivedTransaction
                        key={transaction.id}
                        transaction={transaction}
                      />
                    );
                  }
                  if (transaction.type === "consumed") {
                    return (
                      <ConsumedTransaction
                        key={transaction.id}
                        transaction={transaction}
                      />
                    );
                  }
                  if (transaction.type === "produced") {
                    return (
                      <ProducedTransaction
                        key={transaction.id}
                        transaction={transaction}
                      />
                    );
                  }
                  return null;
                })
              )}
            </VStack>
          </TabsContent>
          <TabsContent className="w-full" value="received">
            <VStack className="w-full" spacing={4}>
              {batch.receiptLineTracking.length === 0 ? (
                <Empty className="text-sm text-muted-foreground">
                  No received transactions found
                </Empty>
              ) : (
                batch.receiptLineTracking.map((receiptLine) => (
                  <ReceivedTransaction
                    key={receiptLine.id}
                    transaction={{
                      ...receiptLine,
                      type: "received",
                      createdAt: receiptLine.createdAt,
                    }}
                  />
                ))
              )}
            </VStack>
          </TabsContent>
          <TabsContent className="w-full" value="consumed">
            <VStack className="w-full" spacing={4}>
              {!batch.jobMaterialTracking?.length ? (
                <Empty className="text-sm text-muted-foreground">
                  No consumed transactions found
                </Empty>
              ) : (
                batch.jobMaterialTracking.map((tracking) => (
                  <ConsumedTransaction
                    key={tracking.id}
                    transaction={{
                      ...tracking,
                      type: "consumed",
                      createdAt: tracking.createdAt,
                    }}
                  />
                ))
              )}
            </VStack>
          </TabsContent>
          <TabsContent className="w-full" value="produced">
            <VStack className="w-full" spacing={4}>
              {!batch.jobProductionTracking?.length ? (
                <Empty className="text-sm text-muted-foreground">
                  No produced transactions found
                </Empty>
              ) : (
                batch.jobProductionTracking.map((tracking) => (
                  <ProducedTransaction
                    key={tracking.id}
                    transaction={{
                      ...tracking,
                      type: "produced",
                      createdAt: tracking.createdAt,
                    }}
                  />
                ))
              )}
            </VStack>
          </TabsContent>
          <TabsContent className="w-full" value="shipped">
            <VStack>
              <Empty className="text-sm text-muted-foreground">
                No shipped transactions found
              </Empty>
            </VStack>
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}

function ReceivedTransaction({
  transaction,
}: {
  transaction: BatchDetails["receiptLineTracking"][number] & {
    type: "received";
  };
}) {
  return (
    <div className="flex flex-col border p-6 w-full rounded-lg">
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="w-1/2">
          <HStack spacing={4} className="flex-1">
            <TransactionIcon type="received" />
            <VStack spacing={0}>
              <Hyperlink
                to={path.to.receipt(transaction.receipt.id)}
                className="text-sm font-medium"
              >
                {transaction.receipt.receiptId}
              </Hyperlink>
              <span className="text-xs text-muted-foreground">
                {`Received from ${transaction.receipt.sourceDocumentReadableId}`}
              </span>
            </VStack>
            <span className="text-base text-muted-foreground text-right">
              {transaction.quantity}
            </span>
          </HStack>
        </HStack>
        <div className="flex items-center justify-end gap-2">
          <HStack spacing={2}>
            <span className="text-xs text-muted-foreground">
              Created {formatRelativeTime(transaction.createdAt)}
            </span>
            <EmployeeAvatar
              employeeId={transaction.createdBy}
              withName={false}
            />
          </HStack>
          <MoreMenu link={path.to.receipt(transaction.receipt.id)} />
        </div>
      </div>
    </div>
  );
}

function ConsumedTransaction({
  transaction,
}: {
  transaction: BatchDetails["jobMaterialTracking"][number] & {
    type: "consumed";
  };
}) {
  return (
    <div className="flex flex-col border p-6 w-full rounded-lg">
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="w-1/2">
          <HStack spacing={4} className="flex-1">
            <TransactionIcon type="consumed" />
            <VStack spacing={0}>
              <Hyperlink
                to={path.to.jobMaterials(transaction.jobMaterial.job?.id)}
                className="text-sm font-medium"
              >
                {transaction.jobMaterial.job?.jobId}
              </Hyperlink>
              <span className="text-xs text-muted-foreground">
                Consumed by Job
              </span>
            </VStack>
            <span className="text-base text-muted-foreground text-right">
              {transaction.quantity}
            </span>
          </HStack>
        </HStack>
        <div className="flex items-center justify-end gap-2">
          <HStack spacing={2}>
            <span className="text-xs text-muted-foreground">
              Created {formatRelativeTime(transaction.createdAt)}
            </span>
            <EmployeeAvatar
              employeeId={transaction.createdBy}
              withName={false}
            />
          </HStack>
          <MoreMenu
            link={path.to.jobMaterials(transaction.jobMaterial.job?.id)}
          />
        </div>
      </div>
    </div>
  );
}

function ProducedTransaction({
  transaction,
}: {
  transaction: BatchDetails["jobProductionTracking"][number] & {
    type: "produced";
  };
}) {
  return (
    <div className="flex flex-col border p-6 w-full rounded-lg">
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="w-1/2">
          <HStack spacing={4} className="flex-1">
            <TransactionIcon type="produced" />
            <VStack spacing={0}>
              <span className="text-xs text-muted-foreground">
                Job Production
              </span>
            </VStack>
            <span className="text-base text-muted-foreground text-right">
              {transaction.quantity}
            </span>
          </HStack>
        </HStack>
        <div className="flex items-center justify-end gap-2">
          <HStack spacing={2}>
            <span className="text-xs text-muted-foreground">
              Created {formatRelativeTime(transaction.createdAt)}
            </span>
            <EmployeeAvatar
              employeeId={transaction.createdBy}
              withName={false}
            />
          </HStack>
        </div>
      </div>
    </div>
  );
}

type TrasactionType = "received" | "consumed" | "produced" | "shipped";

function TransactionIcon({ type }: { type: TrasactionType }) {
  if (type === "received")
    return (
      <div className="bg-blue-500 text-white border rounded-full flex items-center justify-center p-2">
        <LuHandCoins className="size-4" />
      </div>
    );
  if (type === "consumed")
    return (
      <div className="bg-orange-500 text-white border rounded-full flex items-center justify-center p-2">
        <LuFactory className="size-4" />
      </div>
    );
  if (type === "produced")
    return (
      <div className="bg-emerald-500 text-zinc-900 border rounded-full flex items-center justify-center p-2">
        <LuHammer className="size-4" />
      </div>
    );
  if (type === "shipped")
    return (
      <div className="bg-yellow-500 text-zinc-900 border rounded-full flex items-center justify-center p-2">
        <LuTruck className="size-4" />
      </div>
    );
}

function BatchNotes() {
  const {
    company: { id: companyId },
  } = useUser();

  const { batchId } = useParams();
  if (!batchId) throw new Error("Could not find batchId");

  const routeData = useRouteData<{
    batch: BatchDetails;
  }>(path.to.batch(batchId));

  if (!routeData?.batch) throw new Error("Could not find batch");

  const { batch } = routeData;

  const { carbon } = useCarbon();
  const permissions = usePermissions();
  const [tab, setTab] = useState("internal");
  const [notes, setNotes] = useState(batch.notes ?? {});

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/inventory/${batchId}/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  const onUpdateNotes = useDebounce(
    async (content: JSONContent) => {
      await carbon
        ?.from("batchNumber")
        .update({
          notes: content,
        })
        .eq("id", batchId!);
    },
    2500,
    true
  );

  return (
    <>
      <Card>
        <Tabs value={tab} onValueChange={setTab}>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>

          <CardContent>
            {permissions.can("update", "inventory") ? (
              <Editor
                initialValue={(notes ?? {}) as JSONContent}
                onUpload={onUploadImage}
                onChange={(value) => {
                  setNotes(value);
                  onUpdateNotes(value);
                }}
              />
            ) : (
              <div
                className="prose dark:prose-invert"
                dangerouslySetInnerHTML={{
                  __html: generateHTML(notes as JSONContent),
                }}
              />
            )}
          </CardContent>
        </Tabs>
      </Card>
    </>
  );
}

function MoreMenu({ link }: { link: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label="Open menu"
          icon={<LuEllipsisVertical />}
          variant="ghost"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to={link}>View</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
