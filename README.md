# agrimensor

Headless WebGPU metrics with explicit measurement semantics.

An agrimensor was a Roman land surveyor. The job was not to decide where boundaries should be,
but to sight them accurately and record what was actually there.

Status: alpha. Resource accounting, per frame work counters and GPU pass timing are all
implemented. Metric names may change before `0.1.0`.

## Why

I wanted to know what my WebGPU renderer was actually doing, and found that the numbers
available to me did not mean what their names suggested. A value called `gpuFrameTime` turned
out to be a sum of individual pass durations, which cannot answer whether the GPU was busy. A
memory total counted compressed textures as one byte each and added shader source string
length into the same figure.

Agrimensor exposes a small set of metrics and, for every one of them, states exactly what it
measures, how, and what it does not represent. It attaches to a `GPUDevice` and depends on no
rendering engine.

It prefers exposing no metric over exposing a convenient but misleading one.

Metric names and semantics may still change before `0.1.0`. A metric whose meaning turns out to
be wrong gets corrected or removed rather than preserved, because **a stable lie is worse than a
breaking correction in a measurement library**. Corrections are listed in `CHANGELOG.md`, and
several of them exist because a number looked plausible and was not.

## Install

```
npm i agrimensor@alpha
```

Releases before `0.1.0` publish under the `alpha` tag.

## Use

```ts
import { attach } from "agrimensor";

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("WebGPU is not available");

const requiredFeatures: GPUFeatureName[] = [];
if (adapter.features.has("timestamp-query")) {
  requiredFeatures.push("timestamp-query");
}

const device = await adapter.requestDevice({ requiredFeatures });

const agrimensor = attach(device);

// then hand the same device to a renderer, or use it directly
```

Call `beginRenderFrame()` once per rendered frame, immediately before the frame's GPU work:

```ts
agrimensor.beginRenderFrame();
renderer.render(scene, camera);
```

Read whenever you want. `snapshot()` is synchronous, never blocks and never forces a GPU
readback. It does allocate: roughly three small objects per call, so calling it every frame at
120Hz is a few hundred short-lived objects per second. That is trivial for a garbage collector
but worth knowing if you are chasing frame-time spikes.

```ts
const { resources, frame } = agrimensor.snapshot();
```

`resources` is always present. `frame` is present once two `beginRenderFrame()` calls have
happened, since the tick that opens a frame is what closes the previous one. `gpu` is present
when the device has `timestamp-query` and a batch of timestamps has finished reading back.

### Levels and flows read differently

`resources` are **levels**. They describe the state right now, so reading them on a timer is
correct and gives you the answer you expect.

`frame` and `gpu` are **flows**. Each describes exactly one frame, the most recently completed
one, and is never an average. Reading them on a timer samples an arbitrary frame, which will
look unstable and will misreport anything that varies between frames. Read them every frame
and aggregate yourself:

```ts
const samples: number[] = [];

const onRenderFrame = () => {
  agrimensor.beginRenderFrame();
  renderer.render(scene, camera);

  const { frame } = agrimensor.snapshot();
  if (frame) samples.push(frame.drawCallCount);
};

// then report min, max or a mean over samples, and clear it
```

This is the single easiest way to misread the library. Sampling once a second produced a draw
count that looked wrong and a gap that looked unstable, and both were artefacts of sampling one
frame out of a hundred and twenty.

GPU time for a frame, against a 120fps budget of 8.33ms:

```ts
const { gpu } = agrimensor.snapshot();
if (gpu) {
  const gpuFrameMs =
    gpu.submittedRenderAndComputePassExecutionInMs +
    gpu.submittedRenderAndComputePassGapSumInMs;
}
```

`execution` is time the GPU actually spent in passes, counting concurrent passes once. `gapSum`
is time inside that window when no pass was running. Their sum is the elapsed GPU time for the
frame's pass work.

**Do not use the duration sums as frame time.** Passes run concurrently, so
`submittedRenderPassDurationSumInMs` counts overlapping time once per pass. In a real Three.js
app on Apple Silicon it read 27ms while the GPU had actually spent 4ms, a factor of 6.75. The
sums exist for comparison with what engines report, and their `describe()` entries carry a
`preferInstead` pointing at the figure that answers the question.

Totals tell you how much; `largestResources()` tells you which allocation to go and look at:

```ts
agrimensor.largestResources(5);
// [{ kind: "texture", label: "bloomTarget", allocationInBytes: 33554432,
//    format: "rgba16float", width: 2048, height: 2048 }, ...]
```

It is deliberately not part of `snapshot()`, which stays cheap enough to call every frame.
Labels come from whatever the application set, and are empty when it set none, which is why the
format and dimensions are included: a texture is recognisable by its shape alone.

Every metric can explain itself:

```ts
agrimensor.describe("resources.liveTextureAllocationSumInBytes");
```

## Where a resource came from

`largestResources()` tells you which allocation is big. On an engine you did not write, the next
question is which line of code asked for it, and no total can answer that. The only moment the
answer exists is the call itself, so agrimensor hands you that moment and keeps nothing:

```ts
const origins = new Map<number, string>();

const agrimensor = attach(device, {
  onResourceCreated: ({ id, allocationInBytes }) => {
    if (allocationInBytes < 20e6) return;
    origins.set(id, new Error().stack ?? "");
  },
  onResourceDestroyed: ({ id }) => origins.delete(id),
});
```

Both hooks receive the same `ResourceEntry` shape `largestResources()` returns, and `id` is
stable and never reused, so anything you key by it joins cleanly against a later reading.

What agrimensor deliberately does not do is capture the stack itself. When to capture, how much
to trim, how long to hold it and how much memory that is allowed to cost are policy, and a
measurement library that decides policy stops being one.

