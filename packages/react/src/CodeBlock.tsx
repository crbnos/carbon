/**
 * Copyright (c) 2017-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import type { Language } from "prism-react-renderer";
import { Highlight, themes } from "prism-react-renderer";
import type { PropsWithChildren } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

const prism = {
  defaultLanguage: "js",
  plugins: ["line-numbers", "show-language"],
};

interface CodeBlockProps {
  parentClassName?: string;
  className?: string;
  showCopy?: boolean;
}

const CodeBlock = ({
  children,
  parentClassName,
  className: languageClassName,
  showCopy = true,
}: PropsWithChildren<CodeBlockProps>) => {
  const [showCopied, setShowCopied] = useState(false);
  const target = useRef(null);
  let highlightLines: any = [];

  useEffect(() => {
    if (!showCopied) return;
    const timer = setTimeout(() => setShowCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [showCopied]);

  let language =
    languageClassName && languageClassName.replace(/language-/, "");

  if (!language && prism.defaultLanguage) {
    language = prism.defaultLanguage;
  }

  const handleCopyCode = (code: any) => {
    window.navigator.clipboard.writeText(code);
    setShowCopied(true);
  };

  // html tag has dark className
  const isDarkMode =
    document?.documentElement.classList.contains("dark") ?? true;

  return (
    <Highlight
      theme={isDarkMode ? themes.nightOwl : themes.nightOwlLight}
      code={(children as string)?.trim() ?? ""}
      language={language as Language}
    >
      {({ className, tokens, getLineProps, getTokenProps }) => {
        return (
          <div className="Code codeBlockWrapper group">
            <pre
              ref={target}
              className={`codeBlock ${className} ${parentClassName}`}
            >
              {tokens.map((line, i) => {
                const lineProps = getLineProps({ line, key: i });

                if (highlightLines.includes(i + 1)) {
                  lineProps.className = `${lineProps.className} docusaurus-highlight-code-line`;
                }

                return (
                  <div key={i} {...lineProps}>
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token, key })} />
                    ))}
                  </div>
                );
              })}
            </pre>
            {showCopy && (
              <div className="invisible absolute right-0 top-0 opacity-0 transition-opacity group-hover:visible group-hover:opacity-100">
                <Button size="sm" onClick={() => handleCopyCode(children)}>
                  {showCopied ? "Copied" : "Copy"}
                </Button>
              </div>
            )}
          </div>
        );
      }}
    </Highlight>
  );
};

export { CodeBlock };
