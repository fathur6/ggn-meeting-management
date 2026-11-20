# JKPS Live Quorum Dashboard

## UGS Meeting Management integration

This project is integrated with the existing UGS Apps Script module, which manages `Ahli JKPS`, `Ahli JAPSU`, meeting settings, and invitation emails. Its deployed JSON API remains available at the normal `/exec` URL.

The new management portal is served from the same deployment at:

```
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?view=app
```

The management portal includes meeting settings and invitations, committee rosters, live attendance and **Pengesahan Edaran**. The portal and its management API use the signed-in UniSZA account and the `Ahli PPS` roster. The extension's `syncLiveAttendance` action uses its dedicated token. The extension receives only a success response.

The dashboard counts attendance against the official `Ahli JKPS` roster in the configured spreadsheet. The current roster has 35 eligible members, so quorum is 24 seats (`ceil(2 x 35 / 3)`). Each new meeting stores its eligible-member count and quorum threshold at creation, preserving historical results after later roster changes.

## Attendance matching

1. An eMeeting attendee whose normalized name matches an `Ahli JKPS` member is counted automatically.
2. An attendee who is a faculty representative is counted only when `JKPS Representation Rules` maps their faculty to the member seat they represent.
3. Unmatched attendees remain visible as `Review required`; they never inflate quorum.

This prevents two attendees from being counted for one JKPS seat and prevents an unapproved faculty representative from being counted automatically.

## Live sync architecture

Apps Script cannot reuse the UniSZA SSO session held in a browser. The included Chrome extension reads the authenticated eMeeting DataTable locally and sends its rows to the Apps Script web app every 30 seconds. Apps Script overwrites the selected meeting's live snapshot and recalculates the dashboard.

## Setup

1. Review the source, then run `clasp push` to upload it to the supplied Apps Script project.
2. In the Apps Script editor, run `initializeApp` once and authorize it. This creates `JKPS Live Attendance` and `JKPS Representation Rules`.
3. Set a new random token of at least 24 characters in the Script Property `JKPS_LIVE_SYNC_TOKEN`. Put its matching value in a local copy of the Chrome extension's `config.js` and keep that copy out of Git. The application requires the property before accepting sync requests.
4. Deploy the web app as a UniSZA account with access to the official workbook. Use **Execute as me**. The extension posts to the shared deployment without an interactive Google login, so the manifest retains that transport. All human-facing routes and management methods check a verified UniSZA session inside Apps Script. Test with the intended administrator and a separate committee member before distributing links.
5. In Chrome, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `chrome-extension`.
6. Open the extension, enter the web-app `/exec` URL and the token, then keep the authenticated eMeeting attendance report open during the meeting.
7. Fill `JKPS Representation Rules` for faculties that may send a representative. Enter the faculty label exactly as it appears in eMeeting and the represented member's email from `Ahli JKPS`.

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


## Pengesahan Edaran

1. In the official spreadsheet, set General access to **Restricted** and review direct shares. Give edit access only to trusted PPS staff because the workbook contains `Ahli PPS`, authorization rosters and votes. The application checks the workbook's general sharing setting before processing requests.
2. As a member of **Ahli PPS**, open the deployed web app with `?view=app` and choose **Pengesahan Edaran → Kertas baharu**.
3. Choose JKPS or JAPSU. Enter the circulation reference, proposal title, committee information, matters for consideration, Google Drive PDF link and the closing time in Malaysia. Confirm the voting representatives against the selected committee's live roster. Each selected faculty or institute gets one vote even when multiple delegates are approved.
4. Save the draft and choose **Terbitkan**. The secretariat must set the PDF's General access to **Restricted**, share it with the intended committee audience, and check it with a representative account. Google Drive independently controls file access. Publishing requires a reference, summary, valid PDF, a future deadline, and at least one unit. The draft becomes read-only after publication. The admin can close voting early, and the deadline stops further responses.
5. Copy the generated link for email or WhatsApp. It opens a standalone member page for this paper. The relevant committee's active roster can view the circulation and tally. The chosen representatives can vote for their unit. A person's current membership and unit are checked again when they vote. Admin authorization comes from `Ahli PPS`, including when an admin is also a committee member.
6. The application creates **Pengesahan Edaran** in the official spreadsheet on the first draft save. The one tab holds `KERTAS` and `UNDI` records. It retains the draft revision, published representatives, vote, reason for objection, verified voter email, timestamps and email status. The member page returns unit-level results and the viewer's own voting options. It keeps individual voting records in the spreadsheet.

### Deployment verification

- With an `Ahli PPS` account, verify existing meeting and roster pages and save a test draft in the circulation tab.
- As a plain committee member, verify the administration page and management API reject access. Check that a draft and another committee's circulation are inaccessible.
- Publish a test paper whose PDF is restricted to the appropriate Google accounts. Verify the PDF, support and objection paths, required objection reason, receipt, unit tally, repeated submission and voting cutoff.
- Verify the separately configured eMeeting sync extension still records attendance. Use a prior version of the deployment as the rollback point.

A deployment account from outside UniSZA or a Workspace policy that hides the active email will cause sign-in checks to fail. Test the actual `/exec` link with a representative's Google Workspace account. [Apps Script session documentation](https://developers.google.com/apps-script/reference/base/session)
