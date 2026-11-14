# Run the Lunar Surface Planner locally

From the repository root, run:

    cd lunar-surface/lunar-surface-live
    python -m pip install -r requirements.txt
    python prepare_data.py
    python -m uvicorn api:app --port 8002

The first setup needs internet access to download the astronomy files.
You do not need to copy a data folder from another checkout. Keep the
downloaded files local; do not commit them.

Keep the server terminal open and visit http://127.0.0.1:8002/.
If port 8002 is busy, choose a free port and use it in the server
command, browser address, and smoke-test URL.

## Verify the setup

From the repository root in a second terminal, run:

    cd lunar-surface/lunar-surface-live
    python smoke_test.py http://127.0.0.1:8002

For a browser check, use November 20, 2026 at 00:00 through November 24,
2026 at 00:00 UTC. At latitude 0 and longitude 0, expect 96 hours of
sunlight and Earth visibility together. Change only longitude to 180
and expect no overlap.

These checks do not validate exact event times. The planner assumes a
smooth horizon and does not model local terrain or guarantee radio contact.

## Offline demo

Run a calculation while connected to confirm the setup. Before relying
on offline operation, disconnect and run a new calculation on the same
machine with the downloaded files in place.

## Run both planners on one port

From the repository root, run:

    python -m pip install -r requirements.txt -r lunar-surface/lunar-surface-live/requirements.txt tzdata
    python prepare_combined.py
    python -m uvicorn combined_app:app --port 8005

The first setup needs internet access. The script prepares the astronomy
files for both planners without downloading DE440s twice. Keep the
downloaded files local; do not commit them.

Open http://127.0.0.1:8005/ for the Earth planner. Use the homepage link
to open the Lunar Surface Planner at http://127.0.0.1:8005/lunar-surface/.
Keep the trailing slash when opening the lunar page directly.

From a second terminal at the repository root, verify the mounted lunar API:

    python lunar-surface/lunar-surface-live/smoke_test.py http://127.0.0.1:8005/lunar-surface

For a browser check of the Earth planner, choose Mysuru and Moon viewing,
set November 20–22, 2026, and click Find Windows. Expect three windows.
