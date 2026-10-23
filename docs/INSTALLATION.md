# Phone and Windows installation

FactX now has an installable web app and a Windows x64 portable desktop client.
Both connect to the same institution server. Neither is a standalone offline LMS.
The desktop client does not bundle the API, student database, uploads, AI models,
or execution sandbox. Deployment still needs a trusted HTTPS server/domain.

## Phones

Build with `npm ci` and `npm run build`, and serve the API and `dist` together using
`npm start` behind an HTTPS reverse proxy (see DEPLOYMENT.md). `COOKIE_SECURE=true`
is required for the public deployment. Open the institution URL on the phone.

- Android Chrome/Edge: use the browser Install app / Add to Home screen action.
- iPhone/iPad Safari: Share → Add to Home Screen.
- The download icon in the signed-in toolbar explains installation and offers
  the native install prompt when the browser makes it available.

This is a PWA, not an APK or an App Store release. Installation requires HTTPS
(localhost is an exception for development; a phone's localhost is the phone,
not your laptop). Browser/device install support varies.

The service worker caches **only `/offline.html`**, a public reconnect notice.
It never caches API responses, authenticated pages or uploads. Online pages are
always fetched from the server. There is no offline submission queue: an app's
confirmed Saved / Submission received status is the source of truth. Never close
unsaved work while disconnected. New service-worker versions activate after old
windows close; no forced mid-assessment refresh is used.

## Windows x64

```powershell
Push-Location desktop
npm ci
Pop-Location
npm run desktop:package
```

Output: `release/FactX-1.0.0-Windows-x64.zip`. Packaging stages in a fresh system
temporary directory to avoid OneDrive file locks; the command prints its path and
retains it for inspection/packaged smoke tests. Extract the ZIP, keep its files
together, and run `FactX.exe`. This is a portable application folder, not a
single-file executable or installer. The single-file NSIS launcher build crashed
in this environment; the ZIP bypasses that launcher. Generated artifacts are ignored
by Git. Copy the extracted folder to the target Windows machine and enter the
institution's HTTPS origin on first launch.
Use **FactX → Server settings** to change servers or retry a failed connection.
Changing servers clears the client session/cache and requires a fresh login.
The client remembers the non-secret origin in its Electron user-data directory.
For local development only, `http://127.0.0.1:3001` is accepted.

The package is **unsigned** because no publisher signing certificate is configured;
it is not a signed production distribution and Windows may warn about it. Arrange
institution-approved signing before broad distribution. No auto-update service
is configured; rebuild and redistribute updates, including Electron security fixes.
Current packaging uses Electron's default executable icon.

Remote pages have no preload bridge, Node integration or device permissions.
Sandboxing/context isolation are enabled. Cross-origin top-level navigation,
popups and embedded webviews are blocked; open external learning resources in a
normal browser. Downloads use a save dialog. The bundled local setup screen alone
has a narrow, sender-validated bridge for reading/saving the server origin.

## Verification

```powershell
npm test
npm run build
npm run lint
npm run typecheck
npm run test:browser
npm run test:install
```

`test:install` requires `npm ci` inside `desktop` and Playwright Chromium. If your
package-manager policy skips Electron's install script, run
`node desktop/node_modules/electron/install.js` after reviewing that dependency.
It uses
isolated temporary accounts/data and tests the install manifest, cache allowlist,
offline recovery, mobile layout, desktop address validation, login and renderer
isolation. To smoke-test the packaged executable instead, set
`FACTX_DESKTOP_EXECUTABLE` to `win-unpacked/FactX.exe` inside the printed staging
directory before running it.

## Still required for live rollout

- An institution-controlled HTTPS hostname/server, TLS and backup plan.
- A configured Ollama service with chat/embedding/vision models as needed.
- A separately hosted Judge0 sandbox for code execution. Never run submitted
  student code directly on the FactX application host.
- Full-stack multi-service lab provisioning is not implemented by this package.
  Current assessment rubrics and code tests do not create Coursera/SAP-style VMs.
- Device testing on real Android/iOS phones and signed Windows distribution.

References: [MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable),
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[electron-builder portable targets](https://www.electron.build/docs/nsis/).
