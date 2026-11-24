# JKPS Live Quorum Dashboard

## UGS Meeting Management integration

This project is integrated with the existing UGS Apps Script module, which manages `Ahli JKPS`, `Ahli JAPSU`, meeting settings, and invitation emails. Its deployed JSON API remains available at the normal `/exec` URL.

The new management portal is served from the same deployment at:

```
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?view=app
```

The management portal includes meeting settings and invitations, committee rosters, live attendance and **Pengesahan Edaran**. The portal and its management API use the signed-in UniSZA account and the `Ahli PPS` roster. The extension's `syncLiveAttendance` action uses its dedicated token. The extension receives only a success response. See [Google sign-in and access control](#google-sign-in-and-access-control) for the full sign-in flow and the difference between the deployment settings and the application checks.

The dashboard counts attendance against the official `Ahli JKPS` roster in the configured spreadsheet. The current roster has 35 eligible members, so quorum is 24 seats (`ceil(2 x 35 / 3)`). Each new meeting stores its eligible-member count and quorum threshold at creation, preserving historical results after later roster changes.

## Attendance matching

1. An eMeeting attendee whose normalized name matches an `Ahli JKPS` member is counted automatically.
2. An attendee who is a faculty representative is counted only when `JKPS Representation Rules` maps their faculty to the member seat they represent.
3. Unmatched attendees remain visible as `Review required`; they never inflate quorum.

This prevents two attendees from being counted for one JKPS seat and prevents an unapproved faculty representative from being counted automatically.

## Live sync architecture

Apps Script cannot reuse the UniSZA SSO session held in a browser. The included Chrome extension reads the authenticated eMeeting DataTable locally and sends its rows to the Apps Script web app every 30 seconds. Apps Script overwrites the selected meeting's live snapshot and recalculates the dashboard.

## Setup

