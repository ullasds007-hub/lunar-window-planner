# Credits and third-party terms

This file covers **third-party data, imagery and libraries** only. The licence for this project's own
source code is a separate decision for the team and will go in a `LICENSE` file; nothing here grants
or changes it. Third-party material keeps its own terms listed below.

## Moon imagery and terrain (3D views): LROC

On-screen credit, shown on every 3D view that draws these files:

> Moon imagery and terrain: NASA/GSFC/Arizona State University (LROC)

| Product (map-server layer) | Used for |
|---|---|
| `luna_wac_normalized_reflectance`: LROC Wide Angle Camera normalized reflectance mosaic | Moon brightness on the globe, polar caps and ground views |
| `luna_wac_dtm_numeric_meters_absolute`: GLD100 topography from LROC WAC stereo | Globe relief, polar caps and ground terrain |

- Source: LROC map server `https://wms.im-ldi.com/` (Lunaserv, the server behind LROC QuickMap,
  https://quickmap.lroc.im-ldi.com).
- Terms: https://www.lroc.im-ldi.com/about/terms. Products from the PDS archive are public domain.
  Images from the LROC website and **non-PDS interfaces (which includes this map server) are copyrighted**.
  Educational use is permitted without prior permission when credited "NASA/GSFC/Arizona State
  University" (short form "NASA/GSFC/ASU"). **Commercial use requires prior permission from LROC.**
- Research citations requested by LROC for Lunaserv data:
  - Estes, N.M., et al. (2013). *Lunaserv Web Map Service: History, Implementation Details, Development,
    and Uses*. 44th Lunar and Planetary Science Conference, 2609.
  - Robinson, M.S., et al. (2010). *Lunar Reconnaissance Orbiter Camera (LROC) Instrument Overview*.
    Space Science Reviews 150, 81–124.
  - Scholten, F., et al. *GLD100 – The Global Lunar 100 meter Raster DTM from LROC WAC Stereo Models*.
    42nd Lunar and Planetary Science Conference, 2046.

**Do not commit the QuickMap exports.** `simulation3d/data/web_assets/` is ignored. When that
directory is empty, the 3D views show an explicitly labeled procedural Moon or flat ground.
The application serves local assets when present and does not generate or fetch missing LROC
files on request. This display fallback does not change the planner's Sun/Earth calculations.

Not done yet: rebuilding these visuals from public-domain NASA PDS products, with their product IDs
recorded here.

## Ephemerides, positions and coordinates

- **JPL DE440s** (`de440s.bsp`), downloaded by `prepare_combined.py`. It is a NAIF/JPL generic kernel. NAIF
  allows redistribution of unmodified kernels. It is not committed here.
- **JPL Horizons** (https://ssd.jpl.nasa.gov/horizons/) is a comparison reference. The integrated
  planner computes geometry locally with its Skyfield kernels; no Horizons caches are bundled here.
- **Landing-site coordinates:** NASA *Lunar Surface Data Book*, Table A2.1-1 "Lunar South Pole Features"
  (from the LOLA south-pole DEM). Odysseus (IM-1) and Athena (IM-2) use the planner's original presets.

## Maps and place search (Observe from Earth)

- **OpenStreetMap** map tiles, © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright.
  The attribution is shown on the map.
- **Photon** geocoder by Komoot (https://photon.komoot.io), using OpenStreetMap data.
- **timezonefinder** (MIT), for the offline time-zone lookup.

## Libraries loaded from CDNs (not stored in this repository)

- **Three.js** 0.160 (MIT), from cdn.jsdelivr.net
- **Leaflet** 1.9.4 (BSD-2-Clause), from cdnjs.cloudflare.com
- **Inter** font (SIL Open Font License 1.1), from Google Fonts

## Drawn in code (no third-party images)

The Earth seen from the Moon, the regolith ground detail, the star field, the Sun glow and the simplified
Moon fallback are all generated procedurally in `simulation3d/web/js/scene/common.js`.

## Bundled NASA Moon color map

NASA Scientific Visualization Studio / Ernie Wright, *CGI Moon Kit* (SVS ID 4720), 2025 color map derived from LRO/LROC data. The 2K JPEG is included unmodified. See [source and full credits](https://svs.gsfc.nasa.gov/4720/) and [SVS reuse policy](https://svs.gsfc.nasa.gov/help/). It is used for appearance only, not for ground elevations or visibility calculations. The separate local QuickMap exports remain excluded.
