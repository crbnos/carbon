import {
  Badge,
  BadgeCloseButton,
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  Enumerable,
  HStack,
  Heading,
  MenuIcon,
  MenuItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack,
  cn,
  useDisclosure,
} from "@carbon/react";
import { convertKbToString, filterEmpty, formatDate } from "@carbon/utils";
import { Link, useRevalidator } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { IoMdAdd } from "react-icons/io";
import {
  LuDownload,
  LuExternalLink,
  LuPencil,
  LuPin,
  LuTrash,
} from "react-icons/lu";
import { RxCheck } from "react-icons/rx";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { usePermissions, useUrlParams } from "~/hooks";
import type { Document, DocumentLabel } from "~/modules/documents";
import {
  DocumentIcon,
  documentSourceTypes,
  documentTypes,
} from "~/modules/documents";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import DocumentCreateForm from "./DocumentCreateForm";
import { useDocument } from "./useDocument";

type DocumentsTableProps = {
  data: Document[];
  count: number;
  labels: DocumentLabel[];
  extensions: (string | null)[];
};

const DocumentsTable = memo(
  ({ data, count, labels, extensions }: DocumentsTableProps) => {
    const permissions = usePermissions();
    const revalidator = useRevalidator();
    const [params] = useUrlParams();
    const filter = params.get("q");
    // put rows in state for use with optimistic ui updates
    const [rows, setRows] = useState<Document[]>(data);
    // we have to do this useEffect silliness since we're putitng rows
    // in state for optimistic ui updates
    useEffect(() => {
      setRows(data);
    }, [data]);

    const {
      canUpdate,
      canDelete,
      deleteLabel,
      download,
      edit,
      view,
      favorite,
      label,
      setLabel,
    } = useDocument();

    const { hasFilters } = useFilters();
    const [people] = usePeople();
    const deleteDocumentModal = useDisclosure();

    const [selectedDocument, setSelectedDocument] = useState<Document | null>(
      null
    );

    const labelOptions = useMemo(
      () =>
        labels.map(({ label }) => ({
          value: label as string,
          label: label as string,
        })) ?? [],
      [labels]
    );

    const onDeleteLabel = useCallback(
      async (
        e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
        row: Document,
        label: string
      ) => {
        e.stopPropagation();
        // optimistically update the UI and then make the mutation
        setRows((prev) => {
          const index = prev.findIndex((item) => item.id === row.id);
          const updated = [...prev];
          const labelIndex = updated[index].labels?.findIndex(
            (item: string) => item === label
          );
          if (labelIndex) {
            updated[index].labels?.splice(labelIndex, 1);
          }
          return updated;
        });
        // mutate the database
        await deleteLabel(row, label);
      },
      [deleteLabel]
    );

    const onLabel = useCallback(
      async (row: Document, labels: string[]) => {
        // optimistically update the UI and then make the mutation
        setRows((prev) => {
          const index = prev.findIndex((item) => item.id === row.id);
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            labels: labels.sort(),
          };
          return updated;
        });
        // mutate the database
        await label(row, labels);
      },
      [label]
    );

    // TODO: rows shouldn't be in state -- we should use optimistic updates like purchase order favorites
    const onFavorite = useCallback(
      async (row: Document) => {
        // optimistically update the UI and then make the mutation
        setRows((prev) => {
          const index = prev.findIndex((item) => item.id === row.id);
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            favorite: !updated[index].favorite,
          };
          return filter === "starred"
            ? updated.filter((item) => item.favorite === true)
            : updated;
        });
        // mutate the database
        await favorite(row);
      },
      [favorite, filter]
    );

    const columns = useMemo<ColumnDef<Document>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <HStack>
              {row.original.favorite ? (
                <LuPin
                  className="cursor-pointer w-4 h-4 outline-primary/50 fill-yellow-400"
                  onClick={() => onFavorite(row.original)}
                />
              ) : (
                <LuPin
                  className="cursor-pointer w-4 h-4 text-muted-foreground"
                  onClick={() => onFavorite(row.original)}
                />
              )}
              <DocumentIcon type={row.original.type!} />
              <Hyperlink
                onClick={() => view(row.original)}
                className="max-w-[260px] truncate"
              >
                <>{row.original.name}</>
              </Hyperlink>
            </HStack>
          ),
        },
        {
          accessorKey: "sourceDocument",
          header: "Source Document",
          cell: ({ row }) =>
            row.original.sourceDocument &&
            row.original.sourceDocumentId && (
              <HStack className="group" spacing={1}>
                <Enumerable value={row.original.sourceDocument} />{" "}
                <Link
                  className="group-hover:opacity-100 opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground"
                  to={getDocumentLocation(
                    row.original
                      .sourceDocument as (typeof documentSourceTypes)[number],
                    row.original.sourceDocumentId
                  )}
                  prefetch="intent"
                >
                  <LuExternalLink />
                </Link>
              </HStack>
            ),
          meta: {
            filter: {
              type: "static",
              options: documentSourceTypes?.map((type) => ({
                value: type,
                label: <Enumerable value={type} />,
              })),
            },
          },
        },
        {
          id: "labels",
          header: "Labels",
          cell: ({ row }) => (
            <HStack spacing={1}>
              {row.original.labels?.map((label: string) => (
                <Badge
                  key={label}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => setLabel(label)}
                >
                  {label}
                  <BadgeCloseButton
                    onClick={(e) => onDeleteLabel(e, row.original, label)}
                  />
                </Badge>
              ))}
              <Popover>
                <PopoverTrigger>
                  <Badge variant="secondary" className="cursor-pointer px-1">
                    <IoMdAdd />
                  </Badge>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0">
                  {/* TODO: we should have a CreateableMultiSelect component for this */}

                  <CreatableCommand
                    options={labelOptions}
                    selected={row.original.labels ?? []}
                    onChange={(newValue) =>
                      onLabel(row.original, [
                        ...(row.original.labels ?? []),
                        newValue,
                      ])
                    }
                    onCreateOption={async (newValue) => {
                      await onLabel(row.original, [
                        ...(row.original.labels ?? []),
                        newValue,
                      ]);
                      revalidator.revalidate();
                    }}
                  />
                </PopoverContent>
              </Popover>
            </HStack>
          ),
          meta: {
            filter: {
              type: "static",
              options: labelOptions,
              isArray: true,
            },
          },
        },
        {
          accessorKey: "size",
          header: "Size",
          cell: ({ row }) => convertKbToString(row.original.size ?? 0),
        },
        {
          accessorKey: "type",
          header: "Type",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "static",
              options: documentTypes.map((type) => ({
                label: (
                  <HStack spacing={2}>
                    <DocumentIcon type={type} />
                    <span>{type}</span>
                  </HStack>
                ),
                value: type,
              })),
            },
          },
        },
        {
          accessorKey: "extension",
          header: "File Extension",
          cell: (item) => item.getValue(),
          meta: {
            filter: {
              type: "static",
              options: filterEmpty(extensions).map((extension) => ({
                label: extension,
                value: extension,
              })),
            },
          },
        },
        {
          id: "createdBy",
          header: "Created By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: {
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
        },
        {
          id: "updatedBy",
          header: "Updated By",
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: {
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
          accessorKey: "updatedAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
        },
      ];
      // Don't put the revalidator in the deps array
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      extensions,
      labelOptions,
      onDeleteLabel,
      onFavorite,
      onLabel,
      people,
      setLabel,
      view,
    ]);

    const actions = useMemo(() => {
      return [
        // {
        //   label: "Add to Favorites",
        //   icon: <BsBookmark />,
        //   onClick: (selected: Document[]) => {
        //     console.log("move to favorites", selected);
        //   },
        // },
        // {
        //   label: "Add Labels",
        //   icon: <BsTag />,
        //   // TODO - disabled can be a function of selected
        //   disabled: true,
        //   onClick: (selected: Document[]) => {
        //     console.log("move to favorites", selected);
        //   },
        // },
        // {
        //   label: "Move to Trash",
        //   icon: <LuTrash />,
        //   // TODO - disabled can be a function of selected
        //   disabled: true,
        //   onClick: (selected: Document[]) => {
        //     console.log("move to trash", selected);
        //   },
        // },
        // {
        //   label: "Update Visibility",
        //   icon: <BsEyeFill />,
        //   // TODO - disabled can be a function of selected
        //   disabled: true,
        //   onClick: (selected: Document[]) => {
        //     console.log("update visibility", selected);
        //   },
        // },
      ];
    }, []);

    const defaultColumnVisibility = {
      type: false,
      extension: false,
      createdAt: false,
      updatedAt: false,
      updatedBy: false,
      description: false,
    };

    const renderContextMenu = useMemo(() => {
      // eslint-disable-next-line react/display-name
      return (row: Document) => (
        <>
          <MenuItem disabled={canUpdate(row)} onClick={() => edit(row)}>
            <MenuIcon icon={<LuPencil />} />
            Edit
          </MenuItem>
          <MenuItem onClick={() => download(row)}>
            <MenuIcon icon={<LuDownload />} />
            Download
          </MenuItem>
          <MenuItem
            onClick={() => {
              onFavorite(row);
            }}
          >
            <MenuIcon icon={<LuPin />} />
            Favorite
          </MenuItem>
          <MenuItem
            disabled={canDelete(row)}
            onClick={() => {
              setSelectedDocument(row);
              deleteDocumentModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            {filter !== "trash" ? "Move to Trash" : "Restore from Trash"}
          </MenuItem>
        </>
      );
    }, [
      canDelete,
      canUpdate,
      deleteDocumentModal,
      download,
      edit,
      filter,
      onFavorite,
    ]);

    return (
      <>
        {count === 0 && !hasFilters ? (
          <HStack className="w-full h-screen flex items-start justify-center">
            <VStack className="border rounded-md shadow-md w-96 mt-20">
              <div className="w-full flex flex-col gap-4 items-center justify-center py-8 bg-gradient-to-bl from-card to-background rounded-lg text-center group ring-4 ring-transparent hover:ring-white/10">
                <Heading size="h2">No Files Yet</Heading>
                <p className="text-muted-foreground text-base font-light">
                  Start by uploading your first file
                </p>
                <DocumentCreateForm />
              </div>
            </VStack>
          </HStack>
        ) : (
          <Table<Document>
            actions={actions}
            count={count}
            columns={columns}
            data={rows}
            defaultColumnVisibility={defaultColumnVisibility}
            primaryAction={
              permissions.can("create", "documents") && <DocumentCreateForm />
            }
            withColumnOrdering
            // withSelectableRows
            renderContextMenu={renderContextMenu}
          />
        )}

        {selectedDocument &&
          selectedDocument.id &&
          (filter !== "trash" ? (
            <ConfirmDelete
              action={path.to.deleteDocument(selectedDocument.id)}
              isOpen={deleteDocumentModal.isOpen}
              name={selectedDocument.name ?? ""}
              text={`Are you sure you want to move ${selectedDocument.name} to the trash?`}
              onCancel={() => {
                deleteDocumentModal.onClose();
                setSelectedDocument(null);
              }}
              onSubmit={() => {
                deleteDocumentModal.onClose();
                setSelectedDocument(null);
              }}
            />
          ) : (
            <Confirm
              action={path.to.documentRestore(selectedDocument.id)}
              isOpen={deleteDocumentModal.isOpen}
              name={`Restore ${selectedDocument.name}`}
              text={`Are you sure you want to restore ${selectedDocument.name} from the trash?`}
              onCancel={() => {
                deleteDocumentModal.onClose();
                setSelectedDocument(null);
              }}
              onSubmit={() => {
                deleteDocumentModal.onClose();
                setSelectedDocument(null);
              }}
            />
          ))}
      </>
    );
  }
);

