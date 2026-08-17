# Measured overhead

Run with `npm run bench`. Builds the library first and imports `dist`, so these figures
describe the published artifact rather than the source.

Machine: Apple M2 Pro, 16-core GPU, Chrome for Testing 151 headless via Playwright, Dawn on
Metal. Single backend, single machine. Numbers will differ elsewhere.

## Headline

**0.013 ms of CPU per frame** on a frame with 900 draw calls, 6 render passes, 1 compute pass,
1 buffer upload and 1 submit. Against a 120fps budget of 8.33ms that is **0.16%**.

That frame is heavier than most: 900 draws is well beyond what a typical Three.js scene issues.

Agrimensor does not claim zero overhead. It claims the figures below.

## Per call

| Operation                      | Native   | Attached | Added        | Relative |
| ------------------------------ | -------- | -------- | ------------ | -------- |
| `draw()`                       | 10.5 ns  | 24.5 ns  | **+14 ns**   | +133%    |
| `createBuffer()` + `destroy()` | 575 ns   | 685 ns   | **+110 ns**  | +19%     |
| `beginRenderPass()`            | 1452 ns  | 2045 ns  | **+593 ns**  | +41%     |
| `queue.submit()`               | 18720 ns | 20620 ns | **+1900 ns** | +10%     |

The relative column looks alarming and the absolute column is the one that matters. A draw call
costs 10 nanoseconds natively, so wrapping it in a counter roughly doubles a very small number.
At 900 draws per frame the total added cost is 12.6µs.

`beginRenderPass` carries the largest per-call cost because it copies the descriptor rather than
mutating it, which is deliberate: engines reuse descriptor objects between frames, so mutating
one would corrupt the caller's state. Six passes per frame makes that 3.6µs.

`queue.submit` gains 1.9µs, but agrimensor also adds **one extra submit per frame** to resolve
timestamps, which is the single largest component of the per-frame figure.

## Method

Each case runs 15 repeats and reports the **fastest**, not the median. Scheduling noise and
driver contention only ever add time, so the minimum is the least polluted sample.

This was not a cosmetic choice. Using the median, driver variance was large enough to report
`beginRenderPass` as 15% _faster_ when patched, which is impossible. Observed spread between the
slowest and fastest repeat reached 174ms on a 29ms measurement, so any single sample is
untrustworthy.

The frame figure times 300 consecutive frames and divides, after 60 warmup frames. Per-frame
sampling was tried first and produced exactly 0.1ms and 0.2ms, which are artefacts of the
browser clamping `performance.now()` to 100µs, the same order as the quantity being measured.

## Sustained behaviour

Run with `npm run soak`. Also against the built artifact, on the same machine.

**2000 frames, 3 passes each, yielding to rAF like a real loop:**

|                                  |                     |
| -------------------------------- | ------------------- |
| Frames with a resolved gpu entry | 1994 of 2000, 99.7% |
| Max `resultLagFrameCount`        | 4                   |
| Max `uninstrumentedPassCount`    | 0                   |
| Non-positive executions          | 0                   |
| Mean execution, first quarter    | 0.0264 ms           |
| Mean execution, last quarter     | 0.0257 ms           |
| Comparability lost               | never               |

The lag is bounded at 4, which is the region count, so regions recycle rather than accumulate.
Execution does not drift between the first and last quarter, so nothing leaks over a long run.

**200 frames of 80 passes, deliberately past the 64 slot per region budget:**

`uninstrumentedPassCount` reported exactly 16, which is 80 minus 64. Exceeding the budget is
reported rather than silently dropped, and the frames still resolved at 99%. This is the failure
mode Three has at `WebGPUTimestampQueryPool.js:71`, where instrumentation quietly stops.

**500 frames with no yield to the event loop at all:**

No gpu entry on any frame, no error, comparability retained. `mapAsync` cannot resolve without
the event loop, so all four regions stay pending and nothing can be instrumented. A render loop
that never yields therefore gets no GPU timing. Real loops driven by `requestAnimationFrame`
always yield, so this is a synthetic edge, but it is the mechanism behind a stalled
`resultLagFrameCount`.

## What is not measured

- Timestamp readback. `mapAsync` resolves off the measured path, so its callback cost is not in
  these figures. The resolve encode and submit are, since they happen inside `beginRenderFrame()`.
- GPU-side cost. Agrimensor adds one small resolve and copy per frame. It has not been measured
  against GPU time.
- Memory. The resource registry holds a small record per live resource, unmeasured here.
- Any backend other than Metal.
