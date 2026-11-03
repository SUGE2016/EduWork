# DSH HTML course player (source experiment)

[中文](README.md)

[Roadmap (Chinese)](docs/ROADMAP.md) · [Development report (2026-11-03, Chinese)](docs/daily/2026-11-03.md)

An optional tool plugin opens workspace courses and returns a clickable player URL. Existing DSH link preferences select the sidebar or external browser. Studio can create course packages later; this plugin has no Studio dependency or DSH core/browser changes.

## Setup

Requires Node 24+, the DSH 0.2.1-compatible tool API (development tests pin rc.5), and html-course-player sources containing player/preview.cjs. Run npm ci and npm run build in the player repository first. This is source integration, not a published/default distribution.

The bundle registers the plugin disabled by configuration. After installing and enabling the bundle, add this entry to the active profile's `cordis.patch.yml`, preserving existing entries, then reload or restart as required by the Host. `Config` validates types; this version adds no client configuration page and these fields do not belong in EduWork's top-level configuration.

```yaml
- id: dsh-course-player
  config:
    enabled: true
    localHost: true
    studentHost: 127.0.0.1 # Use this machines private LAN IPv4 for student access
    playerRoot: /absolute/path/to/html-course-player
    dataRoot: /absolute/path/to/private-classroom-data
```


In a workspace-backed conversation, invoke course_player with {"operation":"open","coursePath":"examples/interactive"}. The directory needs course.json as described in the player's player/COURSE_FORMAT.md. The result contains status, instanceId, title and url; interactive courses also return studentUrl for students to join. Open its link using the existing browser. Use operation status to inspect the instance, or stop with its instanceId to shut it down.

Repeated opens reuse the same course. Stop before switching courses in one session. Closing a tab preserves the classroom; stop or plugin disposal closes its listeners. Data is separated by workspace/session/course. Session-close automatic cleanup is not integrated; explicitly stop unused courses.

## Architecture

DSH tool → manifest validation → loopback player service → existing browser. Interactive courses additionally start the player's existing Node classroom service, with SQLite stored under dataRoot. Plain courses only start static preview.

Course directories are confined to the workspace. Only declared course files, assets and allowed player resources are served. Question banks and databases are not static resources. Preview and teacher controls always bind to 127.0.0.1. studentHost defaults to loopback; an explicit local private IPv4 enables student access only on that interface. Wildcard, public and non-local addresses are rejected. Reconfigure and reopen after changing networks; preview URLs use random paths and validate Host. Starting a service requests DSH tool permission outside full-access sessions. Use trusted HTML/JS courses.

Students need the same reachable LAN; Wi-Fi client isolation and firewalls can still block access. Classroom join codes are not implemented; do not expose this endpoint directly to the Internet. Future Sites integration must return a real public student URL and provide HTTPS, classroom access control and routing, rather than replacing the IP in a local URL. Remote-host forwarding, Sites deployment, locked release dependencies and production plugin assembly remain future work. The package format and lifecycle API can also serve future Studio/Sites entry points.

## Verification

Set COURSE_PLAYER_ROOT to the absolute player source path and run npm test. Cross-repository tests skip without it. npm run test:browser uses Playwright; COURSE_BROWSER_EXECUTABLE can select local Chromium/Edge. Screenshots go to dist.

Tests use the official defineTool with a synthetic DSH context and real player/classroom services. Full DSH desktop assembly requires separate acceptance.
