# Spray-Net home show color studio

A mobile-first project form and photo color studio for Spray-Net South Charlotte. Visitors can share their project, add photos, and receive three free color visualizations once the private API is configured. The visitor pays nothing; the business pays its rendering and hosting providers.

The static frontend runs now as an honest design preview. It does not pretend to save leads or generate images when the API is disconnected. Publishing to GitHub Pages only publishes the frontend; the private backend must be deployed separately before collecting real visitor information.

## Run locally

Use Node.js 22.13 or newer (Node 24 is recommended). There are no frontend or test package dependencies to install.

```sh
npm run dev
```

Open http://localhost:4173. The server is local-only and serves `public/`; it does not emulate successful submissions or rendering.

```sh
npm run check
npm test
npm run build
```

`check` verifies JavaScript syntax, referenced local HTML/CSS/module assets, and obvious committed credentials. Tests exercise contact mapping, upload constraints, private-media URL confinement, lead validation, private media authorization, CSV escaping, and server-side render limits using Node's in-memory SQLite. These checks do not replace testing against deployed Cloudflare services and the selected rendering provider.

`build` copies `public/` to `dist/`. Set `API_BASE_URL` to an absolute HTTPS API origin to override only `apiBase` in the generated public config. An empty value keeps preview mode. Secrets are never copied from environment variables into the site.

## What is included

- Responsive project, contact, consent, and photo flow with mobile autofill hints.
- Optional saved-contact picker when the visitor's browser supports it and the visitor approves sharing. Other devices use autofill/manual entry.
- Three photo selections per browser session, each JPEG/PNG/WebP and at most 10 MB.
- Color selection, surface selection, private image retrieval, and downloadable completed visualizations.
- A Cloudflare Worker API with D1 lead records and private R2 photos/renders.
- Three successful renders per normalized email and server-defined event. Database triggers reserve credits and the daily attempt budget atomically. Failed renders restore visitor credit; daily attempts remain counted because provider costs can still occur.
- Exact-origin CORS, bearer-protected media, server-only provider credentials, lead creation throttling, and administrator CSV export.
- GitHub Pages build/test/deployment workflow using official GitHub actions.

## Connect and publish

Follow [docs/SETUP.md](docs/SETUP.md) for the backend, existing rendering API adapter, public configuration, GitHub Pages, and end-to-end acceptance checks. The requested personal GitHub destination is `benjamin41997-ctrl`; confirm authenticated repository access before pushing. This source folder is the deliverable, and does not itself prove a GitHub repository or live deployment exists.

All frontend assets use relative paths for GitHub project Pages. Branding and existing portfolio asset provenance are recorded in [docs/MEDIA-SOURCES.md](docs/MEDIA-SOURCES.md).

## Before the home show

The form keeps name, email, phone, project address, and service interest. The provided corporate procedure allows event-detail changes and asks franchisees to consult their business coach for other customization. Confirm the alternative collection flow against that procedure before using it for real leads. The export is a useful administrative CSV, but an exact Spray-Network import mapping still needs a sample import template; no unverified import compatibility is claimed.

Set the actual show label and stable backend event ID, add a business privacy contact/policy and retention procedure, connect and test the API, then generate a QR code for the final live page URL. Test on actual iPhone/Android devices and booth Wi-Fi. Use the finish/clear-device control between visitors on a shared booth device. Follow up within the corporate procedure's 24-hour window after the show ends.

Photo uploads and generation are online features. A network outage does not save a lead offline. Keep the existing Microsoft Form or a staffed capture process available as the operational fallback.
