import { CodeBlock, useHydrated } from "@carbon/react";

interface CodeSnippetProps {
  selectedLang: "bash" | "js";
  snippet: {
    title?: string;
    bash: { language?: string; code: string };
    js?: { language?: string; code: string };
  };
}

const CodeSnippet = ({ selectedLang, snippet }: CodeSnippetProps) => {
  const hydrated = useHydrated();
  if (!hydrated || !snippet[selectedLang]) return null;
  return (
    <div className="codeblock-container">
      <h4>{snippet.title}</h4>
      <CodeBlock className={snippet[selectedLang]?.language}>
        {snippet[selectedLang]?.code}
      </CodeBlock>
    </div>
  );
};
export default CodeSnippet;
