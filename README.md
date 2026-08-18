# agrimensor

Headless WebGPU metrics with explicit measurement semantics.

An agrimensor was a Roman land surveyor, whose job was not to decide where boundaries should be
but to sight them accurately and record what was actually there. This library attaches to a
`GPUDevice`, depends on no rendering engine, and states for every figure what it measures and
what it does not. It prefers exposing no metric over exposing a convenient but misleading one.

Status: alpha. Every release before `0.1.0` is an alpha and `latest` follows the newest one, so a
plain install gives you a prerelease until then. Names and semantics may still change: a metric
whose meaning turns out to be wrong gets corrected or removed rather than preserved, because a
stable lie is worse than a breaking correction in a measurement library. Corrections are listed
in `CHANGELOG.md`.

## Install

```
npm i agrimensor
```

## Quick start

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

Mark your frames, then read whenever you like:

```ts
agrimensor.beginRenderFrame();
renderer.render(scene, camera);

const { resources, frame, gpu } = agrimensor.snapshot();
```

`resources` is always present. `frame` appears once two `beginRenderFrame()` calls have happened,
since the tick that opens a frame is what closes the previous one. `gpu` appears when the device
has `timestamp-query` and a batch of timestamps has finished reading back.

## Levels and flows read differently

`resources` are **levels**, so reading them on a timer is correct. `frame` and `gpu` are
**flows**: each describes one frame, so sampling them on a timer reads an arbitrary frame and
misreports anything that varies between frames. This is the easiest way to misread the library
and it has produced false bug reports. Read them every frame and aggregate yourself:

```ts
const samples: number[] = [];

const onRenderFrame = () => {
  agrimensor.beginRenderFrame();
  renderer.render(scene, camera);

  const { frame } = agrimensor.snapshot();
  if (frame) samples.push(frame.drawCallCount);
};
```

## Metrics

`snapshot()` returns this shape. Every field explains itself at runtime through `describe()`,
which returns its full methodology and caveat list.

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

Elapsed GPU time for the frame's pass work is execution plus gap:

```ts
const { gpu } = agrimensor.snapshot();
if (gpu) {
  const gpuFrameMs =
    gpu.submittedRenderAndComputePassExecutionInMs +
    gpu.submittedRenderAndComputePassGapSumInMs;
}
```

### What these numbers are not

- **The duration sums are inflated by overlap.** Passes run concurrently, so each sum counts
  overlapping time once per pass. In a real three.js app it read 27ms where the GPU had spent
  4ms. Both sums carry a `preferInstead` pointing at the execution figure. They exist only for
  comparison with what engines report.
- **The gap is not pure idle.** Work that cannot carry a timestamp, such as copies encoded
  between passes, lives inside it. It is genuine idle only when `commandCopySumInBytes` is zero
  for the same frame.
- **`uninstrumentedPassCount` above zero means the `gpu` figures undercount.** It is the only
  signal for that. An engine running its own timestamp profiling drives it up, because a pass
  descriptor holds one `timestampWrites` and agrimensor yields rather than overwrite yours.
- **Counts are commands, not work.** One indirect draw is one draw call whatever its GPU-side
  buffer says, and one dispatch is one dispatch whatever its workgroup count.
- **Byte totals are logical allocation, not VRAM.** Texture bytes are computed from the
  descriptor, never read from the driver, and exclude staging, padding and driver internals.
- **Live counts drift upward.** A resource released by garbage collection without an explicit
  `destroy()` stays counted, because that release is not observable.
- **`gpu` describes an older frame than `frame` does.** Read `resultLagFrameCount` before
  pairing figures from the two groups.

## API

### `attach(device, options?)`

Patches the device and returns an instance. Throws if that device already has one. Resources
created before this call are invisible to every figure.

### `beginRenderFrame()`

Call once per rendered frame, immediately before the frame's GPU work. Agrimensor cannot infer
where your frame begins: `requestAnimationFrame` is not a reliable proxy, since an app that
renders every other tick or off the main loop would be measured wrong. Without this call, `frame`
and `gpu` stay `undefined` and `capabilities.frameScope` is `false`, rather than quietly wrong.

### `snapshot()`

Synchronous, never blocks, never forces a GPU readback. Allocates roughly three small objects per
call, so calling it every frame at 120Hz is a few hundred short-lived objects per second.

### `largestResources(count = 10)`

Live resources by allocated bytes, biggest first. Totals say how much; this says which allocation
to go and look at. Deliberately outside `snapshot()` so the per-frame path stays cheap. It is not
a resource explorer: no full enumeration, no contents, no lifetime history.

```ts
agrimensor.largestResources(5);
// [{ id: 42, kind: "texture", label: "bloomTarget", allocationInBytes: 33554432,
//    usage: 16, format: "rgba16float", width: 2048, height: 2048,
//    depthOrArrayLayers: 1, sampleCount: 1, mipLevelCount: 1 }, ...]
```

`id` is stable for the life of a resource and never reused, so a keyed list is safe and "still
alive" is distinguishable from "allocated again". `label` is whatever the application set and is
empty when it set none, which is why format and dimensions are included: a texture is
recognisable by its shape alone. `usage` is the raw descriptor flags, so bit-testing
`GPUTextureUsage.RENDER_ATTACHMENT` separates render targets from asset textures.

### `describe(metric)`

