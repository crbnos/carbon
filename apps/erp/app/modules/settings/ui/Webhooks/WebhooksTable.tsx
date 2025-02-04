import {
  Badge,
  Button,
  CodeBlock,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Kbd,
  MenuIcon,
  MenuItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useNumberFormatter } from "@react-aria/i18n";
import { Link, Outlet, useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuCalendar,
  LuCode,
  LuDatabase,
  LuFileText,
  LuPencil,
  LuPercent,
  LuTable2,
  LuTag,
  LuTrash,
  LuUser,
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams, useUser } from "~/hooks";
import type { Webhook } from "~/modules/settings";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import { useWebhookTables } from "./WebhookForm";

type WebhooksTableProps = {
  data: Webhook[];
  count: number;
};

const WebhooksTable = memo(({ data, count }: WebhooksTableProps) => {
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const permissions = usePermissions();
  const [people] = usePeople();
  const webhookTables = useWebhookTables();

  const columns = useMemo<ColumnDef<Webhook>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex flex-col gap-1 justify-start items-start pb-1">
            <Hyperlink to={row.original.id!}>{row.original.name}</Hyperlink>
            <HStack>
              {row.original.active ? (
                <Badge variant="green">Active</Badge>
              ) : (
                <Badge variant="red">Inactive</Badge>
              )}
              <span className="text-xs text-muted-foreground font-mono">
                {row.original.url}
              </span>
            </HStack>
          </div>
        ),
        meta: {
          icon: <LuTag />,
        },
      },
      {
        accessorKey: "table",
        header: "Table",
        cell: ({ row }) => (
          <div className="flex flex-col gap-1 justify-start items-start pb-1">
            <Hyperlink
              className="flex flex-row gap-1 items-center"
              to={path.to.apiTable("js", row.original.table)}
            >
              <LuTable2 className="size-4" />
              <span className="text-sm font-medium">
                {`public.${row.original.table}`}
              </span>
            </Hyperlink>
            <HStack>
              {row.original.onInsert && <Badge variant="green">Insert</Badge>}
              {row.original.onUpdate && <Badge variant="blue">Update</Badge>}
              {row.original.onDelete && <Badge variant="red">Delete</Badge>}
            </HStack>
          </div>
        ),
        meta: {
          icon: <LuDatabase />,
          filter: {
            type: "static",
            options: webhookTables,
          },
        },
      },
      {
        accessorKey: "successCount",
        header: "Success",
        cell: ({ row }) => (
          <SuccessErrorBar
            successCount={row.original.successCount}
            errorCount={row.original.errorCount}
          />
        ),
        meta: {
          icon: <LuPercent />,
        },
      },
      {
        id: "createdBy",
        header: "Created By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          icon: <LuUser />,
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name,
            })),
          },
        },
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />,
        },
      },
    ];
  }, [people, webhookTables]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.webhook(row.id!)}?${params?.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Webhook
          </MenuItem>
          <MenuItem
            destructive
            onClick={() => {
              navigate(
                `${path.to.deleteWebhook(row.id!)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Webhook
          </MenuItem>
        </>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, params, permissions]
  );

  const docsDisclosure = useDisclosure();

  return (
    <>
      <Table<Webhook>
        data={data}
        columns={columns}
        count={count ?? 0}
        defaultColumnVisibility={{
          createdAt: false,
          createdBy: false,
        }}
        primaryAction={
          <HStack>
            {permissions.can("update", "users") && (
              <New
                label="Webhook"
                to={`${path.to.newWebhook}?${params.toString()}`}
              />
            )}
            <Button
              leftIcon={<LuCode />}
              variant="secondary"
              onClick={docsDisclosure.onOpen}
            >
              Webhooks Docs
            </Button>
          </HStack>
        }
        renderContextMenu={renderContextMenu}
        title="Webhooks"
      />
      <Outlet />
      <WebhookDocs
        open={docsDisclosure.isOpen}
        onClose={docsDisclosure.onClose}
      />
    </>
  );
});

WebhooksTable.displayName = "WebhooksTable";
export default WebhooksTable;

type WebhookDocsProps = {
  open: boolean;
  onClose: () => void;
};

const code = {
  insertPayload: (table: string, companyId: string) => `
const url = "<your-webhook-url>";  

const payload = {
  type: "INSERT",
  table: "${table}",
  record: {
    // the new row
  },
  companyId: "${companyId}",
};

fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
`,
  updatePayload: (table: string, companyId: string) => `
const url = "<your-webhook-url>";  

const payload = {
  type: "UPDATE",
  table: "${table}",
  record: {
    // the new row
  },
  old: {
    // the old row
  },
  companyId: "${companyId}",
};

fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
`,
  deletePayload: (table: string, companyId: string) => `
const url = "<your-webhook-url>";  

const payload = {
  type: "DELETE",
  table: "${table}",
  record: {
    // the deleted row
  },
  companyId: "${companyId}",
};

fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
  `,
};

function WebhookDocs({ open, onClose }: WebhookDocsProps) {
  const webhookTables = useWebhookTables();
  const [activeTable, setActiveTable] = useState<string>("quote");
  const { company } = useUser();

  return (
    <Drawer
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="md">
        <DrawerHeader>
          <DrawerTitle>Webhook Documentation</DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <Tabs defaultValue="INSERT" className="w-full">
            <HStack className="w-full justify-between">
              <div>
                <TabsList className="grid grid-cols-3">
                  <TabsTrigger value="INSERT">INSERT</TabsTrigger>
                  <TabsTrigger value="UPDATE">UPDATE</TabsTrigger>
                  <TabsTrigger value="DELETE">DELETE</TabsTrigger>
                </TabsList>
              </div>
              <div>
                <Select
                  value={activeTable}
                  onValueChange={(val) => setActiveTable(val)}
                >
                  <SelectTrigger id="table" className="min-w-[200px]">
                    <SelectValue placeholder="Select a table" />
                  </SelectTrigger>
                  <SelectContent>
                    {webhookTables.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </HStack>
            <TabsContent value="INSERT">
              <div className="flex flex-col gap-4 py-4">
                <p>
                  When an <Badge variant="green">INSERT</Badge> event occurs,
                  the following webhook will be triggered. The <Kbd>record</Kbd>{" "}
                  object will contain the inserted row.
                </p>
                <Separator />
                <CodeBlock className="js">
                  {code.insertPayload(activeTable, company.id)}
                </CodeBlock>
                <Separator />
                <div>
                  <Button leftIcon={<LuFileText />} variant="link" asChild>
                    <Link to={path.to.apiTable("js", activeTable)}>
                      {
                        webhookTables.find(
                          (table) => table.value === activeTable
                        )?.label
                      }{" "}
                      Table Schema
                    </Link>
                  </Button>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="UPDATE">
              <div className="flex flex-col gap-4 py-4">
                <p>
                  When an <Badge variant="blue">UPDATE</Badge> event occurs,
                  we'll send a <Kbd>POST</Kbd> request to the webhook URL you've
                  provided.
                </p>
                <p>
                  The payload will be similar to the code below. The{" "}
                  <Kbd>record</Kbd> object will contain the updated row and the{" "}
                  <Kbd>old</Kbd> object will contain the previous values.
                </p>
                <Separator />
                <CodeBlock className="js">
                  {code.updatePayload(activeTable, company.id)}
                </CodeBlock>
                <Separator />
                <div>
                  <Button leftIcon={<LuFileText />} variant="link" asChild>
                    <Link to={path.to.apiTable("js", activeTable)}>
                      {
                        webhookTables.find(
                          (table) => table.value === activeTable
                        )?.label
                      }{" "}
                      Table Schema
                    </Link>
                  </Button>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="DELETE">
              <div className="flex flex-col gap-4 py-4">
                <p>
                  When a <Badge variant="red">DELETE</Badge> event occurs, we'll
                  send a <Kbd>POST</Kbd> request to the webhook URL you've
                  provided. The payload will be similar to the code below. The{" "}
                  <Kbd>record</Kbd> object will contain the deleted row.
                </p>
                <Separator />
                <CodeBlock className="js">
                  {code.deletePayload(activeTable, company.id)}
                </CodeBlock>
                <Separator />
                <div>
                  <Button leftIcon={<LuFileText />} variant="link" asChild>
                    <Link to={path.to.apiTable("js", activeTable)}>
                      {
                        webhookTables.find(
                          (table) => table.value === activeTable
                        )?.label
                      }{" "}
                      Table Schema
                    </Link>
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

interface SuccessErrorBarProps {
  successCount: number;
  errorCount: number;
}

function SuccessErrorBar({ successCount, errorCount }: SuccessErrorBarProps) {
  const total = successCount + errorCount;
  const successPercentage = total > 0 ? (successCount / total) * 100 : 0;
  const errorPercentage = total > 0 ? (errorCount / total) * 100 : 0;

  const numberFormatter = useNumberFormatter({
    maximumFractionDigits: 0,
    notation: "compact",
    compactDisplay: "short",
  });

  return (
    <div className="flex flex-col w-full gap-0">
      <div className="w-full h-3 bg-muted rounded-sm overflow-hidden flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${numberFormatter.format(successPercentage)}%` }}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p>Success: {successCount}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="h-full bg-red-500"
              style={{ width: `${errorPercentage}%` }}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p>Error: {numberFormatter.format(errorCount)}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
