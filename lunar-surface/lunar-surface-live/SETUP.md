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

Set up the Earth planner's dependencies and data as usual. Then, from
the repository root, install the lunar dependencies, prepare the lunar
data, and start the combined server:

    python -m pip install -r lunar-surface/lunar-surface-live/requirements.txt
    python lunar-surface/lunar-surface-live/prepare_data.py
    python -m uvicorn combined_app:app --port 8005

Open http://127.0.0.1:8005/ for the Earth planner. Use the homepage link
to open the Lunar Surface Planner at http://127.0.0.1:8005/lunar-surface/.
Keep the trailing slash when opening the lunar page directly.

With the server running, verify the mounted lunar API from a second
terminal at the repository root:

    python lunar-surface/lunar-surface-live/smoke_test.py http://127.0.0.1:8005/lunar-surface

To run the Earth planner by itself, use the original `api:app` entry
point. Use `combined_app:app` when you want the homepage's lunar link
to work on the same server.
