import { getBrowserEnv, SUPABASE_ANON_PUBLIC } from "@carbon/auth";
import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { Link } from "@remix-run/react";
import { LuAlertTriangle } from "react-icons/lu";
import { CodeSnippet, Snippets, useSelectedLang } from "~/modules/api";
import { path } from "~/utils/path";

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
            To begin, go to the Settings page and click on{" "}
            <Link to={path.to.apiKeys}>API Keys</Link>, and create a new API
            Key. Be sure to save this API Key in a secure location, as you will
            only be able to view it once upon creation.
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
                <code>PUBLIC_KEY</code> (shown below) in addition to your{" "}
                <code>carbon-key</code> API Key.
              </p>
              <Alert variant="destructive">
                <LuAlertTriangle className="h-4 w-4 my-1" />
                <AlertTitle className="!my-0 font-bold text-base">
                  You should never expose the <code>carbon-key</code> in the
                  client
                </AlertTitle>
                <AlertDescription>
                  Your API key gives full access to your database. Never expose
                  it in a public-facing client.
                </AlertDescription>
              </Alert>
              <article>
                <CodeSnippet
                  selectedLang={selectedLang}
                  snippet={Snippets.authKey(
                    "CLIENT KEY",
                    "PUBLIC_KEY",
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