1. Follow [GitHub and Apps Script releases](#github-and-apps-script-releases) to review and upload the project.
2. In the Apps Script editor, run `initializeApp` once and authorize it. This creates `JKPS Live Attendance` and `JKPS Representation Rules`.
3. Set a new random token of at least 24 characters in the Script Property `JKPS_LIVE_SYNC_TOKEN`. Put its matching value in a local copy of the Chrome extension's `config.js` and keep that copy out of Git. The application requires the property before accepting sync requests.
4. Deploy the web app as a UniSZA account with access to the official workbook. Use **Execute as me**. The extension posts to the shared deployment without an interactive Google login, so the manifest retains that transport. All human-facing routes check `Session.getActiveUser()` and the relevant roster inside Apps Script; see [Google sign-in and access control](#google-sign-in-and-access-control). Test with the intended administrator and a separate committee member before distributing links.
5. In Chrome, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `chrome-extension`.
6. Open the extension, enter the web-app `/exec` URL and the token, then keep the authenticated eMeeting attendance report open during the meeting.
7. Fill `JKPS Representation Rules` for faculties that may send a representative. Enter the faculty label exactly as it appears in eMeeting and the represented member's email from `Ahli JKPS`.

## Google sign-in and access control

The web app is deployed with **Execute as me** (`USER_DEPLOYING`) and **Anyone** access (`ANYONE_ANONYMOUS`). Those deployment settings let the app open for any visitor and let Drive, Sheets and Gmail calls run as the deployment owner. They are **not** the access-control layer. Every human-facing route checks the Google account the browser presents to Apps Script.

### What the app checks

| Surface | Who may use it | Check |
| --- | --- | --- |
| Admin portal `?view=app` | `Ahli PPS` | `requireMeetingAdmin_()` requires `Session.getActiveUser().getEmail()` to be in `Ahli PPS` |
| Circulation page `?view=edaran&id=...` | Active members of the paper's committee, or `Ahli PPS` | `circulationAccess_()`; drafts are admin-only |
| Voting | The selected delegate for a unit | `submitCirculationVote()` re-checks the live roster and the unit before recording the vote |
| Extension `syncLiveAttendance` | The extension token | `JKPS_LIVE_SYNC_TOKEN`; this is separate from Google login |

Only addresses matching `@unisza.edu.my` are accepted. Admin status comes from the `Ahli PPS` sheet, not a hard-coded list.

### Sign-in flow

1. Open the deployment URL shown under **Deploy → Manage deployments**. For a Workspace deployment it normally has the form `https://script.google.com/a/macros/unisza.edu.my/s/<deployment-id>/exec?...`. The `/a/unisza.edu.my/` form lets the browser present the Workspace identity to `Session.getActiveUser()`.
2. If the app cannot read a UniSZA email, it renders **Log masuk ke portal** with a **Pilih akaun Google UniSZA** button.
3. That button opens Google's account chooser with a `continue` URL back to the same page. Choose the `@unisza.edu.my` account.
4. The app reloads, reads `Session.getActiveUser().getEmail()`, and checks the relevant roster.
5. If the account is valid but not authorised, the app shows a role-specific message such as **Akses terhad** or **Halaman pengurusan dikhaskan untuk Urus Setia PPS**. Use the same account-chooser button to switch accounts.

`Session.getActiveUser()` can be empty when the viewer is signed out, signed in with a personal account, outside the UniSZA Workspace, or when a Workspace policy hides the active email. In that case the app cannot grant access. Test the actual `/exec` link with a representative's UniSZA account; a private browser window is the most reliable way to switch accounts.

### Operational notes

- Keep the deployment as **Execute as me** (`USER_DEPLOYING`). Changing it to `USER_ACCESSING` would require every viewer to authorise Drive, Sheets and Gmail and would break the extension's shared transport.
- Keep the official workbook **Restricted**. The app refuses to process requests when the workbook's general access is not private.
- The deployment owner must run `checkMeetingDriveAccess` once after a new Drive scope is added and approve the consent. If an existing grant is reused after a scope change, run `ScriptApp.invalidateAuth()` from a temporary editor function, then run `checkMeetingDriveAccess` again. Otherwise the portal shows **Kebenaran portal diperlukan**.
- Add or remove administrators in `Ahli PPS`; the next request reads the current roster. Do not replace the roster check with a hard-coded email list.
- The extension token is independent of Google login. Do not reuse a user's Google session for the extension, and keep `JKPS_LIVE_SYNC_TOKEN` out of Git.

## GitHub and Apps Script releases

### Sign in

Sign in to GitHub in the browser and use the UniSZA Google account that can edit the linked Apps Script project. Allow the [Apps Script API](https://script.google.com/home/usersettings) for that Google account.

```sh
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git --hostname github.com
gh repo view fathur6/ggn-meeting-management --json nameWithOwner,defaultBranchRef,viewerPermission
clasp login
clasp show-authorized-user
```

### Review and publish

Use a checkout based on the GitHub repository. If you received `ggn-edaran-management.bundle`, set `BUNDLE_PATH` to its absolute file path. The bundle uses a local source snapshot as its base. The commands below import the feature commits onto GitHub's history.

```sh
git clone https://github.com/fathur6/ggn-meeting-management.git
cd ggn-meeting-management
git switch -c edaran-management
git fetch "$BUNDLE_PATH" edaran-management
git rev-list --reverse 285ce70..FETCH_HEAD | git cherry-pick --stdin
```

Resolve any conflicts against the code in GitHub and review the resulting diff before pushing the branch with `git push -u origin edaran-management`. Use the reviewed source for deployment.

Run these commands from the repository root. The checked-in `.clasp.json` targets the existing Apps Script project and limits uploads to the `gas/` directory.

```sh
node --test tests/circulation.test.cjs
clasp status
clasp list-deployments
clasp list-versions
```

Before uploading, take a source snapshot of the current Apps Script project in a temporary folder. Resolve any online editor changes into Git before uploading. In Apps Script, record the existing web app's deployment ID and live version. Choose the entry that matches the `/exec` URL in use.

```sh
review_dir=$(mktemp -d)
script_id=$(node -p "require('./.clasp.json').scriptId")
(cd "$review_dir" && clasp clone-script "$script_id" --rootDir gas)
diff -ru "$review_dir/gas" gas
```

After reviewing the differences, use `clasp push` to update the script project. When the project requests new permissions, the owner of the existing deployment must open the Apps Script editor, run `checkMeetingDriveAccess`, and grant the requested access. If a new scope was added but Apps Script keeps reusing the old grant, run `ScriptApp.invalidateAuth()` once from a temporary editor function and then run `checkMeetingDriveAccess` again. A successful run confirms that the account can verify the official workbook's sharing settings and open it. Test the uploaded code with **Deploy → Test deployments**. When it passes, create a version and update the existing deployment. Use the version number returned by `create-version` and the web app's deployment ID recorded earlier.

```sh
clasp push
clasp create-version "Pengesahan Edaran"
clasp update-deployment "$DEPLOYMENT_ID" --versionNumber "$VERSION_NUMBER"
clasp list-deployments
```

Open the existing `/exec?view=app` link and follow [Deployment verification](#deployment-verification). To roll back the web app, update the same deployment to the prior version number.

## Annual attendance reporting

The dashboard generates a calendar-year attendance report. It resets naturally for a new year because the report filters meetings by year; no manual counter reset is needed.

`JKPS Membership History` records each appointment period:

| Member Email | Member Name | Membership Start | Membership End | Active |
| --- | --- | --- | --- | --- |
| member@unisza.edu.my | Dr. Example Member | 2026-01-01 |  | Yes |

Run `seedCurrentMemberships('YYYY-MM-DD')` once only after choosing the real effective date for the current roster. It adds current roster members who do not already have a history row.

Each new `JKPS Live Meetings` record automatically creates `Called` rows in `JKPS Meeting Calls` for the roster at that time. The annual report counts a member only when both conditions apply:

1. Their membership period covers the meeting date.
2. A `Called` record exists for that meeting and member.

When a member joins after a meeting has already been created, add their membership history row and add a `Called` row for that meeting only if they were formally invited. When a member leaves, add their `Membership End` date instead of deleting their history. This preserves past annual reports.

## Member appointment lifecycle

Running `initializeMemberLifecycleColumns()` adds these columns to both `Ahli JKPS` and `Ahli JAPSU`, after the existing email column:

| Tarikh Lantikan | Tarikh Tamat | Status Keahlian |
| --- | --- | --- |
| 2026-01-01 | *(blank while active)* | Aktif |

Use ISO dates (`YYYY-MM-DD`). New members should be created with `Status Keahlian: Aktif` and a real `Tarikh Lantikan`. To retain an outgoing member, call the API action `archiveMember` or set `Tarikh Tamat` and `Status Keahlian: Lepas`; do not delete the row.

JKPS quorum, meeting calls, and annual attendance exclude `Lepas` members from new meetings. Historical attendance remains intact. `seedCurrentMemberships()` now uses each JKPS member's `Tarikh Lantikan` when populating the annual-report history.

## Portal administrators

Portal access is the `Ahli PPS` tab of the official workbook: an active row whose
email is `@unisza.edu.my` may open the management pages. The `Jawatan` column holds
the role code shown in the portal:

| Role | Meaning |
| --- | --- |
| `TDA_PPS` | Timbalan Dekan (Akademik), PPS |
| `PPA` | Penyelaras Program Akademik, PPS |
| `PJK` | Penyelaras Jaminan Kualiti, PPS |
| `PP` | Pegawai Tadbir (Akademik), PPS |

**Committee Members → Committee: Admin** opens *Pentadbir sistem*, the roster of
administrators. Only the TDA PPS may add, edit or withdraw an administrator; other
administrators see the list read-only. Withdrawing access archives the row
(`Tarikh Tamat` = today, `Status Keahlian` = `Lepas`) instead of deleting it, and an
account cannot withdraw its own access.

Rows whose `Jawatan` is still a free-text title (for example `Dekan`) are displayed
as they are. Editing such a row offers **Kekalkan: \<title\>** so saving does not
overwrite the title; choose a role code only when the post really is one of the
three roles above.

Two lists live in `gas/MeetingAccess.js`: `MEETING_TDA_PPS_EMAILS` (delete papers,
appoint administrators) and `MEETING_SUPER_ADMIN_EMAILS` (also change the voting
representatives of an open paper). Every reserved action is checked on the server,
so hiding a button is convenience only:

- **Padam** on *Senarai kertas edaran* (`deleteCirculationPaper`) — removes a paper
  of any status, including a published one, together with its vote rows. The PDF in
  Google Drive is left untouched. Other administrators keep the draft-only `Buang`.
- **Tambah pentadbir / Edit / Buang** on *Pentadbir sistem*.


## Pengesahan Edaran

1. In the official spreadsheet, set General access to **Restricted** and review direct shares. Give edit access only to trusted PPS staff because the workbook contains `Ahli PPS`, authorization rosters and votes. The application checks the workbook's general sharing setting before processing requests.
2. As a member of **Ahli PPS**, open the deployed web app with `?view=app` and choose **Pengesahan Edaran → Kertas baharu**.
3. Choose JKPS or JAPSU. Enter the circulation reference, proposal title, committee information, matters for consideration, the Google Drive or OneDrive/SharePoint document link and the closing time in Malaysia. Confirm the voting representatives from the live **Ahli JKPS** roster and the selected committee's roster (the committee row wins when a person is in both). Each selected faculty, institute or approved centre gets one vote even when multiple delegates are approved. Centres outside the default faculty/institute rule are listed in `CIRCULATION_EXTRA_UNITS` in `CirculationService.js`.
4. Save the draft and choose **Terbitkan**. Google Drive controls who can open the PDF. A directly shared file or a reviewer-readable link both work. Check that the intended readers can open it. Publishing requires a reference, summary, valid PDF, a future deadline, and at least one unit. The draft becomes read-only after publication. The admin can close voting early, and the deadline stops further responses. The admin list also provides **Muat turun PDF** for a timestamped evidence report of the current tally, **Wakil & undian** to review the seat holders and decisions, and **Padam** for the TDA PPS only, which removes a paper of any status together with its votes and writes an audit entry.
5. Copy the generated link for email or WhatsApp. It opens a standalone member page for this paper. A representative who needs to sign in or switch accounts can select **Pilih akaun Google UniSZA** to use Google's account chooser and return to the same paper; see [Google sign-in and access control](#google-sign-in-and-access-control). The relevant committee's active roster can view the circulation and tally. The chosen representatives can vote for their unit. A person's current membership and unit are checked again when they vote. Admin authorization comes from `Ahli PPS`, including when an admin is also a committee member.
6. The application creates **Pengesahan Edaran** in the official spreadsheet on the first draft save. The one tab holds `KERTAS` and `UNDI` records. It retains the draft revision, published representatives, vote, the reason/opinion for an objection or the optional amendment suggestion, verified voter email, timestamps and email status. The member page returns unit-level results and the viewer's own voting options. It keeps individual voting records in the spreadsheet.

## Paper documents (Google Drive and OneDrive)

The *Pautan dokumen* field accepts two link types, checked by `circulationPdf_`:

| Link | Behaviour |
| --- | --- |
| `drive.google.com/file/d/…` | Verified with `DriveApp` (must be a PDF) and previewed inside the portal |
| `*.sharepoint.com`, `1drv.ms`, `onedrive.live.com`, `onedrive.com` | Opened in a new tab so members can comment and suggest changes in Word Online |

A Microsoft 365 link cannot be verified server-side: sharing scope is set in
SharePoint/OneDrive and the Apps Script runs as the deployment owner. Only the host
is validated, so a paper can never point voters at an unrelated site, and the link
is stored exactly as supplied. The committee must share the document with the
selected members before the paper is published.

Only `https` links are accepted. A OneDrive/SharePoint paper still requires the
same review fields (reference, points for consideration, deadline) before it can be
published, and the vote evidence PDF is generated by the app either way.

## One vote per faculty, representatives and corrections

Candidates come from the **Ahli JKPS** tab plus the paper's own committee tab
(`Ahli JAPSU`/`Ahli JKPS` in the same workbook), so a faculty can be represented by
its JKPS member as well as its committee delegate. Viewing a paper stays with the
paper's committee; a JKPS member who is seated on the paper can open it and vote.

A voting unit is a faculty, institute or centre. Several representatives may hold
the seat and **any of them may cast the unit's vote**. The tally counts one vote per
unit, never one per person.

**The Dean outranks the representatives.** A Dean may vote after a representative:
their decision becomes the unit's decision and the representative's vote is kept in
the record as superseded. Once the Dean has voted, representatives can no longer
change that unit.

**Wakil & undian** on a published paper opens the panel that shows, per unit, who
holds the seat, how the unit voted, and who recorded it.

The ballot asks for text that matches the decision: an objection requires
**Sebab/ulasan bantahan**, while a supporting vote may add an optional **Cadangan
Pindaan (Jika ada)**. Both are kept with the vote and shown in the evidence PDF and
in the *Wakil & undian* panel.

- **Change representatives** — reserved to the PPS super administrators
  (`MEETING_SUPER_ADMIN_EMAILS`: TDA, PPA, PJK and PP), while the poll is open.
  They may add a representative to a unit that has already voted, but the
  representative who recorded the vote must stay seated.
- **Override a decision** — the TDA PPS only, while the poll is open, and only with
  a written reason. The representative's original record is replaced on the row
  (`updatedBy`/`updatedAt`) and every change is appended to **Log Pengesahan
  Edaran**, so the evidence PDF shows who changed the faculty's vote and when.

Both checks run on the server, so hiding a control is convenience only.


### Deployment verification

Run the local authorization and voting checks with `node --test tests/circulation.test.cjs`.

- With an `Ahli PPS` account, verify existing meeting and roster pages and save a test draft in the circulation tab.
- As a plain committee member, verify the administration page and management API reject access. Check that a draft and another committee's circulation are inaccessible.
- Publish a test paper with a PDF shared with the intended readers. Verify the PDF, support and objection paths, required objection reason, receipt, unit tally, repeated submission and voting cutoff.
- Download the vote evidence PDF and verify that it includes the current tally, every unit, the recorded vote or **Belum mengundi**, and a timestamped filename.
- Create a temporary draft, click **Buang**, and confirm the row disappears. As a non-TDA account, confirm **Padam** is absent and the delete RPC is rejected; as the TDA PPS, delete a published test paper and check the **Log Pengesahan Edaran** entry.
- Verify the separately configured eMeeting sync extension still records attendance. Use a prior version of the deployment as the rollback point.

A deployment account from outside UniSZA or a Workspace policy that hides the active email will cause sign-in checks to fail. Test the actual `/exec` link with a representative's Google Workspace account. [Apps Script session documentation](https://developers.google.com/apps-script/reference/base/session)
