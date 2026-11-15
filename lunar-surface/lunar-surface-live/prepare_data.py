"""Download the astronomy files needed by the Lunar Surface Planner."""
from pathlib import Path

from skyfield.api import Loader


def main():
    app_dir = Path(__file__).resolve().parent
    ephemeris = Loader(str(app_dir / "data" / "ephemeris"))
    orientation = Loader(str(app_dir))

    ephemeris.download("de440s.bsp") if not ephemeris.exists("de440s.bsp") else None

    for filename in (
        "moon_080317.tf",
        "pck00008.tpc",
        "moon_pa_de421_1900-2050.bpc",
    ):
        if not orientation.exists(filename):
            orientation.download(filename)

    print("Ready: the ephemeris and all three lunar orientation files are present.")


if __name__ == "__main__":
    main()
