---
name: perf-compare-analysis
description: Statistically analyze a Perfherder / perf.compare try-vs-base performance comparison, fetched live from a perf.compare URL (e.g. https://perf.compare/compare-results?... or compare-lando-results?...). Use when the user shares a perf.compare URL and asks to flag regressions/improvements, check whether a perf change is real, or assess statistical significance of a try push's performance results. Trigger on phrases like "perf compare", "perf.compare", "is this regression real", "flag perf changes", or when a perf.compare URL is shared.
argument-hint: "[perf.compare URL] [optional: metric name to focus on]"
allowed-tools:
  - Bash(py .claude/skills/perf-compare-analysis/scripts/fetch.py:*)
  - Bash(python3 .claude/skills/perf-compare-analysis/scripts/fetch.py:*)
  - Bash(python .claude/skills/perf-compare-analysis/scripts/fetch.py:*)
  - Bash(py .claude/skills/perf-compare-analysis/scripts/analyze.py:*)
  - Bash(python3 .claude/skills/perf-compare-analysis/scripts/analyze.py:*)
  - Bash(python .claude/skills/perf-compare-analysis/scripts/analyze.py:*)
  - Read
  - Grep
  - Glob
---

# Perf compare analysis

You are helping a Firefox engineer interpret a perf.compare/Perfherder try-vs-base
comparison. A single comparison covers dozens to hundreds of suite/platform/test
combinations at once, and Perfherder's own significance flags (`is_meaningful`,
`direction_of_change`) are based on magnitude thresholds, not corrected p-values.
Two things go wrong if you just eyeball `delta_percentage` and `direction_of_change`:

1. **Multiple comparisons.** A single comparison easily covers 300+ testable
   metrics. At an uncorrected alpha=0.05, chance alone produces roughly 5% of
   them as "significant" - that can be more false positives than real ones.
