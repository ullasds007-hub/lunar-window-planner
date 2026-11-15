# Project layout and release hygiene

The deployed application starts at `app.main:app`. Keep that import path and
existing URL paths stable; the Render start command and public links use them.

| Path | Role |
| --- | --- |
| `app/main.py` | Combined FastAPI application and page routing |
| `app/routers/`, `app/services/` | Lunar HTTP handlers and astronomy calculations |
| `app/templates/`, `app/static/` | Public page markup and public browser assets |
| `api.py`, `moon_observation.py` | Earth-observation API and calculation code |
| `user-guide/` (on the current release branch) | User-facing tutorial |
| `tests/`, `validation/tests/` | Python product checks and JavaScript validation tests |
| `charts/`, `validation/` | Chart and validation modules |
| `lunar-surface/lunar-surface-live/` | Standalone lunar planner and the data setup script used by the combined app |
| `docs/` | Maintainer notes |

`combined_app.py` and the older standalone pages are retained for compatibility.
Do not remove or move legacy files without checking callers; in particular,
`prepare_combined.py` still invokes the standalone data-preparation script.

## Local data and secrets

Generate the astronomy data with `python prepare_combined.py`. Do not commit
kernels, partial downloads, cached bytecode, or local ZIP backups. To share a
source snapshot, make an archive of committed files rather than zipping the entire
checkout (which would include `.git` and ignored files).

Public astronomy inputs in the existing planner do not require a private API key.
If a later feature needs one, configure it in the server environment (Render's
Environment settings in production) and read it in server-side Python. Never put
secrets in `app/static/`, templates, browser JavaScript, URLs, screenshots, or
example files. `.gitignore` does not protect files already tracked by Git. If a
credential is exposed, revoke or rotate it first and coordinate cleanup with the
repository owner. Do not publish `.git` as part of a source ZIP.

## Adding the simulations

Start the simulation branch from current `main`. Keep browser code and public
models in a dedicated `app/static/simulations/` folder if that fits the
implementation. Keep simulation controls separate from the production calculation
paths and label illustrative visuals as such. Review model/asset licenses and
bundle sizes before committing. Keep existing planner routes and share links
working. Test locally and open a pull request; update the main README after
merging the simulation so it describes features that are actually available.
