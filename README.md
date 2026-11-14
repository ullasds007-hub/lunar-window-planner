# Lunar Window Planner

Lunar Window Planner brings two astronomy tools together on one local website. Use the **Earth Observation Planner** to find Moon-viewing or dark-sky windows from Earth. Use the **Lunar Surface Planner** to estimate when a site on the Moon has sunlight, darkness, or Earth in view. The surface planner also shows when sunlight and Earth visibility overlap and lets you export the intervals as a CSV.

## Quick start: Run both planners

Install Python 3.12 if you don’t already have it. From the repository root, run:

```bash
python -m pip install -r requirements.txt -r lunar-surface/lunar-surface-live/requirements.txt tzdata
python prepare_combined.py
python -m uvicorn combined_app:app --port 8005
```

The first setup needs internet access to install dependencies and download the astronomy data. You don’t need to copy a `data/` folder from another checkout. Keep the downloaded astronomy files out of Git.

Keep the server terminal open and visit [http://127.0.0.1:8005/](http://127.0.0.1:8005/) for the Earth planner. Click **Open the Lunar Surface Planner**, or go directly to [http://127.0.0.1:8005/lunar-surface/](http://127.0.0.1:8005/lunar-surface/). Keep the trailing slash on the lunar address. Press **Ctrl+C** in the server terminal to stop it.

## Try both planners

**Earth observation:** Choose **Mysuru** and **Moon viewing**. Set the dates to **November 20–22, 2026**, then click **Find Windows**. Expect three viewing windows, displayed in the location’s local time.

**Lunar surface:** Enter latitude `0` and longitude `0`. Set the range from **November 20, 2026 at 00:00 UTC** to **November 24, 2026 at 00:00 UTC**, then click **Show timeline**. Expect **96 hours** of sunlight and Earth visibility together. Change only longitude to `180` and run it again. Expect **no overlap**. Use **Export intervals (CSV)** to save the calculated intervals.

## Run the lunar smoke test

With the combined server running, open a second terminal at the repository root and run:

```bash
python lunar-surface/lunar-surface-live/smoke_test.py http://127.0.0.1:8005/lunar-surface
```

The smoke test checks that the page loads, the API responds for both lunar sites, reversed dates are rejected, and valid requests still work afterward. It does not independently validate the exact timing of astronomical events.

## Model limits

The Earth planner does not account for weather. The lunar planner assumes a smooth horizon and does not model local terrain or terrain shadows. **Earth in view** means Earth is above the modeled horizon; it does not guarantee radio contact. The results are planning estimates, not mission guarantees.

For standalone launch instructions and offline demo checks, see the [Lunar Surface Planner setup guide](lunar-surface/lunar-surface-live/SETUP.md).