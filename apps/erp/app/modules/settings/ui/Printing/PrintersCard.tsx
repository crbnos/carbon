import { Input, Select, Submit, ValidatedForm } from "@carbon/form";
import type { PrinterRoute } from "@carbon/printing";
import { printerRouteValidator } from "@carbon/printing";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  useDisclosure
} from "@carbon/react";
import { getLabelSizeLabel, labelSizes } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { LuEllipsisVertical, LuPlay, LuPlus, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Empty } from "~/components";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { path } from "~/utils/path";

function getMediaSizeLabel(mediaSizeId: string): string {
  const size = labelSizes.find((s) => s.id === mediaSizeId);
  return size ? getLabelSizeLabel(size) : mediaSizeId;
}

export function PrintersCard({
  printerRoutes
}: {
  printerRoutes: PrinterRoute[];
}) {
  const { t } = useLingui();
  const routeFetcher = useFetcher<{ success: boolean; message: string }>();

  const formatOptions = [
    { value: "zpl", label: t`ZPL (Thermal Label)` },
    { value: "pdf", label: t`PDF (Document)` }
  ];

  const newPrinterDisclosure = useDisclosure();
  const deletePrinterDisclosure = useDisclosure();
  const [printerToDelete, setPrinterToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // ZPL printers can only print thermal sizes; PDF printers can print any size
  const [selectedFormat, setSelectedFormat] = useState<"zpl" | "pdf">("zpl");
  const mediaSizeOptions = useMemo(
    () =>
      labelSizes
        .filter((s) => (selectedFormat === "zpl" ? Boolean(s.zpl) : true))
        .map((s) => ({ value: s.id, label: getLabelSizeLabel(s) })),
    [selectedFormat]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: we don't need to re-run this effect when onClose changes
  useEffect(() => {
    if (routeFetcher.data?.success === true && routeFetcher.data?.message) {
      toast.success(routeFetcher.data.message);
      newPrinterDisclosure.onClose();
    }
    if (routeFetcher.data?.success === false && routeFetcher.data?.message) {
      toast.error(routeFetcher.data.message);
    }
  }, [routeFetcher.data?.message, routeFetcher.data?.success]);

  return (
    <>
      <Card>
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Printers</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Physical printers available for assignment.</Trans>
            </CardDescription>
          </CardHeader>
          <CardAction className="py-6">
            <Button
              leftIcon={<LuPlus />}
              onClick={() => {
                setSelectedFormat("zpl");
                newPrinterDisclosure.onOpen();
              }}
            >
              <Trans>Add Printer</Trans>
            </Button>
          </CardAction>
        </HStack>
        <CardContent>
          {printerRoutes.length > 0 ? (
            <div className="flex flex-col gap-2">
              {printerRoutes.map((route) => (
                <div
                  key={route.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-medium">{route.name}</span>
                    <span className="text-xs text-muted-foreground uppercase">
                      {route.format}
                    </span>
                    {route.mediaSizeId && (
                      <span className="text-xs text-muted-foreground">
                        {getMediaSizeLabel(route.mediaSizeId)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground font-mono truncate max-w-[300px]">
                      {route.printerUrl}
                    </span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        aria-label={t`More`}
                        icon={<LuEllipsisVertical />}
                        variant="ghost"
                        size="sm"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          routeFetcher.submit(
                            { intent: "testPrint", routeId: route.id },
                            { method: "POST" }
                          )
                        }
                      >
                        <DropdownMenuIcon icon={<LuPlay />} />
                        <Trans>Test</Trans>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        destructive
                        onSelect={() => {
                          setPrinterToDelete({
                            id: route.id,
                            name: route.name
                          });
                          deletePrinterDisclosure.onOpen();
                        }}
                      >
                        <DropdownMenuIcon icon={<LuTrash />} />
                        <Trans>Delete</Trans>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          ) : (
            <Empty>
              <p className="text-sm text-muted-foreground mt-10">
                <Trans>
                  No printers configured. Click "Add Printer" to create one.
                </Trans>
              </p>
            </Empty>
          )}
        </CardContent>
      </Card>

      {newPrinterDisclosure.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) newPrinterDisclosure.onClose();
          }}
        >
          <ModalContent size="large">
            <ValidatedForm
              method="post"
              validator={printerRouteValidator}
              fetcher={routeFetcher}
              defaultValues={{ format: "zpl" }}
              className="flex flex-col h-full"
            >
              <input type="hidden" name="intent" value="upsertRoute" />
              <ModalHeader>
                <ModalTitle>
                  <Trans>Add Printer</Trans>
                </ModalTitle>
              </ModalHeader>
              <ModalBody>
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-4">
                    <Input
                      name="name"
                      label={t`Name`}
                      placeholder={t`e.g. Zebra 2x1`}
                    />
                    <Select
                      name="format"
                      label={t`Format`}
                      options={formatOptions}
                      onChange={(option) => {
                        if (
                          option?.value === "zpl" ||
                          option?.value === "pdf"
                        ) {
                          setSelectedFormat(option.value);
                        }
                      }}
                    />

                    <Select
                      name="mediaSizeId"
                      label={t`Media Size`}
                      options={mediaSizeOptions}
                    />
                    <Input
                      name="templateId"
                      label={t`Template ID`}
                      placeholder={t`Leave blank for built-in`}
                    />

                    <Input
                      name="printerUrl"
                      label={t`Printer URL`}
                      placeholder="https://pbx-XXXX.pbxz.cloud/api/v1/print/..."
                    />
                    <Input
                      name="apiKey"
                      label={t`API Key`}
                      placeholder={t`Optional`}
                    />
                  </div>
                </div>
              </ModalBody>
              <ModalFooter>
                <HStack>
                  <Button
                    size="md"
                    variant="solid"
                    onClick={newPrinterDisclosure.onClose}
                  >
                    <Trans>Cancel</Trans>
                  </Button>
                  <Submit>
                    <Trans>Add Printer</Trans>
                  </Submit>
                </HStack>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}

      {deletePrinterDisclosure.isOpen && printerToDelete && (
        <ConfirmDelete
          action={path.to.deletePrinterRoute(printerToDelete.id)}
          isOpen={deletePrinterDisclosure.isOpen}
          name={printerToDelete.name}
          text={t`Are you sure you want to delete the printer "${printerToDelete.name}"? Any assignments referencing this printer will be cleared. This cannot be undone.`}
          onCancel={() => {
            deletePrinterDisclosure.onClose();
            setPrinterToDelete(null);
          }}
          onSubmit={() => {
            deletePrinterDisclosure.onClose();
            setPrinterToDelete(null);
          }}
        />
      )}
    </>
  );
}
