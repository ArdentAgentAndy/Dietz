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

## 7. Push notifications (optional)

Three time-driven triggers, all reading the same merged Canvas+Notion data
(a Canvas item linked to a Notion task shows once as that task, an
unlinked one is prefixed `[C]` since it only exists in Canvas, not yet
tracked in Calendar; anything done — a Notion task's `mark`, or an
unlinked Canvas event flagged completed in the Canvas tab, synced via the
`CanvasFlags` table — is excluded):

- **`sendMorningDigest`, 6am** — the full picture: Due Today, Due
  Tomorrow, Urgent. Title `Daily Digest`; body's first line is the counts
  (e.g. `2 today, 1 tomorrow, 0 urgent`), followed by the section details.
- **`sendEveningDigest`, 10pm** — just what's still due today and not
  done, recomputed fresh (so anything marked done since morning drops
  off). Title `Remaining Today`. Always sends, even when nothing's left,
  so a quiet night still confirms the check ran.
- **`sendDueSoonReminders`, every 15 min** — for anything due today with
  a specific time (an all-day item has nothing to count down from, so
  it's skipped), not done, and due in the next 2 hours but not yet
  overdue, sends one reminder titled `Due Soon` and remembers it (in
  Script Properties, reset daily) so it never repeats that day.

All three open straight to the Calendar page on tap (the merged view
they're built from). Each needs `CANVAS_CALENDAR_ID` and the Notion
properties (see below) already configured, since they reuse the same
data those features read; either can be left unset and that part is just
empty.

This goes out as a real push notification, not email — raw Web Push needs
VAPID signing and payload encryption that Apps Script can't do natively,
so [OneSignal](https://onesignal.com) (free tier) sits in the middle:
`oneSignalSend_` in `Code.gs` just POSTs to OneSignal's REST API, and
OneSignal does the actual encrypted send to your phone/browser.

### 7a. Create the OneSignal app

1. Sign up at onesignal.com, click **New App/Website**, name it, choose
   **Web Push** as the platform.
2. Integration type: pick **Custom Code** (not "Typical Site" or
   "WordPress") — that's the option for bringing your own service worker
   and your own `init()` call, which `js/push.js`/`sw.js` already do.
3. Site setup: Site URL is your GitHub Pages **origin** (e.g.
   `https://<you>.github.io`, not the `/Tracker` subpath — Web Push cares
   about the domain, not the path).
4. From **Settings → Keys & IDs**: the **App ID** is shown directly on
   that page. For the **REST API Key**, click **Add Key** — OneSignal
   doesn't display existing key values, so the secret (starts with
   `os_v2_app_...`) is shown only once, right after you create it. Copy it
   immediately.

### 7b. Configure the backend

In the Apps Script editor: **Project Settings → Script Properties**, add:

- `ONESIGNAL_APP_ID` — the App ID from 7a.
- `ONESIGNAL_REST_API_KEY` — the REST API Key from 7a. This is the secret
  half (it can send pushes to anyone subscribed) — never commit it; it
  only lives in Script Properties, same as `TOKEN`.

### 7c. Configure the frontend

Open `js/push.js` and replace `ONESIGNAL_APP_ID` with the same App ID from
7a — this half is **not** secret (same trust level as a public client
key), so it's fine to commit. `clasp push`/deploy isn't needed for this
file since it's served as a static asset, not part of the Apps Script
project.

Then, on your phone/browser: open the app → **Settings** → **Enable
notifications**, and allow the permission prompt. On iOS this only works
if the app was added to the Home Screen first (Share → Add to Home
Screen) — Safari doesn't support Web Push for an ordinary browser tab.

### 7d. Install the triggers

1. In the Apps Script editor, select **`installNotificationTriggers`** from
   the function dropdown (top toolbar) and click **Run**. The first run
   prompts you to authorize managing triggers and making external requests
   — allow it. This installs all three triggers; you only need to run it
   once (re-running is safe and just replaces the existing ones, e.g.
   after changing a schedule below).
2. To change a schedule, edit the `.atHour(6)` / `.atHour(22)` /
   `.everyMinutes(15)` calls in `installNotificationTriggers`, `clasp
   push`, then re-run the function once as in step 1.

To test without waiting, select **`sendMorningDigest`**, **`sendEveningDigest`**,
or **`sendDueSoonReminders`** directly in the dropdown and click Run — each
sends immediately (once you've enabled notifications in Settings per 7c,
so there's a subscribed device to send to).

## Redeploying after a code change

Editing `Code.gs` locally and running `clasp push` updates the script, but
an existing deployment keeps running the version it was deployed with. To
ship a change: **Deploy → Manage deployments → edit (pencil) → Version: New
version → Deploy**. The URL stays the same.
