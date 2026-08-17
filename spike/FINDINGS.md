# Phase 4 findings: timestamp behaviour on real hardware

Run with `npm run spike`. Machine: Apple Silicon macOS, Chrome for Testing 151 via Playwright,
Dawn on Metal. 20 rounds per configuration, 4 compute passes per fixture.

These are observations from one backend. They are not spec guarantees, and nothing here should
be assumed true on D3D12 or Vulkan without rerunning.

## 1. Cross-submission timestamps are ordered, and share a timeline

The question that gated Phase 5. The spec declines to promise it
([gpuweb#4361](https://github.com/gpuweb/gpuweb/issues/4361)).

**Zero ordering violations** across every run, in both quantised and unquantised modes, for
passes split across separate `queue.submit()` calls.

Monotonicity alone would be weak evidence, since two independent counters that both increase
would also pass. The stronger signal is the **gap distribution**: the gap between one
submission's last pass ending and the next submission's first pass beginning is 2 to 9
microseconds, which matches the gap between two passes inside a single command buffer. Had each
submission carried its own clock domain, cross-submission gaps would be arbitrary rather than
indistinguishable from intra-buffer gaps.

Conclusion: Tier 3 is **not disproven** on this backend, and the evidence is better than
ordering alone. It still ships behind a runtime validator, because this cannot be proven and
says nothing about other backends.

## 2. Chrome's quantum is 65.536µs, not the documented 100µs

Measured as the GCD of every raw timestamp value.

| Configuration                        | GCD      | Quantum   |
| ------------------------------------ | -------- | --------- |
| Default (what users get)             | 65536 ns | 65.536 µs |
| `--enable-webgpu-developer-features` | 1 ns     | none      |

65536 is 2^16, so Dawn is masking off the low 16 bits rather than rounding to a decimal figure.
Chrome's own documentation says "a resolution of 100 microseconds", which is approximate. The
real granularity is 65.536µs and every reported duration is a multiple of it.

## 3. Consequence: inter-pass gaps are invisible to real users

Real gaps between passes measure 2 to 9µs, which is far below the 65.536µs quantum. In the
default configuration `gapMs` is **exactly 0 in every round**, because both boundaries snap to
the same multiple.

This is the most important design consequence found. A pass span metric only differs from a
duration sum when the real gap exceeds roughly 65µs. For tightly packed passes the two figures
are identical, and the span adds nothing.

It does not invalidate the span. Gaps caused by the GPU waiting on the CPU are milliseconds,
comfortably above the quantum, and that is the case worth detecting. But the span must never be
sold as a way to see fine-grained bubbles.

## 4. Pass duration varies with GPU clock state

The same fixed workload measured 0.26ms, 0.35ms and 0.48ms per pass on different runs, while
staying stable to three decimal places _within_ a run. This is frequency scaling, not
measurement error, and it is unrelated to the developer flag. Absolute durations are only
comparable within a single run.

## 5. Mechanics confirmed

- `timestampWrites` on a compute pass descriptor works, and one query set serves passes across
  different command buffers and submissions by index pair.
- `resolveQuerySet` plus `copyBufferToBuffer` into a `MAP_READ` buffer, then `mapAsync`, is a
  workable readback path with no stalls introduced.
- No zero or negative durations were observed in any configuration.

## What this means for Phase 5

- Tier 1, per-pass durations, is solid. Ship it.
- Tier 2, span within one command buffer, is solid. Ship it.
- Tier 3, span across submissions in a frame, is supported by this evidence but stays gated
  behind the runtime validator, and `undefined` when the validator fails.
- Every timing metric's `describe()` gains a caveat naming the real 65.536µs quantum and
  stating that inter-pass gaps below it are not observable.

## Not yet answered

- How many timestamp queries can stay in flight before Dawn or Metal complains.
- Behaviour when the application already set `timestampWrites` on a pass, the
  `uninstrumentedPassCount` path.
- Whether render passes and compute passes share the timeline. Only compute was exercised here.
- Sustained-run behaviour over thousands of frames: query exhaustion, readback growth, leaks.
