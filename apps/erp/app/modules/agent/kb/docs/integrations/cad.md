# CAD

> Sync CAD data from Onshape into Carbon.

## Onshape

Connect to **Onshape** over **OAuth** to bring CAD data into Carbon. No keys to paste.

  
  ### Authorize over OAuth

  Start the connection and Carbon opens an Onshape popup.
  
  
  ### Approve read access

  Approve read access to your Onshape documents in the popup.
  
  
  ### Tokens stored

  Carbon stores the connection, the access and refresh tokens, and can then pull from your Onshape documents.
  

| Setting | What it controls |
| --- | --- |
| Connection | Established by OAuth — no keys to paste. Carbon stores the access and refresh tokens for you. |

Onshape only appears when its OAuth client is configured server-side (`ONSHAPE_CLIENT_ID`) — see
`docs/platform/self-hosting/environment-variables`.

## Related

  - Items The part records CAD data attaches to.
  - Methods & sourcing How a part's bill of materials is built up.
