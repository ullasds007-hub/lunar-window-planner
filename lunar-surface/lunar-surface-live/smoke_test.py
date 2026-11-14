"""Run against an already-running Lunar Surface Planner server."""
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8002").rstrip("/")
START = "2026-11-20T00:00:00Z"
END = "2026-11-24T00:00:00Z"


def request(path):
    try:
        with urlopen(BASE + path, timeout=60) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()


def windows(lat, lon, start=START, end=END):
    query = urlencode(dict(lat=lat, lon=lon, start=start, end=end))
    return request("/surface-windows?" + query)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    status, page = request("/")
    require(status == 200 and b"Lunar Surface Planner" in page,
            f"Expected Lunar Surface Planner at {BASE}; got HTTP {status}.")
    print("PASS: lunar-surface page loads")

    results = []
    for label, lon in (("near side", 0), ("far side", 180)):
        status, body = windows(0, lon)
        require(status == 200, f"{label}: HTTP {status}: {body[:300]!r}")
        payload = json.loads(body)
        require(isinstance(payload, dict) and payload,
                f"{label}: expected a nonempty JSON object")
        results.append(payload)
        print(f"PASS: {label} returns JSON")

    require(results[0] != results[1], "Near- and far-side responses are identical.")
    print("PASS: changing lunar longitude changes the response")

    status, body = windows(0, 0, END, START)
    require(400 <= status < 500,
            f"Expected API to reject reversed dates; got HTTP {status}: {body[:300]!r}")
    print("PASS: API rejects reversed dates")

    status, body = windows(0, 0)
    require(status == 200 and json.loads(body) == results[0],
            "Valid request did not return the original result after the error.")
    print("PASS: API recovers after an invalid request")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, URLError, ValueError, TimeoutError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
