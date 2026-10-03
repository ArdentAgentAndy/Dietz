# Backend setup

The backend is a Google Apps Script web app bound to a Google Sheet — the
Sheet is the database, one tab per table (created automatically on first
use). This only needs to be done once.

## 1. Create the Sheet

Create a new Google Sheet (sheets.new). You don't need to add any tabs or
headers yourself — the script creates each table's tab the first time it's
written to.

## 2. Install clasp and log in

```sh
npm install -g @google/clasp
clasp login
```

## 3. Bind a script to the Sheet

Open the Sheet, go to **Extensions → Apps Script**. This creates a bound
script — copy its **Script ID** from Project Settings (the gear icon).

Back in this repo:

```sh
cd apps-script
clasp clone <SCRIPT_ID>
```

This writes `.clasp.json` (git-ignored — it's fine that it's local-only).
Clasp will pull down a blank `Code.js`; delete it, since `Code.gs` and
`appsscript.json` in this folder are the real source.

```sh
clasp push
```

## 4. Set the shared secret

In the Apps Script editor: **Project Settings → Script Properties → Add
script property**.

- Property: `TOKEN`
- Value: any long random string (e.g. generate one with
  `openssl rand -hex 24`)

This token is the only thing standing between "anyone with the URL" and your
data, so keep it as long as a password. **Never commit it** — it only lives
in Script Properties and, later, in the frontend's `localStorage`.

## 5. Deploy as a web app

**Deploy → New deployment**:
- Type: **Web app**
- Execute as: **Me**
- Who has access: **Anyone**

("Anyone" is required so the static frontend can call it without a Google
sign-in prompt — the token is what actually gates access.)

Copy the deployment URL. It ends in `/exec`.

## 6. Connect the frontend

Open the app → **Settings** → paste the deployment URL into **Web app URL**
and the value from step 4 into **Token**. The sync status indicator in the
top nav should flip to "Synced" within a few seconds.

## 7. Daily digest email (optional)

Sends one email a day (6am script time) with three sections — Due Today,
Due Tomorrow, Urgent — combining Canvas deadlines with Notion Calendar
tasks (its own Date property, independent of any Canvas deadline) into one
deduplicated list per day: a Canvas item linked to a Notion task shows once
as that task, an unlinked one is prefixed `[C]` since it only exists in
Canvas, not yet tracked in Calendar. Subject line is
`Dietz - Daily Digest: N due today, N due tomorrow, N urgent`. Needs
`CANVAS_CALENDAR_ID` and the Notion properties (see below) already
configured, since it reuses the same data those features read; either can
be left unset and that section is just empty.

1. *(Optional)* **Project Settings → Script Properties → Add script
   property** — `DIGEST_EMAIL`, value: the address to send to. Skip this to
   just send to the Google account this script is running as.
2. In the Apps Script editor, select **`createDailyDigestTrigger`** from the
   function dropdown (top toolbar) and click **Run**. The first run prompts
   you to authorize sending email and managing triggers — allow it. This
   installs the daily trigger; you only need to run it once (re-running is
   safe and just replaces the existing trigger, e.g. after changing the
   hour in that function).
3. To change the send time, edit the `.atHour(6)` call in
   `createDailyDigestTrigger`, `clasp push`, then re-run the function once
   as in step 2.

To test without waiting for 6am, select **`sendDailyDigest`** itself in the
dropdown and click Run — it sends immediately.

## Redeploying after a code change

Editing `Code.gs` locally and running `clasp push` updates the script, but
an existing deployment keeps running the version it was deployed with. To
ship a change: **Deploy → Manage deployments → edit (pencil) → Version: New
version → Deploy**. The URL stays the same.
