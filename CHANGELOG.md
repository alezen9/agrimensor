# Changelog

Metric names and semantics may still change before `0.1.0`. A metric whose meaning turns out to
be wrong gets corrected or removed rather than preserved, since a stable lie is worse than a
breaking correction in a measurement library.

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
