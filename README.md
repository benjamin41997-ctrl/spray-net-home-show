# Spray-Net home show lead capture

A quick name-and-phone lead form for Spray-Net South Charlotte, with separate tablet-kiosk and mobile layouts sharing one private backend. Visitors can then book a consultation in the app's internal calendar. Only a confirmed server appointment unlocks photos and the three-render visualizer. **No corporate Microsoft/Entra connection is required.**

The public [source repository](https://github.com/benjamin41997-ctrl/spray-net-home-show) and [Pages address](https://benjamin41997-ctrl.github.io/spray-net-home-show/) already exist with a dedicated Cloudflare lead API/D1/private R2. See [deployment status](docs/DEPLOYMENT.md) for what is actually released and verified; a source change or successful test is not a deployment. Local public/config.js stays disconnected for previews; the production build receives API_BASE_URL from GitHub Actions. The user's rendering key is configured privately; a real generation/output-quality test remains unverified.

## Visitor and staff flow

1. Submit just a name and phone. Email/project address are optional, and no photo or appointment is needed to save the lead.
2. After saving, choose a consultation time and provide its project address. The server confirms it in the internal calendar before unlocking the visualizer.
3. Consultations start **Monday, October 26, 2026**, and run **90 minutes**, **every day 8:00 am–7:00 pm Eastern**, with a **30-minute travel buffer**. The latest visit starts at **5:30 pm**. Staff blocks and existing app bookings remove unavailable times.
4. Scan/save the private project QR/link to book or use the visualizer later on a phone. The initial public QR opens an empty mobile lead form. QR generation happens locally without sending tokens to a QR service.

Use [mobile mode](https://benjamin41997-ctrl.github.io/spray-net-home-show/?mode=mobile), [tablet mode](https://benjamin41997-ctrl.github.io/spray-net-home-show/?mode=tablet), and admin.html on the connected site for staff scheduling/export. The staff page requires the separate admin key, held only in tab memory, and supports consultations, blocked time, cancellation, private CSV export, and Outlook calendar-file downloads.

The internal calendar does not read/sync Outlook or send email/SMS invitations. Staff must block outside commitments manually. Visitors can download a 90-minute .ics appointment; staff can download it with 30 minutes added for travel and import it into Outlook manually. Edits/cancellations do not synchronize. See [calendar setup](docs/CALENDAR-SETUP.md).

Private project links carry a lead bearer token in the #studio= fragment. Anyone with one has that project's access; it is not a public marketing link or unlock flag. The page scrubs/verifies it and the server checks booking status. Have visitors retain their link before clearing a tablet. No automatic project-link email/SMS or magic-link service is included.

## Local development

Use Node.js 22.13 or newer; Node 24 is recommended. No frontend/test dependency installation is required.

~~~sh
npm run dev
npm run check
npm test
npm run build
~~~

The preview at http://localhost:4173 serves public/ and does not emulate live saves. The build copies assets to dist/ and accepts an absolute HTTPS API_BASE_URL override. Tests use synthetic records/mocked providers; they do not create real bookings, send messages, or spend rendering credits.

## Included

- One-page tablet/mobile capture with optional email/address, autofill hints, and retry-safe lead identity.
- Internal availability/booking, staff blocks/cancellation, and confirmed-booking checks on all studio/media operations.
- Local SVG QR generation, private HTTPS links, tab recovery, and shared-device reset.
- Private JPEG/PNG/WebP uploads up to 10 MB, color/surface choices, completed-image download, and failed-image retrieval.
- Three successful renders per normalized phone/event, atomic credits/daily attempt cap, and server-only image credentials. Failed renders restore visitor credit; attempts remain counted because charges may occur.
- Protected CSV export, exact-origin CORS, private R2, and no customer data or runtime secrets in public assets.
- GitHub checks/build/Pages workflow gated by PUBLISH_PAGES=true; Worker migrations/deployments remain separate.

Follow [SETUP.md](docs/SETUP.md), [tablet/mobile operation](docs/TABLET-MOBILE.md), and [calendar setup](docs/CALENDAR-SETUP.md). Asset provenance is in [MEDIA-SOURCES.md](docs/MEDIA-SOURCES.md).

## Before the show

Complete migration/deployment, staff access setup, outside-commitment blocks, and physical phone/tablet checks. Keep any separately supplied staff-access file private/outside Git and never publish it. Confirm a real generation before relying on visualizer quality; the allowance is three per lead and the global cap is 50 attempts/day.

The shortened form differs from the corporate procedure. Agree how missing CRM fields are completed during follow-up, obtain/test the exact Spray-Network import mapping, and follow up within the procedure's 24-hour window. Network loss is not an offline save; retain a staffed/Microsoft Form fallback.
