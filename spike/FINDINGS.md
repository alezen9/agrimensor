# Phase 4 findings: timestamp behaviour on real hardware

Run with `npm run spike`. Machine: Apple Silicon macOS, Chrome for Testing 151 via Playwright,
Dawn on Metal.

These are observations from one backend. They are not spec guarantees, and nothing here should
be assumed true on D3D12 or Vulkan without rerunning.

---

## 1. Passes overlap, so a duration sum can be double the real GPU time

The most important finding, and it vindicates the whole reason this library exists.

Four passes in one command buffer, interleaved compute and render, measured offsets in
nanoseconds from the first pass beginning:

| Pass    | Begin   | End       |
| ------- | ------- | --------- |
| compute | 0       | 373,625   |
| render  | 36,208  | 2,676,500 |
| compute | 374,000 | 3,027,750 |
| render  | 94,208  | 5,286,333 |

Every pass starts before the previous one has finished. The second render pass begins at 94µs
while the first is still running for another 2.6ms.

```
sum of pass durations : 10.860 ms
actual wall span      :  5.286 ms
sum overstates by     :  2.05x
```

**A sum of pass durations can report more than double the GPU time actually spent**, because
overlapped time is counted once per overlapping pass. Three's `info.render.timestamp` is exactly
such a sum (`WebGPUTimestampQueryPool.js:222`), and so is stats-gl's. On a workload with
concurrent passes, those numbers do not merely mean something subtly different from wall time,
they are numerically wrong by a large factor.

This is the opposite of the failure mode the original design anticipated. The concern was that a
sum would miss gaps and therefore understate. In practice it overstates, and badly.

Control: three compute passes writing the same storage buffer produced **0** overlaps, because
the shared resource forces serialisation. Three render passes to the same target produced **2**
overlaps. So overlap depends entirely on the dependency graph, and any measurement that assumes
serial execution is unreliable.

## 2. Render and compute passes share one timeline

The overlaps above are genuine concurrency, not incomparable clocks. All four passes report
offsets inside the same 5.3ms window, on the same scale, interleaved coherently. Separate clock
domains would produce values wildly out of scale with each other.

So cross-type comparison is valid, and a span covering both render and compute passes is
meaningful.

## 3. Cross-submission timestamps are ordered and share a timeline

The question that gated Phase 5. The spec declines to promise it
([gpuweb#4361](https://github.com/gpuweb/gpuweb/issues/4361)).

Zero ordering violations across 20 rounds in both quantised and unquantised modes, for passes
split across separate `queue.submit()` calls.

Monotonicity alone is weak evidence, since two independent counters that both increase would
also pass. The stronger signal is the gap distribution: the gap between one submission's last
pass ending and the next submission's first pass beginning is 2 to 9µs, matching the gap between
two passes inside a single command buffer. Separate clock domains would produce arbitrary
cross-submission gaps instead.

Tier 3 is **not disproven** on this backend. It still ships behind a runtime validator, because
this cannot be proven and says nothing about other backends.

## 4. Chrome's quantum is 65.536µs, not the documented 100µs

Measured as the GCD of every raw timestamp value.

| Configuration                        | GCD      | Quantum   |
| ------------------------------------ | -------- | --------- |
| Default (what users get)             | 65536 ns | 65.536 µs |
| `--enable-webgpu-developer-features` | 1 ns     | none      |

65536 is 2^16, so Dawn masks off the low 16 bits rather than rounding to a decimal figure.
Chrome's documentation says "a resolution of 100 microseconds", which is approximate.

Consequence: inter-pass gaps of 2 to 9µs are invisible by default, and measured gap is exactly
zero in every round. A span only diverges from a sum through gaps when those gaps exceed roughly
65µs. Divergence through **overlap**, finding 1, is unaffected by quantisation and is far larger.

## 5. A query set holds at most 4096 queries

Hard limit, cleanly reported:

```
Query count (4097) exceeds the maximum query count (4096).
```

2048 slots is a pass budget of 1024 per set. Sizing must account for this rather than assume
unbounded growth, which is the bug Three has at `WebGPUTimestampQueryPool.js:71`.

## 6. About 32 query sets can be in flight before they go invalid

| In-flight depth | Resolved sanely |
| --------------- | --------------- |
| 8               | 8               |
| 16              | 16              |
| 24              | 24              |
| 32              | 32              |
| 40              | 32              |
| 64              | 32              |

Past 32, later query sets fail with `[Invalid QuerySet] is invalid due to a previous error`.
The probe scaled query sets and outstanding `mapAsync` calls together, so this does not isolate
which resource hit its ceiling. Either way the actionable rule is to keep in-flight
instrumentation at or below 32 and recycle rather than allocate per frame.

## 7. Reusing a query index in one command buffer is accepted silently

Encoding two passes that both write to query pair 0 produced **no validation error**. The second
write simply overwrites the first.

This matters: slot allocation cannot rely on the API to catch a bug. A double-booked index
yields a plausible but wrong number with no signal at all. Slot bookkeeping needs its own
invariant checks.

## 8. A sustained run is clean

2000 frames, two passes each, reusing one fixed query set and readback buffer:

- 0 zero or negative durations out of 4000 samples
- 0 to 1 monotonicity blips across the whole run
- no validation errors
- no growth in readback latency

Pass duration drifted between run halves (0.18ms versus 0.17ms one run, 0.245ms versus 0.345ms
another) in both directions, which is GPU frequency scaling rather than leakage. Absolute
durations are only comparable within a single run.

---

## What this changes for Phase 5

- **The span is the headline metric, not the sum.** Finding 1 shows the sum can be 2x wrong on
  overlapping workloads. The span is the only figure that answers how long the GPU actually took.
- `submittedRenderPassDurationSumInMs` still ships, because it is honest and directly comparable
  to what Three reports, but its `describe()` must state that **overlapping passes are counted
  once per pass, so this can exceed the wall-clock span**. That caveat is now evidence-backed.
- A span covering render and compute together is valid, per finding 2.
- Tier 3 ships gated behind the runtime validator.
- Every timing caveat names the real 65.536µs quantum.
- Slot allocation gets its own invariant checks, per finding 7, and a ring bounded by findings 5
  and 6.
