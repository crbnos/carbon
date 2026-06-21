"use client";

import { flowsOf, useGuide } from "./guide-context";

function Divider() {
  return (
    <span className="relative mx-[7px] h-4 w-px shrink-0 self-center">
      <span
        className="absolute inset-0 opacity-40"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(32,32,32,0.18) 50%, transparent 100%)",
        }}
      />
    </span>
  );
}

/** Guide-only sticky sub-header: How to · <Flow> · <Flow> · …
 *  Each tab is a flow (a self-contained tour); selecting one jumps to its first
 *  chapter. The flow's chapters then live in the sidebar (and mobile selector). */
export function GuideSubnav() {
  const { active, goTo, chapters } = useGuide();
  const flows = flowsOf(chapters);
  const activeFlow = chapters[active.chapter]?.flow;

  return (
    <div
      className="fixed inset-x-0 top-16 z-[55] hidden min-[1000px]:block"
      style={{ background: "#F5F5F2", borderBottom: "1px solid #E8E7E6", boxShadow: "0 1px 0 0 #fff" }}
    >
      <div className="mx-auto flex h-13 w-full max-w-360 items-center overflow-x-auto px-6 scrollbar-none md:px-8">
        <nav className="flex items-center">
          <span
            className="nav-link whitespace-nowrap px-1.5 text-ed-15 font-book leading-normal tracking-[0.15px]"
            style={{ color: "rgba(32, 32, 32, 0.40)" }}
          >
            How to
          </span>
          {flows.map((flow) => {
            const isActive = activeFlow === flow.slug;
            return (
              <span className="contents" key={flow.slug}>
                <Divider />
                <span className="group relative inline-flex rounded-[7px]">
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-0 rounded-[7px] transition-opacity duration-200 ease-out ${
                      isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    } bg-ed-hairline/80`}
                  />
                  <a
                    className="nav-link relative z-10 flex items-center whitespace-nowrap px-3 py-2 text-ed-15 font-book leading-normal tracking-[0.15px] text-ink-ui no-underline"
                    href={`/guides/${chapters[flow.firstIndex]?.slug ?? ""}`}
                    aria-current={isActive ? "page" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      goTo({ chapter: flow.firstIndex, item: 0 });
                    }}
                  >
                    {flow.name}
                  </a>
                </span>
              </span>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
