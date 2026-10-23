# Local device rehearsal

This test uses a separate persistent workspace in ignored `data/device-test/`.
It creates five synthetic students, a faculty member, HOD and administrator, with
one class and subject, a timed quiz, a written assignment and two ordered lessons.
Normal restarts preserve accounts, submissions and marks; nothing is reset.
The launcher does not load `.env`, use the main database, or connect AI/sandbox
services. Do not enter real student records into this HTTP rehearsal workspace.

1. Connect the server laptop and testing devices to the same trusted Wi-Fi.
2. Run `npm run build` and find the laptop's Wi-Fi IPv4 address using `ipconfig`.
3. Run `node scripts/start-device-test.mjs YOUR_WIFI_IPV4` from the project root.
4. Open `http://YOUR_WIFI_IPV4:3003/#access` in each device's browser.
5. Read `data/device-test/DEVICE-TEST-LOGINS.md` locally. Give each tester a
   different student login; keep staff passwords with the organizer.

The console prints file paths, never passwords. Generated credentials and records
are excluded from Git. Stop the foreground launcher with Ctrl+C. For a hidden
background launcher, record its PID and stop only that process. Restart with the
new Wi-Fi address if the laptop's address changes.

## Rehearsal

- All students log in at the same time and check their own name.
- Submit the Computing Quiz and compare the individual receipt and score.
- Begin the Written Assignment, enter identifiable synthetic responses, wait for
  **Saved**, refresh and reopen. Confirm no other student's response appears.
- Submit. Faculty review each student's two tasks, enter marks and feedback.
- Students reopen their submissions to confirm the returned marks and feedback.
- Complete the two lessons under Study Materials; check progress after refresh.
- Faculty record attendance for the test class; refresh analytics to inspect it.

The quiz permits ten attempts with 15 minutes per attempt. Activities deliberately
have no closing deadline, so they remain usable when the server restarts. Use
Assessment Studio to publish an additional activity for testing scheduled release.

Local HTTP tests browser workflows. PWA installation and the portable desktop
client need the HTTPS deployment. Coding execution, AI generation and reviewed ML
predictions are separate integration tests, not simulated as working here.

## Connection troubleshooting

Allow inbound TCP 3003 only on the Wi-Fi interface, from the local subnet, using
Windows Firewall; administrator rights are needed. Do not disable the firewall or
forward the router's public ports. Guest Wi-Fi/client isolation can block devices
from reaching each other even when their network name matches.

The included `scripts/allow-device-test.ps1 -WifiAddress YOUR_WIFI_IPV4` creates
this scoped rule when run in an administrator PowerShell. Start the test server
first so its private output directory exists. The rule applies to the selected
interface even if Windows labels that Wi-Fi network Public; it does not change
the network profile or open other ports. Its result is recorded in
`data/device-test/firewall-status.json`. After the rehearsal, remove only this
rule in administrator PowerShell:

```powershell
Remove-NetFirewallRule -Name 'FactX-Device-Test-TCP3003-YOUR_WIFI_IPV4'
```

Confirm the server laptop can open `/api/health` at its Wi-Fi address, then try the
same address from a second device. A successful local request alone does not
establish remote-device connectivity. Keep the laptop awake during testing.

Run `node tests/device-test-browser.mjs` for five isolated browser sessions against
a temporary copy of this fixture. It does not consume the real rehearsal attempts
or submit work on behalf of the human testers.
