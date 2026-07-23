#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Analyze a Perfherder / perf.compare comparison.

FILE is a JSON file previously saved by fetch.py -- a flat list of
comparison rows with the rich per-row fields perf.compare's own UI computes
server-side (direction_of_change, is_meaningful, cliffs_delta,
mann_whitney_test, base_standard_stats, ...).

By default this prints a quick pass using those fields (delta_percentage,
direction_of_change, is_meaningful, is_confident) -- the same signal the
perf.compare UI itself highlights, and sufficient for most "what changed"
questions.

Pass --stats for a second, heavier pass: exact Mann-Whitney U p-values
recomputed from the raw per-run data. Even with test_version=mann-whitney-u
(what fetch.py requests), Treeherder's own returned p-value (and
cliffs_delta) is rounded to 2 decimals, hiding how close a borderline result
really is to a defensible threshold -- recomputing from base_runs/new_runs
recovers that precision. This pass also applies a Benjamini-Hochberg FDR
correction jointly across every computable comparison in the file (a single
try push tests dozens to hundreds of metrics at once, so an uncorrected
per-metric p<0.05 is weaker evidence than it looks). Reach for --stats when a
flagged result is borderline, disputed, or about to be reported as
"real"/"not real" -- not as the default first thing to run.
"""

import argparse
import json
import math
import sys
from collections import defaultdict


def mannwhitney_p(base, new):
    """Two-sided Mann-Whitney U p-value via normal approximation with tie correction.

    Returns None if either sample is empty or has zero variance in ranks
    (e.g. all-identical values), since no exact/approximate p-value is
    meaningful in that case.
    """
    n1, n2 = len(base), len(new)
    if n1 == 0 or n2 == 0:
        return None
    combined = sorted([(v, 0) for v in base] + [(v, 1) for v in new])
    ranks = [0.0] * len(combined)
    i = 0
    while i < len(combined):
        j = i
        while j < len(combined) and combined[j][0] == combined[i][0]:
            j += 1
        avg_rank = (i + 1 + j) / 2.0
        for k in range(i, j):
            ranks[k] = avg_rank
        i = j
    r1 = sum(r for r, (_v, g) in zip(ranks, combined) if g == 0)
    u1 = r1 - n1 * (n1 + 1) / 2.0
    u2 = n1 * n2 - u1
    u = min(u1, u2)
    mu = n1 * n2 / 2.0
    tie_counts = defaultdict(int)
    for v, _g in combined:
        tie_counts[v] += 1
    n = n1 + n2
    tie_term = sum(t**3 - t for t in tie_counts.values())
    denom = n * (n - 1)
    if denom == 0:
        return None
    variance_factor = (n + 1) - tie_term / denom
    if variance_factor <= 0:
        return None
    sigma = math.sqrt(n1 * n2 / 12.0 * variance_factor)
    if sigma == 0:
        return None
    z = (u - mu + 0.5) / sigma if u < mu else (u - mu - 0.5) / sigma
    return 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))


def trimmed_delta_pct(base, new, trim=1):
    """Delta% between trimmed means, dropping `trim` highest and lowest values
    from each side. Large drops between the untrimmed and trimmed delta mean
    a result is outlier-driven rather than a consistent shift.
    """

    def trimmed_mean(xs):
        xs = sorted(xs)
        if len(xs) > 2 * trim:
            xs = xs[trim : len(xs) - trim]
        return sum(xs) / len(xs)

    if len(base) <= 2 * trim or len(new) <= 2 * trim:
        return None
    b, n = trimmed_mean(base), trimmed_mean(new)
    if b == 0:
        return None
    return (n - b) / b * 100


def row_key(r):
    return (r.get("suite"), r.get("platform"), r.get("test"))


def fmt_quick_row(r):
    base_mean = (r.get("base_standard_stats") or {}).get("mean")
    new_mean = (r.get("new_standard_stats") or {}).get("mean")
    parts = [
        r.get("suite"),
        r.get("test"),
        r.get("platform"),
        f"delta%={r.get('delta_percentage')}",
        f"direction={r.get('direction_of_change')}",
        f"meaningful={r.get('is_meaningful')}",
        f"confident={r.get('is_confident')}",
        f"base_mean={base_mean}",
        f"new_mean={new_mean}",
    ]
    if r.get("more_runs_are_needed"):
        parts.append("MORE_RUNS_NEEDED")
    return " | ".join(str(p) for p in parts)


def analyze(rows):
    results = []
    for r in rows:
        base, new = r.get("base_runs"), r.get("new_runs")
        exact_p = mannwhitney_p(base, new) if base and new else None
        trimmed = trimmed_delta_pct(base, new) if base and new else None
        results.append(
            {
                "row": r,
                "key": row_key(r),
                "exact_p": exact_p,
                "trimmed_delta_pct": trimmed,
            }
        )
    return results


def bh_correct(results, fdr):
    """Attach a `bh_significant` bool to every result with a computable p-value,
    via Benjamini-Hochberg across all of them jointly.

    Standard BH procedure: sort ascending by p-value; find the LARGEST rank k
    such that p_(k) <= (k/m)*fdr; reject the null (mark significant) for every
    rank <= k. This is not the same as scanning and stopping at the first
    failure -- a later, larger rank can satisfy the threshold even if some
    smaller rank in between did not, and it is still the correct cutoff.
    """
    with_p = [x for x in results if x["exact_p"] is not None]
    m = len(with_p)
    ordered = sorted(with_p, key=lambda x: x["exact_p"])
    k_max = 0
    for idx, x in enumerate(ordered):
        rank = idx + 1
        threshold = (rank / m) * fdr if m else 0
        x["bh_rank"] = rank
        x["bh_threshold"] = threshold
        if x["exact_p"] <= threshold:
            k_max = rank
    for idx, x in enumerate(ordered):
        x["bh_significant"] = (idx + 1) <= k_max
    return m


def fmt_row(x, base_p_field=True):
    r = x["row"]
    p = x["exact_p"]
    p_str = f"{p:.5f}" if p is not None else "n/a"
    parts = [
        r.get("suite"),
        r.get("test"),
        r.get("platform"),
        f"delta%={r.get('delta_percentage')}",
        f"direction={r.get('direction_of_change')}",
        f"cliffs_delta={r.get('cliffs_delta')} ({r.get('cliffs_interpretation')})",
    ]
    if base_p_field:
        parts.append(f"exact_p={p_str}")
        if "bh_significant" in x:
            parts.append(f"bh_sig={x['bh_significant']}")
    if x.get("trimmed_delta_pct") is not None:
        parts.append(f"trimmed_delta%={x['trimmed_delta_pct']:.2f}")
    return " | ".join(str(p) for p in parts)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "file",
        help="Path to a JSON file previously saved by fetch.py.",
    )
    parser.add_argument(
        "--metric",
        help="Case-insensitive substring to filter test names (e.g. TotalTime). If given, the quick "
        "pass prints every matching row (not just Perfherder-flagged ones) so you see the full picture "
        "for the metric the user actually asked about.",
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Run the heavier second pass: exact Mann-Whitney p-values recomputed from raw run data, "
        "a Benjamini-Hochberg correction across every computable comparison in the file, and "
        "trimmed-mean deltas to check for outlier-driven results. Off by default -- use it when a "
        "quick-pass result is borderline, disputed, or you're about to state it's statistically real.",
    )
    parser.add_argument(
        "--fdr",
        type=float,
        default=0.05,
        help="Benjamini-Hochberg FDR threshold across ALL computable comparisons in the file (default 0.05). "
        "Only used with --stats.",
    )
    parser.add_argument(
        "--dump-runs",
        action="store_true",
        help="Dump sorted raw base/new run values for flagged rows, to check by eye whether a shift is a "
        "clean separation or outlier-driven. Only used with --stats.",
    )
    args = parser.parse_args(argv)

    with open(args.file, encoding="utf-8") as f:
        rows = json.load(f)

    total = len(rows)
    tests = sorted(set(r.get("test") for r in rows))
    print(f"Loaded {total} comparison rows across {len(tests)} distinct test metrics.")
    print()

    if args.metric:
        needle = args.metric.lower()
        focus_rows = [r for r in rows if needle in (r.get("test") or "").lower()]
        print(f"=== Quick pass: rows matching '{args.metric}' ({len(focus_rows)}) ===")
        for r in focus_rows:
            print(fmt_quick_row(r))
        print()
        other_rows = [r for r in rows if r not in focus_rows]
    else:
        other_rows = rows

    flagged = [r for r in other_rows if r.get("direction_of_change") in ("regression", "improvement")]
    label = "other Perfherder-flagged rows (direction_of_change=regression/improvement)" if args.metric else "Perfherder-flagged rows (direction_of_change=regression/improvement)"
    print(f"=== Quick pass: {label} ({len(flagged)}) ===")
    for r in sorted(flagged, key=lambda r: (r.get("suite") or "", r.get("test") or "")):
        print(fmt_quick_row(r))
    print()

    meaningful_only = [
        r for r in other_rows if r.get("is_meaningful") and r.get("direction_of_change") not in ("regression", "improvement")
    ]
    if meaningful_only:
        print(
            f"({len(meaningful_only)} further rows cross Perfherder's magnitude-only 'is_meaningful' bar "
            "but weren't called a regression/improvement -- usually near-zero-count metrics where a tiny "
            "absolute change produces a large percentage. Not printed by default; ask if you want them.)"
        )
        print()

    if not args.stats:
        print(
            "Quick pass only (Perfherder's own fields). Rerun with --stats for exact p-values, a "
            "multiple-comparisons correction across the whole file, and outlier-robustness checks -- "
            "worth it if a result above is borderline, disputed, or about to be reported as statistically real."
        )
        return

    print("=" * 78)
    print("Second pass (--stats): exact p-values, BH correction, effect-size cross-check")
    print("=" * 78)
    print()

    results = analyze(rows)
    m = bh_correct(results, args.fdr)
    with_p = sum(1 for x in results if x["exact_p"] is not None)
    print(f"{with_p} of {total} rows have a computable Mann-Whitney p-value.")
    print(
        f"Benjamini-Hochberg correction applied jointly across all {m} computable comparisons "
        f"at FDR={args.fdr}."
    )
    print()

    if args.metric:
        needle = args.metric.lower()
        focus = [x for x in results if needle in (x["row"].get("test") or "").lower()]
        focus.sort(key=lambda x: (x["exact_p"] is None, x["exact_p"]))
        print(f"=== Focus metric matching '{args.metric}' ({len(focus)} rows, sorted by exact p) ===")
        for x in focus:
            print(fmt_row(x))
            if args.dump_runs and x["row"].get("base_runs") and x["row"].get("new_runs"):
                print(f"    base_runs: {sorted(x['row']['base_runs'])}")
                print(f"    new_runs:  {sorted(x['row']['new_runs'])}")
        print()

    survivors = [x for x in results if x.get("bh_significant")]
    survivors.sort(key=lambda x: x["exact_p"])
    print(f"=== BH-significant across ALL {m} computable comparisons (FDR={args.fdr}): {len(survivors)} ===")
    for x in survivors:
        print(fmt_row(x))
        if args.dump_runs and x["row"].get("base_runs") and x["row"].get("new_runs"):
            print(f"    base_runs: {sorted(x['row']['base_runs'])}")
            print(f"    new_runs:  {sorted(x['row']['new_runs'])}")
    print()

    moderate_plus = {"moderate", "large"}
    effect_flagged = [
        x
        for x in results
        if not x.get("bh_significant")
        and (x["row"].get("cliffs_interpretation") or "").lower() in moderate_plus
    ]
    effect_flagged.sort(key=lambda x: (x["exact_p"] is None, x["exact_p"]))
    print(f"=== Moderate/large Cliff's delta NOT surviving BH correction: {len(effect_flagged)} ===")
    print(
        "These failed the corrected significance bar but have a real effect size; check "
        "trimmed_delta% and (with --dump-runs) the raw run arrays before dismissing as noise -- "
        "a consistent rank shift across most runs is stronger evidence than a bare p-value."
    )
    for x in effect_flagged:
        print(fmt_row(x))
        if args.dump_runs and x["row"].get("base_runs") and x["row"].get("new_runs"):
            print(f"    base_runs: {sorted(x['row']['base_runs'])}")
            print(f"    new_runs:  {sorted(x['row']['new_runs'])}")


if __name__ == "__main__":
    sys.exit(main())
