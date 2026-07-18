import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Open every link in a new tab.
const markdownComponents: Components = {
  a: ({ node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  )
};

export function AgentTextPart({
  text,
  isUser
}: {
  text: string;
  isUser: boolean;
}) {
  if (isUser) return <span className="whitespace-pre-wrap">{text}</span>;
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_pre]:text-xs [&_code]:text-xs">
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </Markdown>
    </div>
  );
}
