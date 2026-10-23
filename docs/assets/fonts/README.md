# Bundled fonts

chiketi redistributes the font files in this directory so the kiosk renders
identically offline. Every family here is licensed under the **SIL Open Font
License, Version 1.1**, which requires the copyright notice and the licence
text to travel with the font — hence the `OFL-*.txt` files alongside the `.ttf`s.

The licence text of each `OFL-*.txt` is the upstream project's own `OFL.txt` /
`LICENSE.txt`, copied verbatim (only CRLF line endings were normalised to LF).
Nothing here was written by hand.

## Provenance

| Family | Files | Upstream | Copyright line | Licence |
|---|---|---|---|---|
| Antonio | `Antonio-VariableFont.ttf` | <https://github.com/googlefonts/antonioFont> | Copyright 2013 The Antonio Project Authors (https://github.com/googlefonts/antonioFont) | OFL 1.1 — `OFL-Antonio.txt` |
| Chakra Petch | `ChakraPetch-Regular.ttf`, `ChakraPetch-Bold.ttf` | <https://github.com/google/fonts/tree/main/ofl/chakrapetch> | Copyright 2018 The Chakra Petch Project Authors (https://github.com/m4rc1e/Chakra-Petch.git) | OFL 1.1 — `OFL-ChakraPetch.txt` |
| IBM Plex Mono | `IBMPlexMono-Regular.ttf` | <https://github.com/IBM/plex> | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" | OFL 1.1 — `OFL-IBMPlexMono.txt` |
| Nixie One | `NixieOne-Regular.ttf` | <https://github.com/google/fonts/tree/main/ofl/nixieone> | Copyright (c) 2011 by Jovanny Lemonad (http://www.jovanny.ru) | OFL 1.1 — `OFL-NixieOne.txt` |
| Rajdhani | `Rajdhani-Regular.ttf`, `Rajdhani-SemiBold.ttf` | <https://github.com/google/fonts/tree/main/ofl/rajdhani> | Copyright (c) 2014, Indian Type Foundry (info@indiantypefoundry.com). | OFL 1.1 — `OFL-Rajdhani.txt` |
| Share Tech Mono | `ShareTechMono-Regular.ttf` | <https://github.com/google/fonts/tree/main/ofl/sharetechmono> | Copyright (c) 2012, Carrois Type Design, Ralph du Carrois (post@carrois.com www.carrois.com), with Reserved Font Name 'Share' | OFL 1.1 — `OFL-ShareTechMono.txt` |

## How this was verified

1. Each `.ttf`'s own `name` table was read directly. All eight files carry
   name ID 14 (licence URL) = `http://scripts.sil.org/OFL`; Antonio, Chakra
   Petch and Rajdhani additionally carry name ID 13 naming OFL 1.1 explicitly.
2. Each family's upstream licence file was fetched from the canonical
   repository listed above, and the copyright line taken from it verbatim.
3. The OFL body of all six files (from `SIL OPEN FONT LICENSE Version 1.1`
   onward) is byte-identical, i.e. the unmodified OFL 1.1 text.
4. `OFL-ChakraPetch.txt`, which predates this audit, is byte-identical to
   upstream `ofl/chakrapetch/OFL.txt`, so all six now follow one convention.

Note on IBM Plex: it has been OFL 1.1 since its 2017 release. Between
2018-08-09 and 2018-08-21 it was briefly *dual*-licensed with Apache-2.0; that
addition was rescinded as unsuitable for fonts. There was never a period where
IBM Plex was not available under OFL 1.1.

Three families carry a **Reserved Font Name** ("Plex", "Nixie", "Share"). We
redistribute the originals unmodified, so no renaming obligation is triggered;
anyone *modifying* these files must rename them.

## Reserved Font Names and derivative works

Do not modify a `.ttf` in place. If a family ever needs subsetting or
re-hinting, do it under a new name for the three RFN families above, and update
this table.

## Keeping the two trees in sync

`docs/assets/fonts/` is a mirror required by GitHub Pages, which serves `docs/`
from a different root than the package. It is generated — run
`python scripts/gen_site_assets.py` rather than copying files by hand, so the
licences can never be left behind.
