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
