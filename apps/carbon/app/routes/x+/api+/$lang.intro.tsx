import { getBrowserEnv } from "~/config/env";
import { CodeSnippet, Snippets, useSelectedLang } from "~/modules/api";

const { SUPABASE_API_URL } = getBrowserEnv();

export default function Route() {
  const selectedLang = useSelectedLang();
  return (
    <div className="doc-section doc-section--client-libraries">
      <article className="code">
        <CodeSnippet
          selectedLang={selectedLang}
          snippet={Snippets.init(SUPABASE_API_URL)}
        />
      </article>
    </div>
  );
}