2. **Rounding.** Treeherder rounds the returned p-value (and Cliff's delta) to
   2 decimals server-side, which hides how far (or close) a result actually is
   from a defensible threshold.

This applies to any Perfherder/perf.compare comparison, for any test suite (JS
benchmarks, page load, accessibility, mobile, etc.) - nothing about the tool or
the workflow below is specific to one subsystem. The comparison shape
(`suite`/`platform`/`test`/`base_runs`/`new_runs`/...) is the same regardless of
what the tests measure.

## Getting the data

Ask the user for a **perf.compare URL** - that's the only input they need to
give you; don't ask them to download/export a JSON file themselves. Under the
hood this is a two-script pipeline: `fetch.py` turns the URL into a JSON file,
and `analyze.py` reads that file. Fetch **once per analysis session** and
reuse the saved file for every `analyze.py` call that follows (quick pass,
then maybe `--stats`, then maybe a `--metric` recheck) - don't re-fetch just
because you're running the script again on the same comparison.

```
py .claude/skills/perf-compare-analysis/scripts/fetch.py <perf.compare-url> artifacts/perf-compare.json
```

Save into `artifacts/` (create it if it doesn't exist) per this repo's usual
convention for command output; pick a more specific filename than shown here
if you expect to compare more than one push in the same conversation.

`fetch.py` accepts URLs like:

```
https://perf.compare/compare-results?baseRev=<rev>&newRev=<rev>&baseRepo=try&newRepo=try&framework=<id>
https://perf.compare/compare-lando-results?baseLando=<id>&newLando=<id>&baseRepo=try&newRepo=try&framework=<id>
```

(`compare-lando-results` URLs use Lando landing-job IDs instead of revisions;
it resolves them via Lando's API automatically.) It requests
`test_version=mann-whitney-u`, the same parameter perf.compare's own UI uses,
so the fetched data has the same rich fields (`cliffs_delta`,
`mann_whitney_test`, `direction_of_change`, ...) the perf.compare UI itself
shows.

If the URL points at an old/GC'd try push, Treeherder returns an HTTP 400 with
a plain-text reason (e.g. "No new push with revision ... from repo try.") -
`fetch.py` surfaces that message directly; relay it to the user rather than
guessing what went wrong, and suggest checking whether the push still exists
on Treeherder or getting a fresher URL.

Treat a saved file as a snapshot, not a live view - the try push's underlying
data can keep changing as more retriggers land. If the user comes back later
in the same conversation wanting current numbers for the same comparison,
re-run `fetch.py` rather than assuming the old file is still accurate.

## Workflow

Both scripts are invoked as `<python-launcher> .claude/skills/perf-compare-analysis/scripts/<script>.py ...`.
`py`, `python3`, and `python` are all pre-approved in this skill's
`allowed-tools` for both `fetch.py` and `analyze.py`, so none of them should
need a separate permission prompt - but only one of them is likely to
actually be on PATH for a given user, and guessing wrong just wastes a round
trip. Don't default to any one of them blindly:

- Check the user's own CLAUDE.md/AGENTS.md first for an explicit convention
  (e.g. this user's global instructions say to always use `py` on Windows).
- Otherwise check what's actually resolvable in the current environment
  (e.g. `command -v py python3 python` in Bash, or the PowerShell equivalent)
  before picking.
- The examples below use `py` because that's what resolves in this
  environment; substitute whichever launcher you've confirmed for the
  environment you're actually in.

0. **Fetch once** (see "Getting the data" above):

   ```
   py .claude/skills/perf-compare-analysis/scripts/fetch.py <perf.compare-url> artifacts/perf-compare.json
   ```

1. **Quick pass first.** Run `analyze.py` against the saved file with no
   extra flags beyond `--metric`:

   ```
   py .claude/skills/perf-compare-analysis/scripts/analyze.py artifacts/perf-compare.json --metric <focus-metric>
   ```

   `--metric` is a case-insensitive substring match on the `test` field (e.g. the
   user's primary metric of interest). Omit it to see only the file-wide
   Perfherder-flagged rows. This prints every row matching `--metric` plus every
   other row Perfherder itself calls a `regression`/`improvement`
   (`direction_of_change`), using its own stored fields as-is (no recomputation).
   This is cheap and is sufficient for most "what changed" questions - it's the
   same signal the perf.compare UI itself highlights.

2. **Reach for `--stats` only when a quick-pass result needs scrutiny** - it's
   borderline, disputed, the user asks about statistical significance directly,
   or you are about to assert a result is (or isn't) real. Re-run `analyze.py`
   against the *same saved file* (no need to `fetch.py` again) with `--stats`
   (and optionally `--dump-runs`):

   ```
   py .claude/skills/perf-compare-analysis/scripts/analyze.py artifacts/perf-compare.json --metric <focus-metric> --stats --dump-runs
   ```

   This recomputes exact Mann-Whitney U p-values from `base_runs`/`new_runs`
   (Treeherder's own returned value is rounded to 2 decimals, which hides how
   close a borderline result really is) and applies a Benjamini-Hochberg FDR correction
   *jointly across every computable comparison in the file* - not just within
   one metric, since a single try push tests dozens to hundreds of metrics at
   once. It reuses Perfherder's own `cliffs_delta`/`cliffs_interpretation`
   fields for effect size rather than recomputing them. `--dump-runs` prints the
   sorted raw per-run arrays for flagged rows, so you can eyeball whether a
   shift is a clean separation or driven by one or two outliers (see "Judgment
   calls" below).

   Read the three `--stats` sections as: the focus-metric rows sorted by exact
   p-value; the set that survives BH correction across the whole file (the
   conservative, defensible-under-scrutiny answer); and moderate/large
   Cliff's-delta rows that *didn't* survive correction (real effect sizes that
   don't clear the corrected bar - don't silently drop these, see "Judgment
   calls").

3. Before attributing any flagged result to a specific patch, find out what
   patch/change is actually being compared (see "Causal plausibility" below) -
   don't assume it's the local repo's current `HEAD` or working diff. Then
   cross-check anything you plan to call out against what that patch actually
   touches.

## Judgment calls (don't just report the BH cutoff mechanically)

- A moderate/large Cliff's delta that misses the BH cutoff is not automatically
  noise. Cliff's delta measures how consistently every value in one sample
  outranks the other - a large effect size with a borderline p-value often means
  the shift is real but the run count (commonly n=20 per side in these exports)
  is underpowered relative to the number of simultaneous comparisons, not that
  the effect itself is fake.
- Use `--dump-runs` and look at the sorted raw arrays yourself: if nearly the
  entire "new" distribution sits above nearly the entire "base" distribution
  (bar one outlier per side), that is much stronger evidence than the p-value
  alone suggests. If instead the shift is explained by one shared extreme
  outlier in both samples (e.g. both have a single ~40% higher freak run), treat
  it as inconclusive.
- `trimmed_delta_pct` (delta between means after dropping the single highest and
  lowest run per side) is printed alongside each row precisely to help make this
  call - if it collapses to near zero, the untrimmed delta was outlier-driven.
- Conversely, statistical significance is not the same as relevance: a
  significant, BH-surviving result in a metric with a tiny practical delta (e.g.
  a count metric that only ever takes a couple of discrete values) is often not
  worth flagging prominently even though it is "real" in a narrow statistical
  sense.

## Causal plausibility

Before presenting a flagged metric as attributable to "the patch":

- **Identify what's actually being compared. Don't assume it's the local
  repo's current `HEAD` or working diff.** Each row's `base_rev` and `new_rev`
  fields name the two revisions Perfherder compared, but those
  are often try-push revisions with no corresponding local checkout, and the
  user may be analyzing someone else's push, an old push, or something
  unrelated to whatever is currently checked out. If it isn't obvious from
  context which patch/change the user wants this compared against, ask (a
  plain question, or `AskUserQuestion` if it fits the flow) rather than
  guessing - e.g. "what patch/revision is this comparison for?" Only fall back
  to inspecting the local `HEAD`/working diff if the user confirms that's the
  right one.
- Once you know the patch, check what files/directories it touches (`git show
  --stat` or equivalent) against where the flagged metric is actually
  recorded. Use `searchfox-cli` scoped to the relevant subsystem's path to
  find the instrumentation site for that metric name (a `PerfStats`
  `AutoMetricRecording`, a telemetry probe, or whatever mechanism the suite
  uses) - the path glob depends entirely on what's being tested, e.g.
  `--path 'accessible/**'` for an A11Y perf suite, `--path 'js/src/**'` for a
  SpiderMonkey benchmark, `--path 'layout/**'` for a page-load metric.
- Test/metric names sometimes encode extra context as a naming convention
  specific to that suite - e.g. Firefox's accessibility perf tests suffix
  metric names with `_parent`/`_content` to record which process the
  measurement was taken in. Don't assume any particular suffix convention
  applies generally; read the suite's own test/instrumentation code (via
  `searchfox-cli`) to learn what a given name actually encodes for *that*
  suite before treating it as a causal signal. When a suite's naming does
  reveal something like "which process/component this ran in" and the patch
  provably can't execute there, that's a strong sign the flagged result is
  noise or an unrelated confound, regardless of what the raw p-value says.
- State this reasoning explicitly to the user rather than presenting every
  BH-significant or large-effect row as equally likely to be caused by the
  patch - statistical significance establishes that a shift is probably real;
  it says nothing about *why*.

## Presenting results

Summarize for the user in prose, not a wall of raw script output:

- Lead with what the user asked about (their focus metric) if they gave one.
- State clearly which flagged results survive multiple-comparisons correction
  and which don't, and don't blur the two together.
- For anything you recommend taking seriously despite not surviving correction,
  give the concrete reason (effect size, clean distribution separation, causal
  plausibility) rather than just asserting it.
- For anything you recommend dismissing, say why (outlier-driven, causally
  implausible given what the patch touches, negligible effect size) rather than
  just citing the corrected p-value.
- If the run count is small (well under 20 per side) or `more_runs_are_needed`
  is true on rows of interest, say so and suggest retriggering rather than
  treating the current result as final.
