import type { PropsWithChildren } from "react";
import { lazy, Suspense } from "react";

// Lazy so react-shiki loads only where a code block renders. On import it
// injects an unlayered `.relative { position: relative }` stylesheet, which
// beats Tailwind's layered utilities and silently cancels every responsive
// `relative lg:absolute` pairing on the page — and the highlighter itself is
// created with a top-level await on import.
const CodeBlockHighlighted = lazy(() => import("./CodeBlockHighlighted"));

export interface CodeBlockProps {
  parentClassName?: string;
  className?: string;
  showCopy?: boolean;
}

const CodeBlock = (props: PropsWithChildren<CodeBlockProps>) => (
  <Suspense
    fallback={
      <pre className={props.parentClassName}>
        {(props.children as string)?.trim()}
      </pre>
    }
  >
    <CodeBlockHighlighted {...props} />
  </Suspense>
);

export { CodeBlock };
