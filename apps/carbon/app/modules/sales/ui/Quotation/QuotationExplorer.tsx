import {
  Button,
  cn,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandTrigger,
  HStack,
  IconButton,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useKeyboardShortcuts,
  VStack,
} from "@carbon/react";
import type { Params } from "@remix-run/react";
import { Link, useLocation, useNavigate, useParams } from "@remix-run/react";
import { arrayToTree } from "performant-array-to-tree";
import { useMemo, useRef, useState } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import { HiOutlineCube } from "react-icons/hi";
import { IoMdAdd } from "react-icons/io";
import { LuClock } from "react-icons/lu";
import { RxCheck, RxChevronDown } from "react-icons/rx";
import { useOptimisticLocation } from "~/hooks";
import type { BillOfMaterialNode } from "~/modules/shared";
import { path } from "~/utils/path";
import type {
  QuotationAssembly,
  QuotationLine,
  QuotationMaterial,
  QuotationOperation,
} from "../..";
import { useQuotation } from "./useQuotation";

const QuotationExplorerItem = (
  node: Omit<BillOfMaterialNode, "children"> & {
    params: Params<string>;
    pathname: string;
    onClick: () => void;
  }
) => {
  const { type, id, parentId, label, meta, params, pathname, onClick } = node;
  let isActive = false;
  switch (type) {
    case "assembly":
      isActive =
        pathname ===
        path.to.quoteAssembly(params.id!, meta.quoteLineId, meta.id);
      return (
        <Button
          leftIcon={<AiOutlinePartition />}
          variant={isActive ? "active" : "ghost"}
          className="flex-1 justify-start"
          asChild
        >
          <Link
            to={path.to.quoteAssembly(params.id!, meta.quoteLineId, meta.id)}
            prefetch="intent"
            onClick={onClick}
          >
            {label}
          </Link>
        </Button>
      );
    case "assemblies":
      isActive =
        pathname ===
        path.to.newQuoteAssembly(meta.quoteId, meta.quoteLineId, parentId);
      return (
        <Button
          variant={isActive ? "active" : "ghost"}
          className={cn(
            "font-mono w-full justify-between",
            !isActive && "text-muted-foreground"
          )}
          asChild
        >
          <Link
            to={path.to.newQuoteAssembly(
              meta.quoteId,
              meta.quoteLineId,
              parentId
            )}
            onClick={onClick}
          >
            <span>{label}</span>
            <IoMdAdd />
          </Link>
        </Button>
      );
    case "line":
      isActive = pathname === path.to.quoteLine(params.id!, id);

      return (
        <Button
          variant={isActive ? "active" : "ghost"}
          className="flex-1 justify-between"
          asChild
        >
          <Link
            to={path.to.quoteLine(params.id!, id)}
            prefetch="intent"
            onClick={onClick}
          >
            <span className="flex items-center justify-start">
              {meta.replenishmentSystem === "Buy" ? (
                <HiOutlineCube className="w-4 h-4 mr-2" />
              ) : (
                <AiOutlinePartition className="w-4 h-4 mr-2" />
              )}
              {label}
            </span>
            <span
              className={cn(
                "rounded-full h-2 w-2 inline-block ml-2",
                meta?.status === "Complete" && "bg-green-500",
                meta?.status === "In Progress" && "bg-orange-500",
                meta?.status === "Draft" && "bg-zinc-500"
              )}
            />
          </Link>
        </Button>
      );

    case "material":
      return (
        <Button
          leftIcon={<HiOutlineCube />}
          variant="ghost"
          className="flex-1 justify-start"
          asChild
        >
          <Link
            to={path.to.quoteOperation(params.id!, meta.quoteLineId, parentId!)}
          >
            {label}
          </Link>
        </Button>
      );

    case "materials":
      return (
        <Button
          variant="ghost"
          className="font-mono w-full justify-between text-muted-foreground"
          asChild
        >
          <Link
            to={path.to.newQuoteMaterial(params.id!, meta.quoteLineId, meta.id)}
            onClick={onClick}
          >
            <span>{label}</span>
            <IoMdAdd />
          </Link>
        </Button>
      );
    case "operations":
      isActive =
        pathname ===
        path.to.newQuoteOperation(meta.quoteId, meta.quoteLineId, parentId);
      return (
        <Button
          variant={isActive ? "active" : "ghost"}
          className={cn(
            "font-mono w-full justify-between",
            !isActive && "text-muted-foreground"
          )}
          asChild
        >
          <Link
            to={path.to.newQuoteOperation(
              meta.quoteId,
              meta.quoteLineId,
              parentId
            )}
            onClick={onClick}
          >
            <span>{label}</span>
            <IoMdAdd />
          </Link>
        </Button>
      );

    case "operation":
      isActive = [
        path.to.quoteOperation(params.id!, meta.quoteLineId, meta.id),
        path.to.newQuoteMaterial(params.id!, meta.quoteLineId, meta.id),
      ].includes(pathname);
      return (
        <Button
          leftIcon={<LuClock />}
          variant={isActive ? "active" : "ghost"}
          className="flex-1 justify-start"
          asChild
        >
          <Link
            to={path.to.quoteOperation(params.id!, meta.quoteLineId, meta.id)}
            prefetch="intent"
            onClick={onClick}
          >
            {label}
          </Link>
        </Button>
      );
    case "parent":
      isActive = pathname === path.to.quoteDetails(id);
      return (
        <Button
          variant={isActive ? "active" : "ghost"}
          className="flex-1 justify-start"
          asChild
        >
          <Link
            to={path.to.quote(params.id!)}
            prefetch="intent"
            onClick={onClick}
          >
            {label}
          </Link>
        </Button>
      );
    default:
      throw new Error(
        `unknown type: ${type} for node: ${JSON.stringify(node, null, 2)}`
      );
  }
};