- The hooks fire **synchronously inside the allocating call**. Do no work there beyond recording,
  and do not call back into the device from them. `new Error().stack` is expensive enough that
  capturing it for every allocation during asset load is noticeable, which is why the size filter
  above comes before the capture rather than after it.
- A hook that throws is swallowed, so a bug in yours cannot reach the `createTexture()` that
  fired it.
- Neither hook fires for resources created before `attach()`, nor for agrimensor's own
  timestamp buffers.
- `onResourceDestroyed` fires only for an explicit `destroy()`. A resource dropped to garbage
  collection never calls it, so a map keyed by id has to tolerate entries that outlive their
  resource. This is the same limit the live totals have.
- They say where a resource was created, not why it is still alive. This is not a leak detector.

The top frames of a captured stack are agrimensor's own, and a minified production build gives
you useless frames without sourcemaps. On V8, `Error.captureStackTrace(holder, fn)` trims the
instrumentation off the top cleanly.

## Detaching

`destroy()` removes every patch from the device, releases agrimensor's own query set and
buffers, and makes any later call on the instance throw rather than return a stale figure. Your
own resources are untouched. After it, `attach()` can be called on that device again.

```ts
agrimensor.destroy();
```

## Using it with three.js

Attach **after** `renderer.init()`, to the device three created itself:

```ts
const renderer = new WebGPURenderer({ canvas });
await renderer.init();

const { backend } = renderer;
if ("device" in backend && backend.device instanceof GPUDevice) {
  const agrimensor = attach(backend.device);
}
```

Two traps, both of which cost a real afternoon:

**Do not hand three your own device** unless you enumerate every adapter feature into
`requiredFeatures` yourself. Three does that only when it creates the device
(`WebGPUBackend.js:209`), so a hand-made device silently loses whatever you forgot. In one real
case that would have dropped `indirect-first-instance`, collapsing a grass LOD scheme to a
single draw, and `core-features-and-limits`, zeroing MSAA. Letting three own the device costs
you only its startup allocations, which is the better trade.

**`renderer.backend` is typed as the abstract `Backend`**, which has no `device`. The `in` check
above narrows it without a cast.

Then mark your frames where you actually render:

```ts
agrimensor.beginRenderFrame();
renderer.render(scene, camera);
```

If three is configured with `trackTimestamp: true` it sets its own `timestampWrites`, agrimensor
yields to it, and those passes appear in `gpu.uninstrumentedPassCount` instead of the timings.

## Why the frame marker exists

Agrimensor cannot infer where your frame begins. `requestAnimationFrame` is not a reliable proxy:
an app that renders every other rAF tick, or renders off the main loop entirely, would be
measured wrong. You know where your frame is, so you declare it. Without
`beginRenderFrame()`, per frame metrics are `undefined` and `capabilities.frameScope` is
`false`, rather than quietly wrong.

## Measured overhead

**0.013 ms of CPU per frame** on a frame with 900 draw calls, 6 render passes, 1 compute pass
and 1 submit, which is 0.16% of a 120fps budget. Per intercepted call: `draw()` +14ns,
`beginRenderPass()` +593ns, `createBuffer()` +110ns, `queue.submit()` +1900ns, plus one extra
submit per frame to resolve timestamps.

Measured on an Apple M2 Pro with `npm run bench`, against the built artifact. No zero-overhead
claim is made. Method and caveats are in `spike/BENCHMARK.md`.

Size: the published artifact is 48.7 kB raw and 12.1 kB gzipped, shipped unminified so your
bundler can minify and so the source stays auditable. Minified it is 36.8 kB, or **9.7 kB
gzipped**, which is what an application bundle actually carries. That last pair comes from this
project's own minifier, so your bundler will land near it rather than exactly on it. There is no
build-time flag, so gating agrimensor behind a runtime flag keeps it in the bundle.

## What it cannot measure

These are properties of WebGPU, not omissions.

- **GPU time outside passes.** `GPUCommandEncoder.writeTimestamp` was removed from the spec
  ([gpuweb#4370](https://github.com/gpuweb/gpuweb/pull/4370)) because it gave no ordering
  guarantee. Timestamps can only be written at render and compute pass boundaries, so copies,
  clears and canvas presentation cannot be bracketed.
- **When GPU work executed, in CPU time.** The queue timeline and `performance.now()` have an
  unknown offset and no API bridges them. Work is attributed to the frame it was _submitted_
  in, never the frame it executed in.
- **Cross submission timing, guaranteed.** The spec does not promise timestamps are comparable
  across submits ([gpuweb#4361](https://github.com/gpuweb/gpuweb/issues/4361)). Agrimensor checks
  at runtime instead of assuming, and withholds the affected metric if the check fails.
- **Sub-millisecond precision.** Chrome reports timestamps in multiples of 65.536 microseconds,
  measured, rather than the 100 microseconds its documentation states. A multi millisecond span
  is meaningful, a 0.2ms pass is not.
- **Comparisons across different GPU load.** GPU frequency scaling changes pass durations.
  Halving a frame rate cap raised measured durations by roughly 40 percent for identical work,
  because a less loaded GPU clocks down. Durations cannot be benchmarked at one setting and
  carried to another.
- **Physical GPU memory.** Agrimensor reports logical allocation requested through WebGPU. It does
  not know driver residency, alignment padding, or implementation internal allocations, and
  will not call any of its numbers VRAM.
- **Anything on a backend other than Metal.** Every figure in this README, including the
  timestamp behaviour and the overhead numbers, was measured on Dawn over Metal on Apple
  Silicon. D3D12 and Vulkan are untested.
- **Resources it never saw.** Anything created before `attach()`, canvas textures from
  `getCurrentTexture()`, and resources released by garbage collection without an explicit
  `destroy()`.

## License

MIT
