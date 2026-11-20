# JKPS Live Quorum Dashboard

## UGS Meeting Management integration

This project is integrated with the existing UGS Apps Script module, which manages `Ahli JKPS`, `Ahli JAPSU`, meeting settings, and invitation emails. Its deployed JSON API remains available at the normal `/exec` URL.

The new management portal is served from the same deployment at:

```
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?view=app
```

It provides three pages:

1. **Overview**: current JKPS/JAPSU member counts and active meeting references.
2. **JKPS Quorum**: live eMeeting attendance, quorum, and annual attendance reports.
3. **JAPSU Members**: current `Ahli JAPSU` roster.

The existing email and member-management API remains unchanged. `JAPSU` live attendance/quorum is deliberately not enabled because no JAPSU eMeeting attendance report or quorum policy has been supplied.

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
3. Create a high-entropy token and run `setLiveSyncToken('your-token')` in the Apps Script editor. Do not put this token in source control.
4. Deploy the script as a web app. Use the `/exec` URL and restrict dashboard access to UniSZA users.
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
