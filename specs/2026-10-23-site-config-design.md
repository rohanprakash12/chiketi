# Sites: every deployment detail in config, none in the software — design spec

- **Date:** 2026-10-23
- **Status:** Draft, for the owner's review.
- **Topic:** Separate chiketi (software) from a *site* (one deployment's configuration).
  Move the deployment tooling that today lives as hand-edited scripts in a private
  repository into chiketi, as generic commands driven by a site folder.

## Why

chiketi is public. A real deployment has addresses, host names, users, device names and
settings that must never be committed here. Today the running software already reads its
own settings from config (`~/.config/chiketi/*.toml`, the display's URL), but deploying it
still depends on scripts and files with addresses written into them: a server deploy
script, a kiosk wrapper page with the server's address inside, service units with
allowlists, a probe installer with the server's login. Those live in a private repository
that is half configuration, half code, and every new deployment would have to copy and
edit that code.

The owner's rule: **all information lives in config files kept separate from the
software.** The software is the same for everyone; a site folder says where and how it runs.

## Success criteria

1. A site is a folder of config files only: no scripts, no code, no templates.
2. Every file chiketi installs on a machine (service units, the kiosk wrapper page, the
   session feed's settings, the server's config files) is generated from the site folder by
   chiketi's own commands. No generated file is hand-edited.
3. One command deploys each part of a site; `--dry-run` shows exactly what would change,
   and `render` prints any generated file without touching a machine.
4. Redeploying an existing site from the new tooling produces files equivalent to what is
   running today (the migration check below), so nothing on the machines changes behaviour.
5. chiketi ships an example site with made-up values that documents the format.
6. Secrets are never part of a site: the tooling refuses keys that look like secrets and
   points to where the secret belongs on the target machine.
7. CI is green: lint rules pinned to what the code follows, the website regenerated.

## Scope

**In scope**
- The site format (`site.toml` plus the config files the server reads).
- A `chiketi-site` command with `check`, `render` and `deploy` subcommands.
- Templates (in chiketi, not in the site) for everything it installs.
- Kiosk displays (a browser on its own machine), picture-feed displays (rendered on the
  server by `companions/lcd-snap`), the session feed, the Home Lab probe.
- An example site in `examples/site/`.
- CI: pinned ruff rules, regenerated website.
- Migration of the owner's existing site (done in the private repository, verified here
  only through the equivalence check).

**Out of scope**
- Installing an operating system or base packages on a kiosk (the tooling assumes the
  kiosk machine has a browser and a compositor; it says so if they are missing).
- Device approval: still done in the control panel (pairing stays the gate).
- The program that pushes pictures to a screen's hardware (e.g. a USB LCD with its own
  protocol). It is a separate project with its own licence, kept as small as possible: it
  fetches `/lcd.png` and sends it to the screen, and shows a plain "no signal" frame when
  pictures stop. It draws nothing else (no own sessions or backup views: chiketi draws
  every screen, and backup trouble surfaces on Home Lab). chiketi defines the contract and
  generates the pusher's config file (below); the pusher's code is not part of chiketi.

## The site format

A site is a directory, kept wherever the owner keeps private files:

```
site/
├── site.toml          # where everything runs
├── server/            # copied as-is to the server's ~/.config/chiketi/
│   ├── sessions.toml
│   └── homelab.toml
└── NOTES.md           # optional, free text; never read by the tooling
```

`site.toml` (all values below are documentation examples):

```toml
[site]
name = "example"

[server]
address = "192.0.2.10"        # how displays and browsers reach it
ssh = "admin@192.0.2.10"      # how the tooling reaches it
port = 7777
install_dir = "/opt/chiketi"

[[display]]
id = "kiosk-1"                # the device id in /display?device=…
kind = "browser"              # its own machine runs a kiosk browser
ssh = "admin@192.0.2.20"
user = "admin"                # the account the kiosk session runs as

[[display]]
id = "wide-1"
kind = "picture"              # rendered on the server by lcd-snap
width = 1920
height = 462
readers = ["192.0.2.30"]      # machines allowed to fetch the picture
pusher_ssh = "admin@192.0.2.30"                      # the machine the screen is plugged into
pusher_config = "~/.config/chiketi-pusher/config.toml" # where the pusher reads its settings

[session_feed]
ssh = "admin@192.0.2.40"
port = 8766
readers = ["server"]          # "server" means [server].address; IPs allowed too

[homelab]
probe_hosts = ["admin@192.0.2.21", "admin@192.0.2.22"]   # Linux hosts to install on
```

Rules:
- Unknown keys are an error (`check` names them), so a typo never silently does nothing.
- Keys that look like secrets (`token`, `password`, `secret`, `key` with a value) are an
  error, with a message naming where that secret belongs on the target (for example the
  Home Assistant token in the server's `~/.config/chiketi/ha_token`).
- `server/` files are validated with chiketi's own loaders (the same code the server uses
  at runtime), so a deploy cannot ship a config the server would reject.
