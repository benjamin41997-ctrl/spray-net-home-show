# Internal consultation calendar

The default scheduler is this application's private calendar. **Microsoft/Entra access is not required.** Visitors save their name/phone, choose an available consultation time, and provide its project address. The backend checks availability and confirms the D1 appointment before unlocking photos and the visualizer. A lead, preferred time, copied private link, or browser flag cannot unlock them.

Appointments begin **Monday, October 26, 2026** (BOOKING_START_DATE=2026-10-26). Hours are **every day, 8:00 am–7:00 pm Eastern**. Visits last **90 minutes**, with a **30-minute travel buffer** between appointments. The latest visit starts **5:30 pm** and ends at 7:00 pm; final travel can extend afterward. Staff blocks and other appointments reduce availability. Times use America/New_York, including daylight-saving changes.

The existing website/lead API are documented in [DEPLOYMENT.md](DEPLOYMENT.md). This new internal-calendar source must be migrated/deployed before it can be described as live. The image-provider key is privately configured with user approval; no end-to-end paid image/output-quality test is claimed here.

## Staff scheduling

Open admin.html on the connected site and enter the separate staff access key. The page is publicly reachable, but records require the ADMIN_TOKEN bearer. This key can export leads and cancel consultations; limit it to authorized staff.

The password key stays only in tab memory, never a URL, browser storage, public source, analytics, or console output. Signing out, closing the page, or 10 minutes without activity clears contacts/token and aborts outstanding requests. Authentication/connection failures clear the display. Keep any separately supplied local staff-access file private, outside Git, and never upload/publish it.

Staff can:

- View upcoming consultations with contact details, address, and Eastern times.
- Add blocked time for existing Outlook appointments, days off, travel, or other commitments.
- Remove blocks or explicitly cancel appointments; cancellation relocks that lead's studio.
- Download the private leads CSV for the approved CRM import process.
- Download a consultation .ics file with **30 minutes added after the visit** for manual Outlook import.

A block may start up to 24 hours ago to cover today, must end in the future within 180 days, and can last at most 30 days. Notes are staff-only, up to 500 characters. Blocks conflicting with existing app appointments are rejected. Enter Eastern times even when your device uses another timezone. The UI rejects spring-forward gaps and repeated fall-back times instead of silently choosing an hour.

## Outlook is manual

This scheduler does **not** read Outlook, send invitations, or synchronize changes/cancellations. Add actual outside commitments as staff blocks before offering visitor appointments, and maintain them when the outside calendar changes. The user's Outlook placeholders named “BLOCK” intentionally remain bookable; do not import them as unavailable time.

Visitors can download a 90-minute .ics appointment; staff can download it with 30 minutes reserved for travel. Import manually and inspect the resulting duration. Downloading does not insert it into Outlook or notify anyone. Cancelling here does not remove the imported Outlook event, and editing Outlook does not change this app. Update both when needed and avoid repeated imports.

No project-link email/text is sent. Visitors retain their private project QR/link themselves. An optional email is a contact field; internal mode does not send it an invitation.

## Configuration and protected routes

Use BOOKING_PROVIDER=internal. Ordinary server settings:

| Setting | Intended value |
| --- | --- |
| BOOKING_START_DATE | 2026-10-26 |
| BOOKING_DURATION_MINUTES | 90 |
| BOOKING_BUFFER_MINUTES | 30 |
| BOOKING_WORK_START / BOOKING_WORK_END | 08:00 / 19:00 |
| BOOKING_WORK_DAYS | 0,1,2,3,4,5,6 |
| BOOKING_HORIZON_DAYS | Future booking window; review for the show. |
| BOOKING_MIN_NOTICE_MINUTES | Minimum notice before an appointment. |

The API is authoritative. Staff requests use trusted configured apiBase:

| Route | Access and purpose |
| --- | --- |
| GET /api/leads/:id/consultation/slots | Lead bearer; available choices without other customers' details. |
| POST /api/leads/:id/consultation/book | Lead bearer, chosen start, required address, optional email, stable request key; confirms in D1 after checking conflicts. |
| GET /api/admin/bookings | Admin bearer; upcoming consultations and blocks. |
| POST /api/admin/blocks | Admin bearer; UTC start/end and optional note. |
| DELETE /api/admin/blocks/:id | Admin bearer; removes a block. |
| POST /api/admin/bookings/:leadId/cancel | Admin bearer; cancels and relocks studio. |
| GET /api/admin/leads.csv | Admin bearer; private export. |

Retain the same booking key after connection failure. Recheck that request before selecting another time. Server locks/conflict checks serialize this app's bookings, but cannot see outside calendars. Cancelled app slots become eligible under normal availability rules.

## Acceptance checks

1. Record recovery state, apply matching migration, and deploy current source without losing existing leads/media.
2. Add representative outside blocks; check all seven days, 8–7 Eastern, latest start 5:30, 90-minute visits, 30-minute gaps, and overnight/daylight-saving behavior.
3. Use synthetic leads to test name/phone-only capture, repeated/competing booking requests, and lost-response recovery.
4. Confirm unbooked leads cannot upload/fetch project media or render, confirmed bookings unlock, and staff cancellation relocks.
5. Test private CSV, visitor/staff calendar files, logout/idle/auth/network failures, and real phone/tablet layouts. Do not use customer data for UI previews.
6. Verify real rendering separately before promising quality. A private key/configured allowance does not prove successful generation.

## Optional future Outlook/Graph integration

Graph is optional and not needed for internal scheduling. Microsoft authorization is not configured; the internal calendar avoids that corporate access dependency. Do not run OAuth or request tenant permissions merely to use the current workflow.

If the user later opts in and Microsoft administration approves, scripts/outlook-connect.mjs can bootstrap the server/web connection for ben.hessler@spray-net.com. Register the **Web** callback http://localhost:43187/oauth/callback and delegated Calendars.ReadWrite, User.Read, and offline_access. Put the app-secret value in an approved ephemeral environment, authenticate Wrangler, then run the operator utility only when authorized. It verifies mailbox/calendar ownership and pipes MICROSOFT_* secrets to the Worker without printing tokens/files or creating events; it changes live secrets. [Microsoft authorization code guidance](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)

Server-only names: MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_REFRESH_TOKEN, OUTLOOK_CALENDAR_USER. Keep bootstrap credentials stable during automatic encrypted token rotation; account/secret changes need planned re-bootstrap. The optional Graph adapter must be explicitly selected/tested and may send actual invitations when attendees are included. [Graph calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0), [Graph event creation](https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0)
