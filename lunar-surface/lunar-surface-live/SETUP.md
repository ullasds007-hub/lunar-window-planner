# Run the Lunar Surface Planner locally

The astronomy data is not included in Git. Get the `data/` folder from
the tested `lunar-surface-live` bundle and copy it next to this folder's
`api.py`. Keep the folder structure intact.

From the repository root, run:

    cd lunar-surface/lunar-surface-live
    python -m pip install -r requirements.txt
    python -m uvicorn api:app --port 8002

Keep the terminal open and visit http://127.0.0.1:8002/.
If port 8002 is already in use, replace `8002` with `8003` in both
the command and the browser address.

## Quick check

Set the time range to November 20, 2026 at 00:00 through November 24,
2026 at 00:00 UTC. At latitude 0 and longitude 0, expect 96 hours of
sunlight and Earth visibility together. Change only longitude to 180
and expect no overlap.

This is a smoke test, not a validation of exact event times. The
planner assumes a smooth horizon and does not guarantee radio contact.

## First calculation

The first calculation may need internet access even after you copy `data/`.
In the clean-checkout test, the planner downloaded `moon_080317.tf`,
`pck00008.tpc`, and `moon_pa_de421_1900-2050.bpc`.

Run one calculation before the demo. If you plan to present offline,
disconnect from the network and verify that a calculation still works.
