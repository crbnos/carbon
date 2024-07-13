import { cn } from "@carbon/react";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";

type ColumnScrollerProps = {
  direction: "left" | "right";
  visible?: boolean;
};

const ColumnScroller = ({ direction, visible }: ColumnScrollerProps) => {
  const { scrollToColumn } = useTableContext();

  return (
    <div
      className={cn(
        "relative self-stretch shrink-0 w-0 transition-[width] delay-200",
        visible && "w-6"
      )}
    >
      <button
        aria-label={direction === "left" ? "Scroll left" : "Scroll right"}
        className={cn(
          "absolute top-0 h-full flex items-center justify-center cursor-pointer bg-background z-10 transition[width] delay-200",
          visible && "w-6",
          direction === "left" ? "left-0" : "right-0"
        )}
        style={{
          boxShadow: `${
            direction === "left" ? 1 : -1
          }px 1px 4px 0px rgba(0, 0, 0, 0.1)`,
        }}
        type="button"
        onClick={() => scrollToColumn(direction)}
      >
        {direction === "left" ? (
          <LuChevronLeft className="w-6 h-6" />
        ) : (
          <LuChevronRight className="w-6 h-6" />
        )}
      </button>
    </div>
  );
};

export default ColumnScroller;
