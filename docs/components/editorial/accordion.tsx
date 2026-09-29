import type { ReactNode } from "react";

// Native <details>: works without JS and stays open-able from find-in-page.
export function Accordion({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="group my-3 rounded-[10px] border border-ed-hairline bg-[#F5F5F2]/70">
      <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-3 px-4 py-3 text-ed-15 font-demi text-ink-ui [&::-webkit-details-marker]:hidden">
        {title}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-ed-hairline px-4 pb-1 [&>ul]:my-3">
        {children}
      </div>
    </details>
  );
}
