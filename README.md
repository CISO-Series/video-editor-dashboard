# Video Editor Dashboard

Joe's dashboard for premium videos. It lists every upcoming **Premium** episode from the CISO Series Podcast and Defense in Depth ClickUp lists, shows the sponsor, raw footage link and video notes, and lets him turn in the finished zip, thumbnail and a note straight into the main episode task.

**Live link:** https://script.google.com/macros/s/AKfycbykYqzahKSgQHy2-R8TzThS515U0M6OfbkDcbaSeS-P5Z66sjdbgvoti-e2WXsZGstacA/exec
(Google sign-in; only emails in the `ALLOWED_EMAILS` Script Property get in.)

## How it decides what to show

- **Which episodes:** tasks in lists `82137309` (CSP) and `164147770` (DID) with Sponsorship - Status = Premium and an air date of today or later. Sponsors in `CFG.EXCLUDED_SPONSORS` (currently Horizon3) are left out.
- **Air date:** the `(MM-DD-YY)` in the task name, falling back to the due date.
- **Due back:** 2 days (48 hours) before the air date.
- **Ready to edit:** a link is present in Video - RAW.
- **Urgent (red banner):** not turned in and the due-back date is today or past.
- **Do soon (orange tag):** not turned in and due back in 1–2 days.
- **Turned in:** Video - Finished File has a file, or Video - Status is In Review / Approved / Done.
- **Fallback info:** if the episode task lacks Video - RAW or notes, the linked task in the Premium Videos list (`901113502252`) is read instead. Nothing is ever written there.

## What "Send to ClickUp" does (main episode task only)

1. The browser uploads the zip and thumbnail directly to ClickUp (Apps Script can't carry files that large).
2. The server puts them in **Video - Finished File** and **Thumbnail**, sets **Video - Status** to **In Review**, and posts a comment with Joe's note.
3. If any step fails, Joe gets step-by-step instructions for adding the files to the right custom fields by hand.

The file-into-custom-field step has not yet been tested against ClickUp with a real zip.

## Files

- `apps-script/`: the deployed web app (`Code.gs`, `Auth.gs`, `Index.html`, `appsscript.json`), managed with clasp.
- `preview/`: local preview with a snapshot of real data and no ClickUp writes. Run `python3 preview/serve.py`, then open http://localhost:8120 (add `?today=YYYY-MM-DD` to preview other dates).

## Script Properties

`CLICKUP_TOKEN` (Josh), `JOE_CLICKUP_TOKEN` (once Joe sends his; writes then come from Joe), `ALLOWED_EMAILS`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_REDIRECT_URI` (the exact `/exec` link above).

## Updating

```bash
cd apps-script
npx @google/clasp push --force
npx @google/clasp deploy -i AKfycbykYqzahKSgQHy2-R8TzThS515U0M6OfbkDcbaSeS-P5Z66sjdbgvoti-e2WXsZGstacA -d "what changed"
```

Push alone doesn't change the live link; the `deploy -i` step does.

**Never write a literal double slash (as in `https:` followed by `//`) inside a string in `Index.html`'s script.** Apps Script strips `//` comments from served pages and also cuts URLs at their `//`, which silently breaks the whole page.