The full definition of any metric path: description, methodology, caveats, unit, source, and
`confidence` of `"measured"` or `"derived"`. Figures that are easy to misread also carry
`preferInstead`, pointing at the metric that answers the question better.

```ts
agrimensor.describe("gpu.submittedRenderPassDurationSumInMs").preferInstead;
// "gpu.submittedRenderAndComputePassExecutionInMs"
```

### `capabilities`

A fresh frozen object per read, so reactive state sees changes.

| Field                                 | True when                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `resourceTracking`                    | Always                                                                      |
| `frameScope`                          | `beginRenderFrame()` has been called at least once                          |
| `timestampQueries`                    | The device has the `timestamp-query` feature                                |
| `crossSubmissionTimestampsComparable` | Timestamps still pass the runtime plausibility check. False withholds `gpu` |

### `destroy()`

Removes every patch from the device, releases agrimensor's own query set and buffers, and makes
any later call on the instance throw rather than return a stale figure. Your own resources are
untouched, and `attach()` can be called on that device again.

## Where a resource came from

`largestResources()` says which allocation is big. On an engine you did not write, the next
question is which line asked for it, and the only moment that answer exists is the call itself.
Agrimensor hands you that moment and keeps nothing:

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

Both hooks receive the same entry `largestResources()` returns, so anything keyed by `id` joins
cleanly against a later reading. Agrimensor captures no stacks itself: when to capture, how much
to trim and how long to hold it are policy, and a measurement library that decides policy stops
being one.

- Both fire **synchronously inside the allocating call**. Record and defer, and do not call back
  into the device from them. `new Error().stack` is expensive enough that capturing it for every
  allocation during asset load is noticeable, which is why the size filter above comes first.
- A hook that throws is swallowed and cannot reach the `createTexture()` that fired it.
- Neither fires for resources created before `attach()`, nor for agrimensor's own buffers.
- `onResourceDestroyed` fires only for an explicit `destroy()`. A resource dropped to garbage
  collection never calls it, the same limit the live totals have.
- They say where a resource was created, not why it is still alive. This is not a leak detector.

Captured stacks start with agrimensor's own frames, and a minified production build gives useless
frames without sourcemaps. On V8, `Error.captureStackTrace(holder, fn)` trims the instrumentation
off the top.

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

`renderer.backend` is typed as the abstract `Backend`, which has no `device`, so the `in` check
narrows it without a cast.

**Do not hand three your own device** unless you enumerate every adapter feature into
`requiredFeatures` yourself. Three does that only when it creates the device
(`WebGPUBackend.js:209`), so a hand-made device silently loses whatever you forgot. In one real
case that would have dropped `indirect-first-instance`, collapsing a grass LOD scheme to a single
draw, and `core-features-and-limits`, zeroing MSAA.

If three is configured with `trackTimestamp: true` it sets its own `timestampWrites`, agrimensor
yields to it, and those passes appear in `gpu.uninstrumentedPassCount` instead of the timings.

## What it cannot measure

Properties of WebGPU, not omissions.

- **GPU time outside passes.** `writeTimestamp` was removed from the spec
  ([gpuweb#4370](https://github.com/gpuweb/gpuweb/pull/4370)) for giving no ordering guarantee.
  Timestamps only exist at pass boundaries, so copies, clears and presentation cannot be bracketed.
- **When GPU work executed, in CPU time.** The queue timeline and `performance.now()` have an
  unknown offset and no API bridges them. Work is attributed to the frame it was submitted in.
- **Cross submission timing, guaranteed.** The spec does not promise comparability across submits
  ([gpuweb#4361](https://github.com/gpuweb/gpuweb/issues/4361)). Agrimensor checks at runtime and
  withholds `gpu` if the check fails.
- **Sub-millisecond precision.** Chrome quantises timestamps to 65.536µs, measured, rather than
  the 100µs its docs state. A multi-millisecond span is meaningful, a 0.2ms pass is not.
- **Comparisons across different GPU load.** Frequency scaling changes pass durations. Halving a
  frame rate cap raised measured durations by roughly 40% for identical work.
- **Physical GPU memory.** Logical allocation only. No driver residency, alignment padding or
  implementation internals, and none of it will be called VRAM.
- **Anything outside Metal.** Every figure here, including the overhead numbers, was measured on
  Dawn over Metal on Apple Silicon. D3D12 and Vulkan are untested.
- **Resources it never saw.** Anything created before `attach()`, canvas textures, and resources
  released by garbage collection without an explicit `destroy()`.

## Overhead and size

**0.013 ms of CPU per frame** on a frame with 900 draw calls, 6 render passes, 1 compute pass and
1 submit, which is 0.16% of a 120fps budget. Per intercepted call: `draw()` +14ns,
`beginRenderPass()` +593ns, `createBuffer()` +110ns, `queue.submit()` +1900ns, plus one extra
submit per frame to resolve timestamps. Measured on an Apple M2 Pro with `npm run bench` against
the built artifact. No zero-overhead claim is made; method and caveats are in
`spike/BENCHMARK.md`.

The published artifact is 48.7 kB raw and 12.1 kB gzipped, shipped unminified so your bundler can
minify it and so the source stays auditable. Minified with this project's own toolchain it is
36.8 kB, or **9.7 kB gzipped**. There is no build-time flag, so gating agrimensor behind a runtime
flag keeps it in the bundle.

## License

MIT
