# QR encoder provenance

`qrcode.mjs` is a browser-only ESM bundle of the pure encoder from **qrcode 1.5.4**, including its **dijkstrajs 1.0.3** dependency. Both are MIT licensed; the unchanged distributed license files are in `qrcode.LICENSE.txt` and `dijkstrajs.LICENSE.txt`. Its bundle header also retains the Ryan Day, Kazuhiko Arase, and Wyatt Baldwin copyright notices from the upstream source files.

Sources: [node-qrcode](https://github.com/soldair/node-qrcode/tree/v1.5.4), [qrcode on npm](https://www.npmjs.com/package/qrcode/v/1.5.4), and [dijkstrajs](https://github.com/tcort/dijkstrajs).

The input packages were reused from the existing Spray-Net review portal's installed npm dependencies. Its `qrcode/lib/core/qrcode.js` entry was bundled with the already installed esbuild, using `bundle: true`, `platform: 'browser'`, `format: 'esm'`, `target: 'es2020'`, `minify: true`, and `legalComments: 'eof'`. No QR service, credentials, customer records, image downloader, canvas renderer, or server modules are included. There is no runtime npm installation or network request.

The application supplies one byte-mode URL segment and medium error correction. `public/qr.js` builds the SVG through DOM methods, with black modules on white and the standard four-module quiet zone. Do not add logos over modules or crop the quiet zone. Private lead-access codes contain a bearer token, so do not log, publish, commit, or batch-export their content.
