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

Appointments begin **Monday, October 26, 2026**. Hours are **all seven days 8:00 am–7:00 pm Eastern**, **90-minute visits**, **30-minute travel buffer**, latest start **5:30 pm**. Staff blocks/app appointments reduce choices. This calendar does not read Outlook, so staff enter outside commitments as blocks. [Calendar instructions](CALENDAR-SETUP.md)

The rendering key is privately connected and an authorized live image test completed successfully. Offer: three successful renders per normalized phone/event, 50/day global attempt cap. Booking and provider readiness are separate requirements. Both layouts support native autofill and local address suggestions, with manual entry available.

## Public and private QR

The public QR uses the current HTTPS page origin/path with ?mode=mobile, without a lead/token. Use it for signage. The standalone [public mobile QR SVG](mobile-qr.svg) encodes the production URL and its rendered SVG decoded independently. Recreate if the final URL changes; test physical prints/displays.

A private QR/link appears after a saved lead, preserving #studio=<lead-id>.<visitor-token>. It resumes scheduling while unbooked and is **bearer access**, not an unlock flag. Show only its visitor, let them retain it, and clear before the next tablet user. Never publish, batch-export, log, or send its payload to analytics. The page scrubs the fragment and verifies against the trusted configured API.

QR generation uses the local MIT encoder: DOM SVG, black/white, medium error correction, four-module white margin. No URL/token goes to a QR service. Keep codes square, preserve margins, and do not cover modules with logos.

No project-link email/text is sent. Visitors must copy/save/scan it themselves; tab storage does not transfer access to another phone. A confirmed visitor can download a 90-minute .ics appointment for manual import. It is not an invitation or synchronized calendar.

## Shared tablet routine

1. Open tablet mode; confirm event label, connection, and public QR.
2. Capture name/phone with the visitor, or offer their phone through the public QR.
3. Offer consultation scheduling now or their private project QR to finish later.
4. Have them save access before clearing. Verify blank form and no previous private QR/photos; the kiosk also clears after its idle warning.
5. Keep a staffed fallback for network failure. A preview/timeout is not proof of a saved lead/booking.

Owner access uses the same email/password and saved session as the review portal. It persists across reloads, page closure and inactivity; explicit sign-out clears the shared session on this browser. Keep the separate operator key and any private access files outside Git/public output and visitor forms. Downloaded CSV/calendar files still need private handling.

## Verification

Run node --test tests/qr.test.mjs for reference matrices, fragment preservation, accepted schemes, DOM SVG, and quiet zones. Public/synthetic private matrices decoded independently with the existing jsQR library; no customer token used.

QR permits HTTPS or loopback-only HTTP for development. A phone scanning localhost reaches itself, so cross-device tests need an authorized HTTPS page. Private links require HTTPS.

Test actual iPhone/Android cameras, brightness/size, keyboard autofill, required/optional fields, pending retries, cancellation relocking, and reset with delayed requests. Block outside commitments before opening real slots. Staff Outlook downloads add 30 minutes travel; imports never sync later edits/cancellations.
