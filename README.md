# agrimensor

Headless WebGPU metrics with explicit measurement semantics. It attaches to a `GPUDevice`, works
with any renderer or none, and states for every number what it measures and what it does not.

An agrimensor was a Roman land surveyor: not the one who decided where boundaries should be, but
the one who sighted them accurately and recorded what was actually there.

**What you get**

- Live resource counts and byte totals, with the largest allocations named.
- Per frame draw, dispatch, pass, submit and transfer counts.
- Real GPU time per frame from timestamp queries, counting concurrent passes once.
- A methodology and caveat list for every metric, readable at runtime via `describe()`.

**What you do not get** is anything WebGPU cannot honestly report: no VRAM figure, no CPU to GPU
timeline bridge, no number that looks convenient and means something else. Those gaps are listed
under [Watch out for](#watch-out-for) rather than papered over.

The metrics below are a contract: a rename or a change of meaning gets a version bump and an
entry in `CHANGELOG.md`. That contract bends one way. A metric that turns out to mean the wrong
thing gets corrected or removed rather than kept, because a stable lie is worse than a breaking
correction in a measurement library. This is 0.x, so such a correction can land in a minor
version, and several already have.

## Install

```
npm i agrimensor
```

## Setup

```ts
import { attach } from "agrimensor";

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("WebGPU is not available");

const requiredFeatures: GPUFeatureName[] = [];
if (adapter.features.has("timestamp-query"))
  requiredFeatures.push("timestamp-query");

const device = await adapter.requestDevice({ requiredFeatures });
const agrimensor = attach(device);
```

With three.js, attach after `renderer.init()` to the device three built itself. `renderer.backend`
is typed as the abstract `Backend`, so the `in` check narrows it without a cast:

```ts
const renderer = new WebGPURenderer({ canvas });
await renderer.init();

const { backend } = renderer;
if ("device" in backend && backend.device instanceof GPUDevice) {
  const agrimensor = attach(backend.device);
}
```

Do not hand three your own device unless you enumerate every adapter feature into
`requiredFeatures` yourself. Three only does that for devices it creates
(`WebGPUBackend.js:209`), so a hand-made one silently loses whatever you forgot. In one real case
that dropped `indirect-first-instance` and `core-features-and-limits`, collapsing a grass LOD
scheme to a single draw and zeroing MSAA.

Then mark every rendered frame, immediately before its GPU work:

```ts
agrimensor.beginRenderFrame();
renderer.render(scene, camera);
```

Agrimensor cannot infer where your frame begins, and `requestAnimationFrame` is not a reliable
proxy, since an app that renders every other tick or off the main loop would be measured wrong.
So you declare it. Without the marker the per frame groups stay `undefined` rather than quietly
wrong.

## Metrics

`snapshot()` is synchronous, never blocks and never forces a GPU readback. It returns:

```ts
{
  // levels: the state right now, so reading these on a timer is correct
  resources: {
    // buffers created through the device and not explicitly destroyed
    liveBufferCount: number;
    // textures created through the device and not explicitly destroyed
    liveTextureCount: number;
    // sum of the declared size of live buffers
    liveBufferAllocationSumInBytes: number;
    // logical allocation of live textures, from format across the mip chain, layers and samples
    liveTextureAllocationSumInBytes: number;
    // the two sums above added
    liveResourceAllocationSumInBytes: number;
    // the highest that total has reached since attach, sampled on creation, never decreases
    liveResourceAllocationPeakInBytes: number;
  };

  // flow: exactly one frame, the most recently completed one, never an average.
  // undefined until two beginRenderFrame() calls have happened
  frame?: {
    // sequence number of the frame these figures describe
    renderedFrameCount: number;
    // draw, drawIndexed, drawIndirect and drawIndexedIndirect, plus bundle draws per replay
    drawCallCount: number;
    // dispatchWorkgroups and dispatchWorkgroupsIndirect
    computeDispatchCount: number;
    // render passes begun, not passes that completed
    renderPassCount: number;
    // compute passes begun, not passes that completed
    computePassCount: number;
    // queue.submit() calls, excluding agrimensor's own
    gpuSubmissionCount: number;
    // bytes handed to writeBuffer() and writeTexture(), not bus traffic
    queueWriteSumInBytes: number;
    // bytes described by the four copy* commands, whether or not they are submitted
    commandCopySumInBytes: number;
    // pipelines requested, sync and async, including ones that throw. zero in steady state
    pipelineCreationCount: number;
    // wall-clock time the calling thread sat inside synchronous pipeline creation
    pipelineCreationBlockingDurationSumInMs: number;
  };

  // flow: one frame, several frames behind `frame`. undefined without timestamp-query,
  // before the first batch reads back, or when the timestamps fail the plausibility check
  gpu?: {
    // GPU time actually spent in passes, counting concurrent passes once. the figure to read
    submittedRenderAndComputePassExecutionInMs: number;
    // time inside that frame's pass window when no pass was running
    submittedRenderAndComputePassGapSumInMs: number;
    // sum of individual render pass durations, inflated by overlap
    submittedRenderPassDurationSumInMs: number;
    // sum of individual compute pass durations, inflated by overlap
    submittedComputePassDurationSumInMs: number;
    // passes agrimensor could not time, and which are missing from every figure above
    uninstrumentedPassCount: number;
    // how many rendered frames back the figures above describe
    resultLagFrameCount: number;
  };
}
```

`resources` are levels, correct to read on a timer. `frame` and `gpu` are flows: each describes
one frame, so sampling them on a timer reads an arbitrary frame and misreports anything that
varies between frames. Read them every frame and aggregate yourself.

Elapsed GPU time for a frame's pass work is execution plus gap:

```ts
const { gpu } = agrimensor.snapshot();
if (gpu) {
  const gpuFrameMs =
    gpu.submittedRenderAndComputePassExecutionInMs +
    gpu.submittedRenderAndComputePassGapSumInMs;
}
```

## Watch out for

Reading the numbers:

- **The duration sums are inflated by overlap.** Passes run concurrently, so each sum counts
  overlapping time once per pass. In a real three.js app one read 27ms where the GPU had spent
  4ms. They exist only for comparison with what engines report, and both carry a `preferInstead`
  pointing at the execution figure.
- **The gap is not pure idle.** Work that cannot carry a timestamp, such as copies encoded
  between passes, sits inside it. It is genuine idle only when `commandCopySumInBytes` is zero
  for the same frame.
- **`uninstrumentedPassCount` above zero means the `gpu` figures undercount**, and it is the only
  signal for that. An engine running its own timestamp profiling drives it up, because a pass
  descriptor holds one `timestampWrites` and agrimensor yields rather than overwrite yours.
- **Counts are commands, not work.** One indirect draw is one draw call whatever its GPU-side
  buffer says, and one dispatch is one dispatch whatever its workgroup count.
- **`gpu` describes an older frame than `frame` does.** Check `resultLagFrameCount` before
  pairing figures from the two groups.

What it cannot see, because WebGPU does not expose it:

- **Physical GPU memory.** Byte totals are logical allocation computed from descriptors, never
  read from the driver. They exclude staging, alignment padding and driver internals, and none of
  them will be called VRAM.
- **Resources it never saw.** Anything created before `attach()`, canvas textures from
  `getCurrentTexture()`, and anything released by garbage collection without an explicit
  `destroy()`, which makes live counts drift upward over a long session.
- **GPU time outside passes.** `writeTimestamp` was removed from the spec
  ([gpuweb#4370](https://github.com/gpuweb/gpuweb/pull/4370)) for giving no ordering guarantee, so
  copies, clears and presentation cannot be bracketed.
- **When GPU work executed, in CPU time.** The queue timeline and `performance.now()` have an
  unknown offset and no API bridges them. Work is attributed to the frame it was submitted in.
- **Cross submission timing, guaranteed.** The spec does not promise it
  ([gpuweb#4361](https://github.com/gpuweb/gpuweb/issues/4361)), so agrimensor checks at runtime
  and withholds `gpu` when the check fails.
- **Sub-millisecond precision.** Chrome quantises timestamps to 65.536µs, measured, rather than
  the 100µs its docs state. A multi-millisecond span is meaningful, a 0.2ms pass is not.
- **Comparisons across different GPU load.** Frequency scaling changes pass durations: halving a
  frame rate cap raised them by roughly 40% for identical work.
- **Anything outside Metal.** Every figure here, overhead included, was measured on Dawn over
  Metal on Apple Silicon. D3D12 and Vulkan are untested.

## API

**`attach(device, options?)`** patches the device and returns an instance. Throws if that device
already has one.

**`beginRenderFrame()`** opens a frame and closes the previous one. Call it once per rendered
frame.

**`snapshot()`** returns the metrics above. Allocates roughly three small objects per call.

**`largestResources(count = 10)`** returns live resources by allocated bytes, biggest first.
Totals say how much, this says which allocation to go and look at. Deliberately outside
`snapshot()` so the per frame path stays cheap.

```ts
agrimensor.largestResources(5);
// [{ id: 42, kind: "texture", label: "bloomTarget", allocationInBytes: 33554432,
//    usage: 16, format: "rgba16float", width: 2048, height: 2048,
//    depthOrArrayLayers: 1, sampleCount: 1, mipLevelCount: 1 }, ...]
```

`id` is stable for a resource's life and never reused, so a keyed list is safe and "still alive"
is distinguishable from "allocated again". `label` is whatever the application set, empty when it
set none, which is why format and dimensions come too: a texture is recognisable by its shape.

**`describe(metric)`** returns any metric's full definition: description, methodology, caveats,
unit, source, and a `confidence` of `"measured"` or `"derived"`. Figures that are easy to misread
also carry `preferInstead`.

```ts
agrimensor.describe("gpu.submittedRenderPassDurationSumInMs").preferInstead;
// "gpu.submittedRenderAndComputePassExecutionInMs"
```

**`capabilities`** is a fresh frozen object per read: `resourceTracking` (always true),
`frameScope` (a frame has been marked), `timestampQueries` (the device has the feature), and
`crossSubmissionTimestampsComparable` (false withholds `gpu`).

**`destroy()`** removes every patch, releases agrimensor's own query set and buffers, and makes
later calls throw rather than return a stale figure. Your resources are untouched and `attach()`
can be called on that device again.

### Resource origins

`largestResources()` says which allocation is big. On an engine you did not write, the next
question is which line asked for it, and the only moment that answer exists is the call itself:

```ts
const origins = new Map<number, string>();

attach(device, {
  onResourceCreated: ({ id, allocationInBytes }) => {
    if (allocationInBytes < 20e6) return;
    origins.set(id, new Error().stack ?? "");
  },
  onResourceDestroyed: ({ id }) => origins.delete(id),
});
```

Both hooks receive the entry `largestResources()` returns, so anything keyed by `id` joins to a
later reading. Agrimensor captures no stacks itself: when to capture and how long to hold it are
policy, and a measurement library that decides policy stops being one.

They fire synchronously inside the allocating call, so record and defer, keep the size filter
before the capture, and do not call back into the device. A hook that throws is swallowed.
`onResourceDestroyed` only fires for an explicit `destroy()`. This says where a resource came
from, not why it is still alive: it is not a leak detector.

## Overhead and size

**0.013 ms of CPU per frame** on a frame with 900 draw calls, 6 render passes, 1 compute pass and
1 submit, which is 0.16% of a 120fps budget. Measured on an Apple M2 Pro with `npm run bench`
against the built artifact. No zero-overhead claim is made; per call figures, method and caveats
are in `spike/BENCHMARK.md`.

The published artifact is 48.7 kB raw and 12.1 kB gzipped, shipped unminified so your bundler can
minify it and so the source stays auditable. Minified it is 36.8 kB, or **9.7 kB gzipped**. There
is no build-time flag, so gating agrimensor behind a runtime flag keeps it in the bundle.

## License

MIT
