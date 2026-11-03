# DSH HTML course player (source experiment)

[中文](README.md)

An optional tool plugin opens workspace courses and returns a clickable player URL. Existing DSH link preferences select the sidebar or external browser. Studio can create course packages later; this plugin has no Studio dependency or DSH core/browser changes.

## Setup

Requires Node 24+, the DSH 0.2.1-rc.2-compatible tool API, and html-course-player sources containing player/preview.cjs. Run npm ci and npm run build in the player repository first. This is source integration, not a published/default distribution.

Register using cordis.patch.yml and configure enabled: true, localHost: true, playerRoot (absolute player source directory), and dataRoot (absolute private classroom data directory). Disabled by default.

In a workspace-backed conversation, invoke course_player with {"operation":"open","coursePath":"examples/interactive"}. The directory needs course.json as described in the player's player/COURSE_FORMAT.md. The result contains status, instanceId, title and url. Open its link using the existing browser. Use operation status to inspect the instance, or stop with its instanceId to shut it down.

Repeated opens reuse the same course. Stop before switching courses in one session. Closing a tab preserves the classroom; stop or plugin disposal closes its listeners. Data is separated by workspace/session/course. Session-close automatic cleanup is not integrated; explicitly stop unused courses.

## Architecture

DSH tool → manifest validation → loopback player service → existing browser. Interactive courses additionally start the player's existing Node classroom service, with SQLite stored under dataRoot. Plain courses only start static preview.

Course directories are confined to the workspace. Only declared course files, assets and allowed player resources are served. Question banks and databases are not static resources. Listeners bind to 127.0.0.1; preview URLs use random paths and validate Host. Starting a service requests DSH tool permission outside full-access sessions. Use trusted HTML/JS courses.

Remote-host forwarding, student LAN access, locked release dependencies and production plugin assembly remain future work. The package format and lifecycle API can also serve future Studio/Sites entry points.

## Verification

Set COURSE_PLAYER_ROOT to the absolute player source path and run npm test. Cross-repository tests skip without it. npm run test:browser uses Playwright; COURSE_BROWSER_EXECUTABLE can select local Chromium/Edge. Screenshots go to dist.

Tests use the official defineTool with a synthetic DSH context and real player/classroom services. Full DSH desktop assembly requires separate acceptance.
