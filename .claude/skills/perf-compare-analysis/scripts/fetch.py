#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Fetch a perf.compare comparison and save it as JSON.

URL is a perf.compare URL (compare-results or compare-lando-results).
`compare-lando-results` URLs use Lando landing-job IDs instead of revisions;
this resolves them via Lando's API automatically. The fetch requests
`test_version=mann-whitney-u` from Treeherder's /api/perfcompare/results/
endpoint -- the same query param perf.compare's own UI uses to compute its
richer per-row stats server-side (direction_of_change, is_meaningful,
cliffs_delta, mann_whitney_test, base_standard_stats, ...) -- so the saved
data matches what a human would see on perf.compare itself.

Save once per analysis session and pass the resulting file to analyze.py as
many times as needed (e.g. a quick pass, then a --stats deep-dive) instead of
re-fetching -- the try push's underlying data can also keep changing as more
retriggers land, so treat a saved file as a snapshot, not a live view; fetch
again if the user wants current data for the same comparison.
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36"
)
TREEHERDER_API = "https://treeherder.mozilla.org/api/perfcompare/results/"
LANDO_API = "https://api.lando.services.mozilla.com/landing_jobs/{}"


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace").strip()
        raise SystemExit(
            f"HTTP {exc.code} fetching {url}\n{body}\n"
            "(a common cause: the try push has been garbage-collected -- Treeherder only "
            "retains try data for a couple of weeks)"
        ) from None


def resolve_lando_id(lando_id):
    return fetch_json(LANDO_API.format(lando_id))["commit_id"]


def fetch_from_perf_compare_url(url):
    """Turn a perf.compare URL into the raw (rich, mann-whitney-u) Treeherder
    API response. URL query param handling mirrors
    https://github.com/padenot/perfcompare-new-stats (parse_perf_compare_url).
    """
    parsed = urllib.parse.urlparse(url)
    params = urllib.parse.parse_qs(parsed.query)

    def first(name):
        return (params.get(name) or [None])[0]

    base_repo, new_repo, framework = first("baseRepo"), first("newRepo"), first("framework")
    if not all([base_repo, new_repo, framework]):
        raise SystemExit(f"URL is missing baseRepo/newRepo/framework query params: {url}")

    if "compare-lando-results" in parsed.path:
        base_lando, new_lando = first("baseLando"), first("newLando")
        if not base_lando or not new_lando:
            raise SystemExit(f"Lando-results URL is missing baseLando/newLando: {url}")
        print(f"Resolving Lando IDs {base_lando} and {new_lando} to revisions...", file=sys.stderr)
        base_rev, new_rev = resolve_lando_id(base_lando), resolve_lando_id(new_lando)
    else:
        base_rev, new_rev = first("baseRev"), first("newRev")
        if not base_rev or not new_rev:
            raise SystemExit(
                f"Could not find baseRev/newRev (or baseLando/newLando) in URL query params: {url}"
            )

    api_url = (
        f"{TREEHERDER_API}?base_repository={base_repo}&base_revision={base_rev}"
        f"&new_repository={new_repo}&new_revision={new_rev}&framework={framework}"
        f"&no_subtests=true&test_version=mann-whitney-u"
    )
    print(f"Fetching {api_url}", file=sys.stderr)
    return fetch_json(api_url)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("url", help="A perf.compare URL (compare-results or compare-lando-results).")
    parser.add_argument("output", help="Path to write the fetched JSON to, e.g. artifacts/perf-compare.json")
    args = parser.parse_args(argv)

    rows = fetch_from_perf_compare_url(args.url)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)
    print(f"Saved {len(rows)} comparison rows to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