const QuotationExplorer = () => {
  const { pathname, search } = useOptimisticLocation();

  const params = useParams();
  if (!params.id) throw new Error("id not found");

  const [quote] = useQuotation();

  const tree = useMemo(() => {
    if (!quote.quote) return [];

    let materialsByOperationId = quote.materials?.reduce<
      Record<string, QuotationMaterial[]>
    >((acc, material) => {
      if (!acc[material.quoteOperationId]) {
        acc[material.quoteOperationId] = [];
      }
      acc[material.quoteOperationId].push(material);
      return acc;
    }, {});

    let operationsByAssemblyId = quote.operations?.reduce<
      Record<string, BillOfMaterialNode[]>
    >((acc, operation) => {
      if (!operation?.quoteAssemblyId) return acc;
      if (!acc[operation.quoteAssemblyId]) {
        acc[operation.quoteAssemblyId] = [];
      }

      acc[operation.quoteAssemblyId].push({
        id: operation.id,
        parentId: operation.quoteAssemblyId ?? undefined,
        label: operation.description ?? "Operation",
        type: "operation",
        meta: operation,
        children: [
          {
            id: `${operation.id}-materials`,
            label: "Materials",
            type: "materials",
            meta: operation,
            children: materialsByOperationId[operation.id]?.map((material) => ({
              id: material.id,
              parentId: operation.id,
              label: material.description,
              type: "material",
              meta: material,
            })),
          },
        ],
      });
      return acc;
    }, {});

    const assembliesByLineId = quote.assemblies?.reduce<
      Record<string, BillOfMaterialNode[]>
    >((acc, assembly) => {
      if (!acc[assembly.quoteLineId]) {
        acc[assembly.quoteLineId] = [];
      }
      acc[assembly.quoteLineId].push({
        id: assembly.id,
        parentId: assembly.parentAssemblyId ?? undefined,
        label: assembly.description ?? assembly.itemId,
        type: "assembly",
        meta: assembly,
      });
      return acc;
    }, {});

    const operationsByLineId = quote.operations?.reduce<
      Record<string, BillOfMaterialNode[]>
    >((acc, operation) => {
      if (!acc[operation.quoteLineId]) {
        acc[operation.quoteLineId] = [];
      }
      acc[operation.quoteLineId].push({
        id: operation.id,
        parentId: operation.quoteAssemblyId ?? undefined,
        label: operation.description ?? "Operation",
        type: "operation",
        meta: operation,
        children: [
          {
            id: `${operation.id}-materials`,
            label: "Materials",
            type: "materials",
            meta: operation,
            children: materialsByOperationId[operation.id]?.map((material) => ({
              id: material.id,
              parentId: operation.id,
              label: material.description,
              type: "material",
              meta: material,
            })),
          },
        ],
      });
      return acc;
    }, {});

    let tree: BillOfMaterialNode[] = [
      {
        id: quote.quote.id!,
        label: quote.quote.quoteId!,
        type: "parent",
        children: quote.lines?.map<BillOfMaterialNode>((line) => ({
          id: line.id!,
          label: line.description!,
          type: "line",
          meta: line,
          children:
            line.replenishmentSystem === "Make"
              ? [
                  {
                    id: `${line.id}-assemblies`,
                    label: "Assemblies",
                    type: "assemblies",
                    children: assembliesByLineId[line.id!]
                      ? [
                          ...(arrayToTree([...assembliesByLineId[line.id!]], {
                            id: "id",
                            dataField: null,
                          }) as BillOfMaterialNode[]),
                        ]
                      : [],
                    meta: {
                      quoteId: line.quoteId,
                      quoteLineId: line.id,
                    },
                  },
                  {
                    id: `${line.id}-operations`,
                    label: "Operations",
                    type: "operations",
                    children: operationsByLineId[line.id!]
                      ? [...operationsByLineId[line.id!]]?.filter(
                          (operation) => operation.parentId === undefined
                        )
                      : ([] as BillOfMaterialNode[]),
                    meta: {
                      quoteId: line.quoteId,
                      quoteLineId: line.id,
                    },
                  },
                ]
              : undefined,
        })),
      },
    ];

    traverseTree(tree, (node) => {
      if (node.type === "assembly") {
        let currentChildren = node.children ? [...node.children] : [];
        node.children = [
          {
            id: `${node.id}-assemblies`,
            parentId: node.id,
            label: "Assemblies",
            type: "assemblies",
            children: currentChildren,
            meta: {
              quoteId: node.meta.quoteId,
              quoteLineId: node.meta.quoteLineId,
            },
          },
          {
            id: `${node.id}-operations`,
            parentId: node.id,
            label: "Operations",
            type: "operations",
            children: operationsByAssemblyId[node.id]
              ? [...operationsByAssemblyId[node.id]]
              : [],
            meta: {
              quoteId: node.meta.quoteId,
              quoteLineId: node.meta.quoteLineId,
            },
          },
        ];
      }
    });

    return tree;
  }, [quote]);

  const nodeParentById = useMemo(() => {
    let result: Record<string, string> = {};
    traverseTree(tree, (node) => {
      if (node.children) {
        node.children.forEach((child) => {
          // better to lose functionality than to have an infinite loop
          if (child.id !== node.id) {
            result[child.id] = node.id;
          }
        });
      }
    });
    return result;
  }, [tree]);

  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>(
    {}
  );

  const openNode = (id: string) => {
    const collapsed = { [id]: false };
    let currentId = id;
    while (nodeParentById[currentId]) {
      collapsed[nodeParentById[currentId]] = false;
      currentId = nodeParentById[currentId];
    }

    setCollapsedNodes((prev) => ({
      ...prev,
      ...collapsed,
    }));
  };

  const toggleNode = (id: string) => {
    setCollapsedNodes((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const renderBillOfMaterial = (
    tree: BillOfMaterialNode[],
    level: number = 0
  ) => {
    return tree.map((node) => {
      return (
        <div className="w-full" role="group" key={`${node.id}:${node.type}`}>
          <HStack
            className="items-stretch w-full"
            spacing={0}
            style={{
              paddingLeft: `calc(${0.75 * level}rem)`,
            }}
          >
            <IconButton
              aria-label={collapsedNodes[node.id] ? "Expand" : "Collapse"}
              onClick={() => toggleNode(node.id)}
              isDisabled={!node.children}
              icon={<RxChevronDown />}
              style={{
                transition: "transform .25s ease",
                transform:
                  collapsedNodes[node.id] === undefined ||
                  collapsedNodes[node.id] === false ||
                  !node.children ||
                  node.children?.length === 0
                    ? undefined
                    : "rotate(-0.25turn)",
              }}
              variant="ghost"
            />
            <QuotationExplorerItem
              type={node.type}
              id={node.id}
              label={node.label}
              parentId={node.parentId}
              params={params}
              pathname={pathname + search}
              meta={node.meta}
              onClick={() => openNode(node.id)}
            />
          </HStack>
          {node.children &&
            !collapsedNodes[node.id] &&
            renderBillOfMaterial(node.children, level + 1)}
        </div>
      );
    });
  };

  const newButtonRef = useRef<HTMLButtonElement>(null);
  useKeyboardShortcuts({
    l: () => {
      if (newButtonRef.current) {
        newButtonRef.current.click();
      }
    },
  });

  const navigate = useNavigate();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  return (
    <>
      <VStack className="border-b border-border p-2" spacing={0}>
        <HStack className="w-full justify-between">
          <QuotationSearch onSelect={openNode} />
          <Tooltip>
            <TooltipTrigger>
              <IconButton
                aria-label="Add Quote Line"
                icon={<IoMdAdd />}
                ref={newButtonRef}
                onClick={() => navigate(path.to.newQuoteLine(id))}
              />
            </TooltipTrigger>
            <TooltipContent>
              Add Quote Line <Kbd>l</Kbd>
            </TooltipContent>
          </Tooltip>
        </HStack>
      </VStack>
      <VStack className="h-full w-full p-2">
        <div className="w-full h-full overflow-auto" role="tree">
          {renderBillOfMaterial(tree)}
          {quote && Array.isArray(quote.lines) && quote.lines.length === 0 && (
            <div className="flex flex-col space-y-2 py-16 text-muted-foreground items-center justify-center text-center">
              <span className="text-sm">No quote lines</span>
              <Button onClick={() => navigate(path.to.newQuoteLine(id))}>
                Add Quote Line
              </Button>
            </div>
          )}
        </div>
      </VStack>
    </>
  );
};

export default QuotationExplorer;

function traverseTree(
  tree: BillOfMaterialNode[],
  callback: (node: BillOfMaterialNode) => void
) {
  tree.forEach((node) => {
    callback(node);
    if (node.children) {
      traverseTree(node.children, callback);
    }
  });
}

type QuotationSearchProps = {
  onSelect: (id: string) => void;
};

const QuotationSearch = ({ onSelect }: QuotationSearchProps) => {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [quote] = useQuotation();
  const assembliesById = useMemo(
    () =>
      quote?.assemblies.reduce<Record<string, QuotationAssembly>>(
        (acc, assembly) => {
          acc[assembly.id] = assembly;
          return acc;
        },
        {}
      ),
    [quote?.assemblies]
  );

  const linesById = useMemo(
    () =>
      quote?.lines.reduce<Record<string, QuotationLine>>((acc, line) => {
        acc[line.id!] = line;
        return acc;
      }, {}),
    [quote?.lines]
  );

  const operationsById = useMemo(
    () =>
      quote?.operations.reduce<Record<string, QuotationOperation>>(
        (acc, operation) => {
          acc[operation.id] = operation;
          return acc;
        },
        {}
      ),
    [quote?.operations]
  );

  const commandTriggerRef = useRef<HTMLButtonElement>(null);

  useKeyboardShortcuts({
    s: () => {
      if (commandTriggerRef.current) {
        commandTriggerRef.current.click();
      }
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CommandTrigger
          ref={commandTriggerRef}
          size="sm"
          role="combobox"
          onClick={() => setOpen(true)}
        >
          Search Quote
        </CommandTrigger>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." className="h-9" />
          <CommandEmpty>No option found.</CommandEmpty>
          {quote?.lines.length > 0 && (
            <CommandGroup heading="Lines">
              {quote?.lines.map((line) => (
                <CommandItem
                  value={`lines ${line.itemId} ${line.description}`}
                  key={line.id}
                  onSelect={() => {
                    onSelect(line.id!);
                    navigate(path.to.quoteLine(line.quoteId!, line.id!));
                    setOpen(false);
                  }}
                >
                  <div className="flex flex-col">
                    <p>{line.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.itemId}
                    </p>
                  </div>

                  <RxCheck
                    className={cn(
                      "ml-auto h-4 w-4",
                      `${pathname}${search}` ===
                        path.to.quoteLine(line.quoteId!, line.id!)
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {quote?.assemblies.length > 0 && (
            <CommandGroup heading="Assemblies">
              {quote?.assemblies.map((assembly) => (
                <CommandItem
                  value={`assemblies ${assembly.itemId} ${assembly.description}`}
                  key={assembly.id}
                  onSelect={() => {
                    onSelect(assembly.id);
                    navigate(
                      path.to.quoteAssembly(
                        assembly.quoteId,
                        assembly.quoteLineId,
                        assembly.id
                      )
                    );
                    setOpen(false);
                  }}
                >
                  <div className="flex flex-col">
                    <p>{assembly.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {assembly.itemId}
                    </p>
                  </div>

                  <RxCheck
                    className={cn(
                      "ml-auto h-4 w-4",
                      `${pathname}${search}` ===
                        path.to.quoteAssembly(
                          assembly.quoteId,
                          assembly.quoteLineId,
                          assembly.id
                        )
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {quote?.operations.length > 0 && (
            <CommandGroup heading="Operations">
              {quote?.operations.map((operation) => {
                const parent = operation.quoteAssemblyId
                  ? assembliesById[operation.quoteAssemblyId]
                  : linesById[operation.quoteLineId];
                const to = path.to.quoteOperation(
                  operation.quoteId,
                  operation.quoteLineId,
                  operation.id
                );
                return (
                  <CommandItem
                    value={`operations ${operation.description} ${parent.description} ${operation.id}`}
                    key={operation.id}
                    onSelect={() => {
                      onSelect(operation.id);
                      navigate(to);
                      setOpen(false);
                    }}
                  >
                    <div className="flex flex-col">
                      <p>{operation.description}</p>

                      <p className="text-xs text-muted-foreground">
                        {parent.description}
                      </p>
                    </div>

                    <RxCheck
                      className={cn(
                        "ml-auto h-4 w-4",
                        `${pathname}${search}` === to
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
          {quote?.materials.length > 0 && (
            <CommandGroup heading="Operations">
              {quote?.materials.map((material) => {
                const parent = operationsById[material.quoteOperationId];
                const to = path.to.quoteOperation(
                  material.quoteId,
                  material.quoteLineId,
                  material.quoteOperationId
                );
                return (
                  <CommandItem
                    value={`materials ${material.description} ${material.itemId} ${parent.description}`}
                    key={material.id}
                    onSelect={() => {
                      onSelect(material.id);
                      navigate(to);
                      setOpen(false);
                    }}
                  >
                    <div className="flex flex-col">
                      <p>{material.description}</p>

                      <p className="text-xs text-muted-foreground">
                        {parent.description}
                      </p>
                    </div>

                    <RxCheck
                      className={cn(
                        "ml-auto h-4 w-4",
                        `${pathname}${search}` === to
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
};
