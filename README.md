# groma

Headless WebGPU metrics with explicit measurement semantics.

Status: early. The public surface is defined, the implementation is landing in phases. Metric
names may change before `0.1.0`.

## Why

I wanted to know what my WebGPU renderer was actually doing, and found that the numbers
available to me did not mean what their names suggested. A value called `gpuFrameTime` turned
out to be a sum of individual pass durations, which cannot answer whether the GPU was busy. A
memory total counted compressed textures as one byte each and added shader source string
length into the same figure.

Groma exposes a small set of metrics and, for every one of them, states exactly what it
measures, how, and what it does not represent. It attaches to a `GPUDevice` and depends on no
rendering engine.

It prefers exposing no metric over exposing a convenient but misleading one.

## Install

```
npm i groma
```

## Use

```ts
import { attach } from "groma";

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("WebGPU is not available");

const requiredFeatures: GPUFeatureName[] = [];
if (adapter.features.has("timestamp-query")) {
  requiredFeatures.push("timestamp-query");
}

const device = await adapter.requestDevice({ requiredFeatures });

const groma = attach(device);

// then hand the same device to a renderer, or use it directly
```

Call `beginRenderFrame()` once per rendered frame, immediately before the frame's GPU work:

```ts
groma.beginRenderFrame();
renderer.render(scene, camera);
```

Read whenever you want. `snapshot()` is synchronous, never blocks, and never forces a GPU
readback:

```ts
const { resources, frame, gpu } = groma.snapshot();
```

Every metric can explain itself:

```ts
groma.describe("gpu.submittedRenderPassDurationSumInMs");
```

## Why the frame marker exists

Groma cannot infer where your frame begins. `requestAnimationFrame` is not a reliable proxy:
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
  across submits ([gpuweb#4361](https://github.com/gpuweb/gpuweb/issues/4361)). Groma checks
  at runtime instead of assuming, and withholds the affected metric if the check fails.
- **Sub-millisecond precision.** Chrome quantizes timestamps to 100 microseconds. A multi
  millisecond span is meaningful, a 0.2ms pass is not.
- **Physical GPU memory.** Groma reports logical allocation requested through WebGPU. It does
  not know driver residency, alignment padding, or implementation internal allocations, and
  will not call any of its numbers VRAM.
- **Resources it never saw.** Anything created before `attach()`, canvas textures from
  `getCurrentTexture()`, and resources released by garbage collection without an explicit
  `destroy()`.

## License

MIT
