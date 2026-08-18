# Changelog

A metric whose meaning turns out to be wrong gets corrected or removed rather than preserved,
since a stable lie is worse than a breaking correction in a measurement library. This is 0.x, so
such a correction lands in a minor version with an entry here.

## 0.1.0

First release outside the alpha line. No metric changed its name or meaning; the entries below
are the history of how these figures arrived at their current definitions.

- README rewritten as a reference. It now shows the full `snapshot()` shape with a line on every
  field, collects every caveat into one section, and lists the whole API. It previously described
  none of the 22 metrics it exposes.
- A prerelease now takes the npm `latest` tag while no stable release holds it, so a plain
  install stopped resolving to the very first alpha. From here `latest` is a stable version and
  prereleases go back to publishing under their own identifier.

## 0.1.0-alpha.8

- `attach()` takes optional `onResourceCreated` and `onResourceDestroyed` hooks. `largestResources()`
  answers which allocation is big; on an engine you did not write, the next question is which line
  asked for it, and the only moment that answer exists is the call itself. Both hooks receive the
  same `ResourceEntry` the totals report, so an origin recorded at creation joins to a reading taken
  later by `id`. Agrimensor captures no stacks and stores nothing of its own: what to capture and how
  long to hold it is policy, and a measurement library that decides policy stops being one.
- The destroy hook exists so a consumer keying anything by `id` can prune it. There is no way to ask
  which ids are still live, so without it the documented pattern would grow without bound. It fires
  only for an explicit `destroy()`, which is the same limit the live totals already have.
- A hook that throws cannot reach the call that fired it, matching the containment `alpha.6` gave the
  timing path.
- `destroy()` is documented. It was public and unmentioned.
- Corrected the published size figures, which had drifted about 1 kB, and the one line that said
  metric names were unstable before `1.0.0` where everything else says `0.1.0`.

## 0.1.0-alpha.7

- Documented the correction policy: a metric whose meaning turns out to be wrong gets corrected or
  removed rather than preserved.

## 0.1.0-alpha.6

- Agrimensor's own failures can no longer reach the caller. A fault while encoding the timestamp
  resolve, such as a lost device, previously threw out of `beginRenderFrame()` and into the
  render loop. Timing now stops producing figures, `gpu` goes undefined, and later frames keep
  trying in case the fault was transient.
- Enforced bundle size budget in CI.

## 0.1.0-alpha.5

- `ResourceEntry` gained `id`, `usage`, `sampleCount` and `mipLevelCount`. The id is stable for
  the life of a resource and never reused, so identical textures are distinguishable, a keyed
  list is safe, and "still alive" can be told from "allocated again".
- README gained a three.js section covering the two traps: reaching the device through
  `renderer.backend`, and why handing three your own device silently loses adapter features.
- README states what `snapshot()` costs, and both bundle figures.

## 0.1.0-alpha.4

- `largestResources(count)` for attribution, deliberately outside `snapshot()` so the per-frame
  path stays cheap.
- Measured overhead published: 0.013 ms of CPU per frame on a 900-draw frame.
- Sustained soak over 2000 real frames: regions recycle, lag stays bounded, nothing drifts.

## 0.1.0-alpha.3

- Corrected the clock-scaling caveat, which stated an inferred figure as measured.
- Every `frame.*` and `gpu.*` metric now says it describes a single frame and is not an average.
  Sampling on a timer reads an arbitrary frame, which produced two false bug reports.
- `capabilities` returns a fresh frozen object per read, so reactive state sees changes.

## 0.1.0-alpha.2

- `confidence` no longer rated the overlap-inflated duration sums above the figure that answers
  the question. Both sums are `derived`, and `MetricDefinition` gained `preferInstead`.
- Cross-submission plausibility is no longer a permanent latch. It takes a sustained run of
  implausible readings to give up, and any plausible reading clears it.
- Uninstrumented passes are counted against the frame that owns them.

## 0.1.0-alpha.1

- GPU pass timing: per-pass duration sums, execution as merged non-overlapping intervals, gap,
  result lag and uninstrumented pass count.
- Async pipeline creation is counted, which three uses under `compileAsync`.
- `frame.gpuSubmissionCount` exposed.

## 0.1.0-alpha.0

- First publish: interception spine, resource accounting with a full WebGPU format table,
  per-frame work counters, transfer bytes, and `describe()` for every metric.
