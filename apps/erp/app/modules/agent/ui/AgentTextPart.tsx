import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents: Components = {
  // Open every link in a new tab.
  a: ({ node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
  // Wrap wide tables so only the TABLE scrolls sideways — otherwise it stretches
  // the whole message column and the entire chat panel scrolls horizontally.
  table: ({ node, ...props }) => (
    <div className="my-2 max-w-full overflow-x-auto">
      <table {...props} />
    </div>
  )
};

export function AgentTextPart({
  text,
  isUser
}: {
  text: string;
  isUser: boolean;
}) {
  if (isUser)
    return (
      <span className="whitespace-pre-wrap selection:text-foreground selection:bg-background!">
        {text}
      </span>
    );
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_pre]:text-xs [&_code]:text-xs">
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </Markdown>
    </div>
  );
}
