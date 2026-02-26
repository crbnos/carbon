import type { ShikiTransformer } from "@shikijs/types";
import type { PropsWithChildren } from "react";
import { useEffect, useState } from "react";
import ShikiHighlighter, {
  createHighlighterCore,
  createJavaScriptRegexEngine
} from "react-shiki/core";
import { Button } from "./Button";

// ─── Highlighter Setup ───────────────────────────────────────────────────────

const highlighter = await createHighlighterCore({
  themes: [import("@shikijs/themes/night-owl")],
  langs: [
    import("@shikijs/langs/bash"),
    import("@shikijs/langs/javascript"),
    import("@shikijs/langs/tsx")
  ],
  engine: createJavaScriptRegexEngine()
});

const removeItalics: ShikiTransformer = {
  name: "remove-italics",
  span(node) {
    const style = node.properties?.style;
    if (typeof style === "string" && style.includes("font-style")) {
      node.properties.style = style.replace(/font-style:\s*italic;?/g, "");
    }
  }
};

// ─── Component ───────────────────────────────────────────────────────────────

interface CodeBlockProps {
  parentClassName?: string;
  className?: string;
  showCopy?: boolean;
}

const CodeBlock = ({
  children,
  parentClassName,
  className: languageClassName,
  showCopy = true
}: PropsWithChildren<CodeBlockProps>) => {
  const [showCopied, setShowCopied] = useState(false);

  useEffect(() => {
    if (!showCopied) return;
    const timer = setTimeout(() => setShowCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [showCopied]);

  const language = languageClassName?.replace(/language-/, "") || "typescript";
  const code = (children as string)?.trim() ?? "";

  const handleCopyCode = () => {
    window.navigator.clipboard.writeText(code);
    setShowCopied(true);
  };

  return (
    <div className={`Code codeBlockWrapper group ${parentClassName ?? ""}`}>
      <ShikiHighlighter
        highlighter={highlighter}
        language={language}
        theme={"night-owl"}
        showLanguage={false}
        addDefaultStyles={true}
        className="codeBlock"
        transformers={[removeItalics]}
      >
        {code}
      </ShikiHighlighter>

      {showCopy && (
        <div className="invisible absolute right-0 top-0 opacity-0 transition-opacity group-hover:visible group-hover:opacity-100">
          <Button size="sm" onClick={handleCopyCode}>
            {showCopied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
};

export { CodeBlock };
