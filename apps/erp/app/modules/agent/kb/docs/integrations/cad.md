# CAD

> Push CAD data from Onshape into Carbon.

## Onshape

Connect to **Onshape** over **OAuth** to bring CAD data into Carbon. No keys to paste.

  
  ### Authorize over OAuth

  Start the connection and Carbon opens an Onshape popup.
  
  
  ### Approve read access

  Approve access to your Onshape documents in the popup. The popup closes on its own and the Onshape card switches to Installed.
  
  
  ### Tokens stored

  Carbon stores the connection, the access and refresh tokens, and can then read from your Onshape documents when you push.
  

| Setting | What it controls |
| --- | --- |
| Connection | Established by OAuth — no keys to paste. Carbon stores the access and refresh tokens for you. |

Onshape only appears when its OAuth client is configured server-side (`ONSHAPE_CLIENT_ID`) — see
`docs/platform/self-hosting/environment-variables`.

Running your own instance? `docs/integrations/onshape-setup` registers the
Onshape application these credentials come from, and the extensions that put the panel below
inside Onshape.

## The Carbon panel in Onshape

Carbon also runs **inside Onshape** as an element right-panel app. You work in
Onshape and push to Carbon when something is ready — Carbon never pulls on its
own. Open a Part Studio or an assembly, click the Carbon icon in the right
panel, and sign in (a popup that closes itself).

The panel always shows status first: which parts of the current element are
already in Carbon, which match an existing item by part number, and which are
missing — before offering to push anything.

### Review before anything is written

Every push is two steps. Pressing **Push** shows a review of exactly what
Carbon would do — nothing is written yet:

- items that will be **created**, with the values they will get. Name,
  description, Buy/Make, default method, tracking type and unit of measure are
  editable here; the item ID and revision come from Onshape and are not.
- items that will be **linked** to an existing Carbon item by part number, or
  **updated** because Onshape changed, showing which Onshape-owned fields will
  be overwritten. These take no edits — Onshape owns them.
- for an assembly, each make method with the lines it gains, the lines a
  previous push wrote that will be replaced, and the lines you added by hand
  that are kept. A released method is called out: its lines will not be
  applied.
- for a release, every revision that will be created, the name and description
  of the change notice, and whether the new revisions become the default.

Untick a part, or a BOM item that would be created, to leave it out. **Push
to Carbon** applies the
review as shown; **Cancel** writes nothing. A review is held for 15 minutes and
then has to be opened again. Editable values apply only when an item is
created; after that the item's fields are owned by Onshape as described below.

### Custom fields

Open **Fields** in the panel to map Onshape properties (Vendor, Project,
Material, your company's custom properties) onto Carbon custom fields on the
part — creating the Carbon field on the spot if it doesn't exist. Each mapping
is either **owned by Onshape** (written on every push and locked in Carbon,
like the name) or a **default** (filled in when the item is created, editable
in the review, and yours in Carbon afterwards). Values appear in every review
before they're written; a property that doesn't fit its field (a date that
isn't a date) is called out and skipped, and properties with values that
aren't mapped yet are listed so the map can grow as you push.

### Push a part

Creates or updates the Carbon item for an Onshape part: part number becomes the
item ID, plus name, description, revision, the 3D model and a thumbnail.
Pushing again after a change updates the item; pushing an unchanged part does
nothing. Parts need a part number set in Onshape first.

Fields that Onshape owns — item ID, name, description, revision, thumbnail,
model — can't be edited in Carbon while the item is linked. The item page shows
an **Onshape card** with the link, **Open in Onshape**, and **Detach** to
release the fields back to Carbon.

### Push an assembly

Pushes the assembly and its whole bill of materials: every item in the BOM is
created if missing, and the BOM lands on the assembly's make methods —
subassemblies included. Pushes are a diff, not a rebuild: lines a previous push
wrote are replaced, lines you added by hand in Carbon are left alone, and
released methods are never touched.

### Push a release

The panel lists your document's Onshape releases. Pushing one:

- creates a Carbon **revision** of every released part and assembly, at the
  released revision letter, active and set as the default,
- applies each released assembly's BOM (as of the released version) to the new
  revision's method,
- records one **draft change notice** listing everything the release touched —
  releasing methods and production cutover stay in your hands,
- attaches models and thumbnails at the released version, and released
  drawings as PDF.

Pushing the same release twice creates nothing twice.

## Related

  - Items The part records CAD data attaches to.
  - Methods & sourcing How a part's bill of materials is built up.
  - Revisions What a revision is and how the default revision works.
