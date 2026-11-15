# Web experience (`web/`, served at `/app/`)

Run `python -m uvicorn api.main:app --port 8000`, open http://127.0.0.1:8000/app/

Plain ES modules + Three.js 0.160 (CDN import map); no build step. Textures are generated from LROC
on first request and cached in `data/web_assets/` (git-ignored).

## Pages
| Page | What it shows | Data |
|---|---|---|
| Home | Slowly orbiting 3D Moon, south-pole site pins | LROC WAC albedo + GLD100 heights; Sun/Earth direction from JPL Horizons (14 Dec 2026 20:00 UTC) |
| Compare | Two ground-level views on one clock, Play/Pause, compass + readouts | Horizons Sun/Earth az/el per site; LROC terrain 30 km square |
| Analyze | Rotatable globe lit by the real sub-solar point; pin -> camera descent -> ground view | Horizons sub-solar / sub-Earth points; polar caps from LROC orthographic grids |
| Observe | Night sky from 12 launch sites; Moon moves and shows its true phase | Skyfield (JPL DE440s) positions every 5 min |

Shareable links: `#/compare?t=2026-12-27T02:00Z&a=site04&b=site11`, `#/analyze?site=site11`,
`#/observe?place=ksc_lc39a&date=2026-11-15`.

## Real vs illustrative
- Real: Sun/Earth directions (Horizons), Moon/Sun sky positions and illumination (Skyfield), terrain heights and
  surface brightness (LROC WAC via the QuickMap server), lunar curvature in the ground view, Earth's phase as seen from the Moon.
- Exaggerated for legibility: globe relief x2, slope shading x6 (x4.2 on polar caps); Moon drawn 12x size in the Earth sky.
- Illustrative: small craters below the 117 m terrain spacing, Earth surface texture, star field, Earth-side horizon silhouette.
- Known limit: coarse polar heights place Site 04 on a crater wall, so its ground view is mostly in shadow.
