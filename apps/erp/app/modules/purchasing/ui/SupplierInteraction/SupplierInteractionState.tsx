import { Button, cn, Menubar } from "@carbon/react";
import { useOptimisticLocation } from "@carbon/remix";
import { Link } from "@remix-run/react";
import { LuCircle, LuLayoutList, LuPackageSearch } from "react-icons/lu";
import { path } from "~/utils/path";
import type { SupplierInteraction } from "../../types";

function getSupplierInteractionStarted(
  interaction: SupplierInteraction,
  state: string
) {
  switch (state) {
    case "Purchase Order":
      return interaction.purchaseOrderId !== null;
    case "Supplier Quote":
      return interaction.supplierQuoteId !== null;
  }
}

function getSupplierInteractionCompleted(
  interaction: SupplierInteraction,
  state: string
) {
  switch (state) {
    case "Purchase Order":
      return interaction.purchaseOrderCompletedDate !== null;
    case "Supplier Quote":
      return interaction.supplierQuoteCompletedDate !== null;
  }
}

function getSupplierInteractionIcon(state: string) {
  switch (state) {
    case "Purchase Order":
      return LuLayoutList;
    case "Supplier Quote":
      return LuPackageSearch;
    default:
      return LuCircle;
  }
}

function getPath(interaction: SupplierInteraction, state: string) {
  switch (state) {
    case "Purchase Order":
      return path.to.purchaseOrderDetails(interaction.purchaseOrderId!);
    case "Supplier Quote":
      return path.to.supplierQuoteDetails(interaction.supplierQuoteId!);
  }
}

function getIsCurrent(
  interaction: SupplierInteraction,
  pathname: string,
  state: string
) {
  switch (state) {
    case "Purchase Order":
      return pathname.includes(
        path.to.purchaseOrderDetails(interaction.purchaseOrderId!)
      );
    case "Supplier Quote":
      return pathname.includes(
        path.to.supplierQuoteDetails(interaction.supplierQuoteId!)
      );

    default:
      return false;
  }
}

const states = ["Purchase Order", "Supplier Quote"];

const SupplierInteractionState = ({
  interaction,
}: {
  interaction: SupplierInteraction;
}) => {
  const { pathname } = useOptimisticLocation();
  return (
    <Menubar>
      {states.map((state, index) => {
        const isStarted = getSupplierInteractionStarted(interaction, state);
        const isCompleted = getSupplierInteractionCompleted(interaction, state);
        const isCurrent = getIsCurrent(interaction, pathname, state);
        const Icon = getSupplierInteractionIcon(state);
        const to = getPath(interaction, state);

        return isStarted && to ? (
          <Button
            leftIcon={
              <Icon
                className={cn(
                  isCurrent && "text-emerald-500",
                  !isCurrent && "opacity-80 hover:opacity-100"
                )}
              />
            }
            variant="ghost"
            asChild
          >
            <Link to={to}>{state}</Link>
          </Button>
        ) : (
          <Button
            variant="ghost"
            isDisabled
            leftIcon={
              <Icon
                className={cn(
                  isCompleted && "text-emerald-500",
                  !isCurrent && "opacity-80 hover:opacity-100"
                )}
              />
            }
          >
            {state}
          </Button>
        );
      })}
    </Menubar>
  );
};

export default SupplierInteractionState;
