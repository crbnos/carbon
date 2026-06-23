"use client";

import { useMobileNavClose } from "@/components/mobile-nav";
import { chaptersInFlow, flowsOf, useGuide } from "./guide-context";

/**
 * The Guide's tree inside the mobile drawer. Unlike the desktop SidebarNav (which
 * shows only the active flow), this lays out every flow → chapter → section so the
 * whole guide is reachable from a phone. Selecting anything switches via the same
 * `goTo` client state the rest of the reader uses, then closes the drawer.
 */
export function GuideMobileNav() {
  const { chapters, active, goTo } = useGuide();
  const close = useMobileNavClose();
  const flows = flowsOf(chapters);

  const select = (chapter: number, item: number) => {
    goTo({ chapter, item });
    close();
  };

  return (
    <div className="flex flex-col gap-[30px]">
      {flows.map((flow) => (
        <div key={flow.slug}>
          <p className="mb-4 px-1 font-mono text-ed-11 font-semibold uppercase tracking-[0.08em] text-ed-ink/50">
            {flow.name}
          </p>
          <div className="flex flex-col gap-[26px]">
            {chaptersInFlow(chapters, flow.slug).map(({ chapter, index }) => (
              <div key={chapter.slug}>
                <button
                  type="button"
                  onClick={() => select(index, 0)}
                  className="flex w-full items-baseline gap-2 border-none bg-transparent px-1 text-left"
                >
                  <span className="font-mono text-ed-11 font-medium leading-[140%] text-ink-faint">
                    {chapter.label}
                  </span>
                  <span className="text-ed-15 font-demi leading-[140%] tracking-[0.15px] text-ed-ink/82">
                    {chapter.title}
                  </span>
                </button>
                <div className="mt-3.5 flex flex-col gap-3 pl-1">
                  {chapter.items.map((item, itemIdx) => {
                    const isActive = active.chapter === index && active.item === itemIdx;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => select(index, itemIdx)}
                        className="flex cursor-pointer items-center gap-3.5 border-none bg-transparent p-0 text-left"
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-[5.5px] transition-all duration-200 ${
                            isActive
                              ? "bg-ed-blue-bg-strong shadow-[0_1px_1px_0_rgba(0,126,183,0.70),inset_0_0.5px_0.2px_0_#FFF,0_0_0_3px_#96DEFF]"
                              : "bg-ed-warm-100 shadow-[0_1px_1px_0_rgba(0,0,0,0.25),0_0_0_3px_rgba(213,213,211,0.50),inset_0_0.5px_0.2px_0_#FFF]"
                          }`}
                        />
                        <span
                          className={`text-ed-14 font-book leading-[140%] tracking-[0.15px] transition-colors ${
                            isActive ? "text-ed-ink" : "text-ed-graphite/82"
                          }`}
                        >
                          {item.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
