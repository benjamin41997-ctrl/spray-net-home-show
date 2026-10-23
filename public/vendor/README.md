# QR encoder provenance

## Owner sign-in

`supabase-auth.mjs` bundles the official **@supabase/auth-js 2.117.2** AuthClient and **tslib 2.8.1**, reused from the review portal's installed dependencies with esbuild (browser, ESM, ES2022, minified, legal comments retained). License files are `supabase-auth.LICENSE.txt` and `tslib.LICENSE.txt`. No CDN script or runtime package download is needed. The configured Supabase URL and publishable key are public; no service-role key is used.

The owner page uses the review portal's `spraynet-review-admin` storage key on the same GitHub Pages origin. The official client persists and refreshes the provider session. Passwords and the separate private operator key are never written to browser storage. The Worker verifies the access token with the configured provider and accepts only its confirmed owner email. Session storage alone never grants access. [Official SDK](https://github.com/supabase/supabase-js/tree/master/packages/core/auth-js), [Supabase session guidance](https://supabase.com/docs/guides/auth/sessions).

`qrcode.mjs` is a browser-only ESM bundle of the pure encoder from **qrcode 1.5.4**, including its **dijkstrajs 1.0.3** dependency. Both are MIT licensed; the unchanged distributed license files are in `qrcode.LICENSE.txt` and `dijkstrajs.LICENSE.txt`. Its bundle header also retains the Ryan Day, Kazuhiko Arase, and Wyatt Baldwin copyright notices from the upstream source files.

Sources: [node-qrcode](https://github.com/soldair/node-qrcode/tree/v1.5.4), [qrcode on npm](https://www.npmjs.com/package/qrcode/v/1.5.4), and [dijkstrajs](https://github.com/tcort/dijkstrajs).

The input packages were reused from the existing Spray-Net review portal's installed npm dependencies. Its `qrcode/lib/core/qrcode.js` entry was bundled with the already installed esbuild, using `bundle: true`, `platform: 'browser'`, `format: 'esm'`, `target: 'es2020'`, `minify: true`, and `legalComments: 'eof'`. No QR service, credentials, customer records, image downloader, canvas renderer, or server modules are included. There is no runtime npm installation or network request.

The application supplies one byte-mode URL segment and medium error correction. `public/qr.js` builds the SVG through DOM methods, with black modules on white and the standard four-module quiet zone. Do not add logos over modules or crop the quiet zone. Private lead-access codes contain a bearer token, so do not log, publish, commit, or batch-export their content.
