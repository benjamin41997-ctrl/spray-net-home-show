# Tablet and mobile operation

The two one-page layouts share one private backend:

| Use | URL |
| --- | --- |
| Visitor phone/public QR | https://benjamin41997-ctrl.github.io/spray-net-home-show/?mode=mobile |
| Staffed tablet | https://benjamin41997-ctrl.github.io/spray-net-home-show/?mode=tablet |
| Staff calendar/export | https://benjamin41997-ctrl.github.io/spray-net-home-show/admin.html |

Mobile is the default. See [deployment status](DEPLOYMENT.md) before assuming current source is live. **No Microsoft/Entra access is required** for internal scheduling.

## Capture, then schedule

Both initially require only **name and phone**. Email/address are optional; a project address is required for consultation booking. Saving a lead offers scheduling to unlock photos and visualizer. Only the backend-confirmed internal appointment unlocks; a contact preference/copied link does not.

Appointments are offered **October 26–November 8, 2026**, inclusive, every day in the 8:00 am–7:00 pm Eastern work window. Visitors see a **one-hour consultation** in the picker, confirmation and downloaded calendar. Internal reservations retain **90 minutes plus a 30-minute travel gap**, latest start **5:30 pm**. Staff blocks/app appointments reduce choices. This calendar does not read Outlook, so staff enter outside commitments as blocks. [Calendar instructions](CALENDAR-SETUP.md)

The rendering key is privately connected and an authorized live image test completed successfully. Offer: three successful renders per normalized phone/event, 50/day global attempt cap. Booking and provider readiness are separate requirements. Both layouts support native autofill and local address suggestions, with manual entry available.

## Public and private QR

The public QR uses the current HTTPS page origin/path with ?mode=mobile, without a lead/token. Use it for signage. The standalone [public mobile QR SVG](mobile-qr.svg) encodes the production URL and its rendered SVG decoded independently. Recreate if the final URL changes; test physical prints/displays.

Scanning the public QR does not create a new unique URL or a lead. Separate phone browsers keep their form/pending work isolated; a successful submission creates its own unique lead ID and private token. Unsubmitted forms cannot overwrite another visitor's data. Returning on the same phone/browser resumes its saved project. Only a visitor-specific private QR resumes a particular saved lead; never use that QR as public signage.

A private QR/link appears on the tablet after a confirmed consultation, preserving #studio=<lead-id>.<visitor-token>. It is **bearer access**, not an unlock flag. Show only its visitor, let them retain it, and clear before the next tablet user. Never publish, batch-export, log, or send its payload to analytics. The page scrubs the fragment and verifies against the trusted configured API.

While scheduling on a tablet, the calendar fills a wider right column. The public QR and two project photos occupy the left column; the third photo returns on the lead-entry screen. Dates use seven columns on landscape tablets, and times use seven or eight columns according to screen width. Address/email and the selected-time/confirmation controls share rows. Buttons retain at least 44-pixel touch targets in the short-screen layout. Private sharing controls and the lower next-visitor button remain hidden until booking confirmation; the header next-visitor control remains available for staff. Narrow screens, browser zoom, and the on-screen keyboard can still scroll rather than clipping controls.

QR generation uses the local MIT encoder: DOM SVG, black/white, medium error correction, four-module white margin. No URL/token goes to a QR service. Keep codes square, preserve margins, and do not cover modules with logos.

On mobile, the thank-you and home-show rewards invitation lead to a large scheduling button, with the visualizer benefit below it. The project-link section is hidden. The browser remembers only the private lead ID/token and configured API origin in local storage, so returning in another tab works without re-entering contact details. Contact data and pending request payloads remain tab-scoped. Kiosks never read/write this persistent mobile access. Clearing browser data removes saved access; storage does not transfer access between devices.

No automatic project-link email/text or appointment email is sent. The owner calendar can prepare a confirmation email in the owner's email app for review and sending from ben.hessler@spray-net.com. Automatic sending requires Microsoft mail authorization, which is not connected. A confirmed visitor can download a **one-hour** .ics appointment; staff calendar exports preserve the internal reservation and travel gap.

Visualizer surfaces allow multiple selections: Cabinets, Siding, Fascia, Gutters and downspouts, Windows, Front door, Garage door and frame. The selected color applies to all chosen visible surfaces in a single request, using one render credit. Window glass is preserved. Existing single-surface pending requests remain retryable.

## Shared tablet routine

1. Open tablet mode; confirm event label, connection, and public QR.
2. Capture name/phone with the visitor, or offer their phone through the public QR.
3. Offer consultation scheduling now, or the public QR for visitors who prefer completing the flow on their own phone.
4. After a tablet booking, have them scan their private project QR before staff clears the tablet with the header next-visitor control. Verify blank form and no previous private QR/photos; the kiosk also clears after its idle warning.
5. Keep a staffed fallback for network failure. A preview/timeout is not proof of a saved lead/booking.

Owner access uses the same email/password and saved session as the review portal. It persists across reloads, page closure and inactivity; explicit sign-out clears the shared session on this browser. Keep the separate operator key and any private access files outside Git/public output and visitor forms. Downloaded CSV/calendar files still need private handling.

Next-visitor/Done actions are bound only in tablet mode and are disabled/hidden on mobile. Manual and idle resets clear the tablet session, remove private URL fragments, explicitly retain ?mode=tablet, and restore the tablet entry layout. Tablet and mobile tab storage use separate keys, even when switching modes in the same browser tab. Resetting the tablet does not delete a saved lead or erase a phone's saved project.

## Verification

Run node --test tests/qr.test.mjs for reference matrices, fragment preservation, accepted schemes, DOM SVG, and quiet zones. Public/synthetic private matrices decoded independently with the existing jsQR library; no customer token used.

QR permits HTTPS or loopback-only HTTP for development. A phone scanning localhost reaches itself, so cross-device tests need an authorized HTTPS page. Private links require HTTPS.

Test actual iPhone/Android cameras, brightness/size, keyboard autofill, required/optional fields, pending retries, cancellation relocking, and reset with delayed requests. Block outside commitments before opening real slots. Staff Outlook downloads add 30 minutes travel; imports never sync later edits/cancellations.
