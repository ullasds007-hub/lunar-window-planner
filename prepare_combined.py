"""Prepare the astronomy data for both planners."""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SURFACE = ROOT / "lunar-surface" / "lunar-surface-live"
KERNEL = Path("data/ephemeris/de440s.bsp")


def main():
    earth = ROOT / KERNEL
    lunar = SURFACE / KERNEL

    if earth.is_file() and not lunar.exists():
        lunar.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(earth, lunar)

    subprocess.run([sys.executable, str(SURFACE / "prepare_data.py")], check=True)

    if not earth.exists():
        earth.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(lunar, earth)

    print("Ready: astronomy data prepared for both planners.")


if __name__ == "__main__":
    main()