type CreatableCommandProps = {
  options: {
    label: string;
    value: string;
  }[];
  selected: string[];
  onChange: (selected: string) => void;
  onCreateOption: (inputValue: string) => void;
};

const CreatableCommand = ({
  options,
  selected,
  onChange,
  onCreateOption,
}: CreatableCommandProps) => {
  const [search, setSearch] = useState("");
  const isExactMatch = options.some(
    (option) => option.value.toLowerCase() === search.toLowerCase()
  );

  return (
    <Command>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search..."
        className="h-9"
      />
      <CommandGroup>
        {options.map((option) => {
          const isSelected = !!selected?.includes(option.value);
          return (
            <CommandItem
              value={option.label}
              key={option.value}
              onSelect={() => {
                if (!isSelected) onChange(option.value);
              }}
            >
              {option.label}
              <RxCheck
                className={cn(
                  "ml-auto h-4 w-4",
                  isSelected ? "opacity-100" : "opacity-0"
                )}
              />
            </CommandItem>
          );
        })}
        {!isExactMatch && !!search && (
          <CommandItem
            onSelect={() => {
              onCreateOption(search);
            }}
            value={search}
          >
            <span>Create</span>
            <span className="ml-1 font-bold">{search}</span>
          </CommandItem>
        )}
      </CommandGroup>
    </Command>
  );
};

DocumentsTable.displayName = "DocumentsTable";

export default DocumentsTable;

function getDocumentLocation(
  sourceDocument: (typeof documentSourceTypes)[number],
  sourceDocumentId: string
) {
  switch (sourceDocument) {
    case "Part":
      return path.to.part(sourceDocumentId);
    case "Material":
      return path.to.material(sourceDocumentId);
    case "Tool":
      return path.to.tool(sourceDocumentId);
    case "Fixture":
      return path.to.fixture(sourceDocumentId);
    case "Consumable":
      return path.to.consumable(sourceDocumentId);
    case "Service":
      return path.to.service(sourceDocumentId);
    case "Purchase Order":
      return path.to.purchaseOrder(sourceDocumentId);
    case "Quote":
      return path.to.quote(sourceDocumentId);
    case "Request for Quote":
      return path.to.salesRfq(sourceDocumentId);
    default:
      return "#";
  }
}
