import { linkBlock } from "../../agent.blocks";

export function AgentBlockLink({ input }: { input: unknown }) {
  const parsed = linkBlock.safeParse(input);
  if (!parsed.success) return null;
  const { label, url } = parsed.data;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-primary underline underline-offset-2 hover:opacity-80"
    >
      {label}
    </a>
  );
}
