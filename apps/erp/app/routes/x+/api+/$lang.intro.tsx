import { getBrowserEnv, SUPABASE_ANON_KEY } from "@carbon/auth";
import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { Link } from "@remix-run/react";
import { LuTriangleAlert } from "react-icons/lu";
import { useUser } from "~/hooks";
import { CodeSnippet, Snippets, useSelectedLang } from "~/modules/api";
import { path } from "~/utils/path";

const { SUPABASE_URL } = getBrowserEnv();

export default function Route() {
  const { company } = useUser();
  const selectedLang = useSelectedLang();
  return (
    <>
      <h2 className="doc-heading">Authentication</h2>
      <div className="doc-section">
        <article className="code-column text-foreground">
          <p>CarbonOS uses API token authentication for the public API.</p>
          <p>
            First you'll need an <Link to={path.to.apiKeys}>API Key</Link>.
          </p>
          <p>Next save the API Key as an Environment Variable.</p>
          <article>
            <CodeSnippet
              selectedLang={selectedLang}
              snippet={Snippets.env({
                appUrl: window.location.origin,
                apiKey: "<your-api-key>",
                publicKey: SUPABASE_ANON_KEY,
                apiUrl: SUPABASE_URL,
                companyId: company?.id,
              })}
            />
          </article>
          <p>
            The API Key is provided via the <code>carbon-key</code> header when
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
                To initialize the Client Library SDK, you will need the
                environment variables you set up earlier.
              </p>
              <Alert variant="destructive">
                <LuTriangleAlert className="h-4 w-4 my-1" />
                <AlertTitle className="!my-0 font-bold text-base">
                  You should never expose the <code>carbon-key</code> in the
                  client
                </AlertTitle>
                <AlertDescription>
                  Your API key gives full access to your database. Never expose
                  it in a public-facing client.
                </AlertDescription>
              </Alert>

              <p>
                As with your API Key, we recommend setting your Client Key as an
                Environment Variable.
              </p>
              <p>Initialize the client as follows:</p>
              <div className="doc-section doc-section--client-libraries">
                <article className="code">
                  <CodeSnippet
                    selectedLang={selectedLang}
                    snippet={Snippets.init(SUPABASE_URL)}
                  />
                </article>
              </div>
              <p>
                You can now make requests to the API using the client. See the
                specific tables and views for more details.
              </p>
            </article>
          </div>
        </>
      ) : null}
    </>
  );
}