- Display ids follow the existing device-id rule (`a-z 0-9 -`, 1–32).

## The command

`chiketi-site` is a new console script installed with chiketi. Every subcommand takes
`--site DIR` (or `CHIKETI_SITE`).

| Command | Does |
|---|---|
| `check` | Validates `site.toml` and `server/*.toml`; prints the plan of machines and parts. Touches nothing. |
| `render PART [--display ID]` | Prints a generated file (`server-unit`, `kiosk-page`, `kiosk-launcher`, `kiosk-unit`, `picture-unit`, `feed-unit`, `feed-env`). Touches nothing. |
| `deploy server [--ref REF]` | Today's server deploy: `git archive` of a committed chiketi version into a venv under `install_dir`, the generated unit, `server/*.toml` into `~/.config/chiketi/`, restart, health check. |
| `deploy display ID` | `browser`: generated wrapper page, launcher and unit to the kiosk machine, restart the kiosk. `picture`: generated lcd-snap unit and its files on the server, restart it, and the generated pusher config (picture URL, size, how long before "no signal") to `pusher_ssh`:`pusher_config`. Restarting the pusher is the pusher's own service's job (`--restart-unit NAME` optional). |
| `deploy feed` | Generated session-feed unit and environment file to the feed machine (the code comes from the chiketi checkout on that machine, as today). |
| `deploy probe [HOST…]` | Installs the Home Lab probe on the hosts listed (or all of `[homelab].probe_hosts`), using the server's probe key. |

Every `deploy` accepts `--dry-run` (prints each file it would write and a diff against the
machine's current copy) and backs up any file it replaces as `*.bak-YYYYMMDD` (the existing
rule), never deleting anything. It talks to machines only with the system `ssh`/`scp`,
like the Home Lab poller. No new runtime dependency.

## Templates

Templates live in `chiketi/site/templates/` and are filled from `site.toml` with Python's
`string.Template` (no new dependency). They are the generic versions of the files the
private repository holds today:

- `chiketi.service` (server, `--no-kiosk`)
- kiosk: `shell.html` (frames `http://{address}:{port}/display?device={id}`, the
  unreachable notice), `chromium-kiosk.sh`, `kiosk.service`, `90-kiosk-logind.conf`
- `lcd-snap.service` (LCD_URL with the display id and `feed=picture`, LCD_ALLOW from
  `readers`, LCD_W/LCD_H)
- `claude-session-feed.service` and `feed.env` (FEED_ALLOW from `readers`)
- `pusher.toml` for a picture display's pusher: `url = "http://{address}:7778/lcd.png"`,
  `width`, `height`, `stale_seconds` (default 15)

Values are escaped for their context (HTML for the page, systemd quoting for units), and
rendering refuses a value containing a newline.

## Example site

`examples/site/` is a complete, valid site using documentation addresses and made-up
names. `chiketi-site check --site examples/site` runs in CI. The README's "Running as a hub"
section is rewritten around it.

## CI

- **Lint:** ruff 0.17 enables many rules by default (207 findings, 93 of them the
  deliberate broad `except` in collectors and servers: a reading must never crash the
  dashboard). Pin the rules the code follows: `[tool.ruff] line-length = 120` and
  `[tool.ruff.lint] select = ["E", "F", "W", "I", "UP", "B"]`. That leaves 27 findings
  today (13 import order, 4 long lines, 3 `%`-formatting, 2 `zip()` without `strict`, and
  5 one-offs), which are fixed. The deliberate broad excepts are not churned.
- **Website:** regenerate `docs/site/` and update `docs/index.html`'s text to the current
  product (17 themes, 7 screens), so the "generated assets in sync" job passes.

## Migration (owner's site; private)

1. Write the owner's `site.toml` and move `sessions.toml`/`homelab.toml` into `server/`.
2. For every generated file, compare `chiketi-site render …` with the copy running on the
   machine today (`deploy --dry-run` shows the diffs). Differences must be explained (for
   example comments) or fixed in the template before anything is deployed.
3. Deploy each part with the new command; verify the server's health, both displays
   checking in, frames reaching the picture reader, the session feed answering.
4. The USB LCD's existing driver is cut down to a pusher (fetch, push, "no signal"),
   reading `pusher.toml`; its own sessions and backup views are removed. It stays its own
   small GPL program, outside chiketi.
5. The private repository then holds only the site folder, notes and house tools that are
   not part of chiketi (they move out of the way of the site folder).

## Testing

- **Unit:** site parsing and validation (unknown keys, secret-looking keys, bad ids, missing
  sections, `readers = ["server"]` resolution); template rendering for every part,
  including escaping and newline refusal; the deploy plan with a fake `ssh`/`scp` runner
  (which files go where, backups taken, nothing deleted, `--dry-run` writes nothing).
- **Example site:** `check` and every `render` pass in CI; the privacy test
  (`tests/test_no_private_data.py`) covers `examples/`.
- **Migration check:** the equivalence comparison above, run against the real machines,
  before the first real deploy.
