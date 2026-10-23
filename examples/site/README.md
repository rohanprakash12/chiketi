# Example site

A *site* is one deployment of chiketi: a folder of config files that says where the
server, the displays, the session feed and the Home Lab probe run. The software is the
same for everyone; the site holds the addresses. Every value here is made up.

```
site/
├── site.toml          # where everything runs
├── server/            # copied as-is to the server's ~/.config/chiketi/
│   ├── sessions.toml
│   └── homelab.toml
└── NOTES.md           # optional, free text; never read by the tooling
```

## Using it

1. Copy this folder somewhere private (not into a public repository) and edit the values.
2. `chiketi-site check --site DIR` — validates everything, including `server/*.toml` with
   the same loaders the server uses.
3. `chiketi-site render kiosk-page --display kiosk-1 --site DIR` prints any generated file.
4. `chiketi-site deploy server --dry-run --site DIR` shows a diff against each machine's
   current copy and writes nothing. Do the same for `deploy display ID`, `deploy feed`.
5. Drop `--dry-run` to deploy. A replaced file is kept as `<file>.bak-YYYYMMDD`; nothing
   is deleted.

`CHIKETI_SITE=DIR` saves typing `--site`.

## Secrets never go here

`check` refuses keys that look like secrets. They live only on the machine that uses them:

| Secret | Where it lives |
|---|---|
| Home Assistant (or other HTTP) token | the server's `~/.config/chiketi/ha_token` (mode 600), named by `token_file` |
| The Home Lab probe's SSH key | the server's `~/.ssh/chiketi_homelab` |
| A control-panel token, if you use one | `CHIKETI_TOKEN=` in the server's `/etc/chiketi/env` |
