# Claude Usage for Macotron

![The ring icons in the menu bar and the dashboard dropdown](screenshot.png)

Session and weekly [claude.ai](https://claude.ai) quota in the
[Macotron](https://github.com/statico/macotron) menu bar. A port of
[Claude-Usage-Tracker](https://github.com/hamed-elfayome/Claude-Usage-Tracker):
same icon styles, same thresholds, same colors, same pace marker.

- Five icon styles: battery, progress bar, ring, percentage, compact dot.
- Green under 70%, orange under 90%, red above. Once 15% of a window has
  passed, the color follows the projected usage instead of the raw number.
- A pace tick sits at the elapsed fraction of the window. Its color says how
  far ahead of it you are: green, teal, yellow, orange, red, purple.
- Click the item for a dashboard with the session, all-models weekly, and
  per-model weekly quotas and their reset times.

## Install

1. Open Macotron. Go to Settings → Plugins → Catalog → Community.
2. Find **Claude Usage**. Press **Add**.
3. Read the source in the review sheet. Press **Add** again.
4. Sign in to claude.ai in a browser. Open the developer tools, find the
   `sessionKey` cookie for claude.ai, and paste its value into the plugin's
   **Session key** field. Macotron keeps it in the Keychain.

Needs a Macotron build newer than 0.5.1: earlier versions drop the `Cookie` header.

## How it works

The plugin calls the same endpoint the claude.ai web app does:

```
GET https://claude.ai/api/organizations
GET https://claude.ai/api/organizations/<uuid>/usage
```

Every 30 seconds by default. The organization id is cached in the plugin's
local storage and dropped again when the session key is rejected.

## Test

```sh
node test.js
```
