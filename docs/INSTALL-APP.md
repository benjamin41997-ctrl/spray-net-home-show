# Install the booth tablet app

Open https://benjamin41997-ctrl.github.io/spray-net-home-show/?mode=tablet on each booth tablet. Install from the public tablet page, before entering a visitor's information. The app icon always launches this public tablet workflow; it never contains a customer token or private project link.

## Android tablet

1. Open the tablet page in Chrome.
2. Tap **Install tablet app** in the page footer, then the installation button if offered. You can also use Chrome's **Install app** or **Add to Home screen** menu option.
3. Open the **Spray-Net** icon from the home screen/app launcher. Supported devices launch fullscreen. When the browser has not yet offered native installation, the page's installation panel still shows the menu instructions.

## iPad

1. Open the tablet page in Safari.
2. Tap **Share**, then **View More** if needed, and **Add to Home Screen**.
3. Keep **Open as Web App** enabled if that setting appears, then tap **Add**.
4. Launch the new **Spray-Net** home-screen icon. It opens as a web app without Safari's address bar; iPadOS may retain its status bar/system controls. [Apple instructions](https://support.apple.com/guide/ipad/bookmark-a-website-ipadc602b75b/ipados).

## Other tablets and current browser sessions

Chrome/Edge on Windows can install through the browser's app menu or native install button when offered. The page also offers **Use full screen now** on devices exposing the Fullscreen API. That button requires a tap and is separate from installation; the operating system can let a user exit fullscreen. Installation is not an OS kiosk lock.

## Operating behavior

- Start in landscape for the existing booth layout. Rotation is allowed.
- The installation footer control hides inside the installed app. **Next visitor** remains the only tablet reset; there is no inactivity reset or automatic app reload.
- The same QR becomes the active visitor's private handoff after submission. Let them scan before **Next visitor** restores the public QR.
- Internet remains required for leads, slots/bookings, address lookup and visualizations. No offline submission queue or customer cache is introduced.
- The service worker stores no caches, does not intercept API/auth/owner/media traffic, and only provides a generic reconnect page when public lead-page navigation fails.
- Future opens use the current network version. Updating the worker does not reload an active visitor. Close and reopen after a published update when the tablet is between visitors.
- The five-render allowance and server-side attempt caps are unchanged by installation, device changes, browser storage or updates.

Automated checks cover manifest/icon/build paths, explicit install prompting, installed-state UI, fullscreen denial, worker scope and private-traffic exclusions. Physical installation on the user's tablets still requires verification on those devices. [Installability requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [fullscreen fallback behavior](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/display).
