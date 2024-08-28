import { getBrowserEnv, SUPABASE_ANON_PUBLIC } from "~/config/env";
import { CodeSnippet, Snippets, useSelectedLang } from "~/modules/api";

const { SUPABASE_API_URL } = getBrowserEnv();

export default function Route() {
  const selectedLang = useSelectedLang();
  return (
    <>
      <h2 className="doc-heading">Authentication</h2>
      <div className="doc-section">
        <article className="code-column text-foreground">
          <p>CarbonOS uses API token authentication for the public API.</p>
          <p>
            To begin, go to the Settings page and click on API Keys, and create
            a new API Key. Be sure to save this API Key in a secure location, as
            you will only be able to view it once upon creation.
          </p>
          <p>We recommend setting your API Key as an Environment Variable. </p>
          <p>
            The API Key is provided via the header <code>carbon-key</code> when
            making requests to the API.
          </p>
        </article>
      </div>
      {selectedLang == "js" ? (
        <>
          <h2 className="doc-heading">Client Library SDK</h2>
          <div className="doc-section">
            <article className="code-column text-foreground">
              <p>
                The easiest way to interact with the public API is via the
                JavaScript Client Library SDK.
              </p>
              <p>
                To initialize the Client Library SDK, you will need the{" "}
                <code>CLIENT_KEY</code> (shown below) in addition to your API
                Key.
              </p>
              <article>
                <CodeSnippet
                  selectedLang={selectedLang}
                  snippet={Snippets.authKey(
                    "CLIENT KEY",
                    "CLIENT_KEY",
                    SUPABASE_ANON_PUBLIC
                  )}
                />
              </article>
              <p>
                As with your API Key, we recommend setting your Client Key as an
                Environment Variable.
              </p>
              <p>Initialize the client as follows:</p>
              <div className="doc-section doc-section--client-libraries">
                <article className="code">
                  <CodeSnippet
                    selectedLang={selectedLang}
                    snippet={Snippets.init(SUPABASE_API_URL)}
                  />
                </article>
              </div>
            </article>
          </div>
        </>
      ) : null}
    </>
  );
}
