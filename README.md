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

## Install

```
npm i agrimensor
```

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

Read whenever you want. `snapshot()` is synchronous, never blocks, and never forces a GPU
readback:

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

Every metric can explain itself:

```ts
agrimensor.describe("resources.liveTextureAllocationSumInBytes");
```

## Why the frame marker exists

Agrimensor cannot infer where your frame begins. `requestAnimationFrame` is not a reliable proxy:
an app that renders every other rAF tick, or renders off the main loop entirely, would be
measured wrong. You know where your frame is, so you declare it. Without
`beginRenderFrame()`, per frame metrics are `undefined` and `capabilities.frameScope` is
`false`, rather than quietly wrong.

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
- **Resources it never saw.** Anything created before `attach()`, canvas textures from
  `getCurrentTexture()`, and resources released by garbage collection without an explicit
  `destroy()`.

## License

MIT
