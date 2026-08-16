import type { MetricDefinition, MetricPath } from "./types";

const QUANTIZATION_CAVEAT =
  "Browsers coarsen performance.now() for security, so very short durations are quantized.";

export const METRIC_DEFINITIONS: Readonly<
  Record<MetricPath, MetricDefinition>
> = {
  "frame.renderedFrameCount": {
    name: "frame.renderedFrameCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Sequence number of the frame these metrics describe, counting beginRenderFrame() calls since attach.",
    methodology: "Incremented once per beginRenderFrame() call.",
    caveats: [
      "Not a requestAnimationFrame count.",
      "Not a rendering engine frame count.",
      "Not a browser compositor or presented frame count.",
    ],
  },
  "frame.drawCallCount": {
    name: "frame.drawCallCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Draw commands recorded during this frame, across draw, drawIndexed, drawIndirect and drawIndexedIndirect.",
    methodology:
      "Counted on every render pass encoder created through the attached device. Draws recorded into a render bundle are counted once when the bundle is finished, then added again on each executeBundles() replay.",
    caveats: [
      "Counts recorded commands, not primitives or instances rendered.",
      "Indirect draws are one command each regardless of what the GPU-side buffer specifies.",
      "Draws recorded before attach, or through a device Groma is not attached to, are not counted.",
    ],
  },
  "frame.computeDispatchCount": {
    name: "frame.computeDispatchCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Compute dispatch commands recorded during this frame, across dispatchWorkgroups and dispatchWorkgroupsIndirect.",
    methodology:
      "Counted on every compute pass encoder created through the attached device.",
    caveats: [
      "Counts dispatch commands, not workgroups or invocations.",
      "Indirect dispatches are one command each regardless of the GPU-side workgroup count.",
    ],
  },
  "frame.renderPassCount": {
    name: "frame.renderPassCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description: "Render passes begun during this frame.",
    methodology:
      "Counted on every beginRenderPass() call on command encoders created through the attached device.",
    caveats: ["Counts passes begun, not passes that completed successfully."],
  },
  "frame.computePassCount": {
    name: "frame.computePassCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description: "Compute passes begun during this frame.",
    methodology:
      "Counted on every beginComputePass() call on command encoders created through the attached device.",
    caveats: ["Counts passes begun, not passes that completed successfully."],
  },
  "frame.pipelineCreationCount": {
    name: "frame.pipelineCreationCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Render and compute pipelines created synchronously during this frame.",
    methodology:
      "Counted on createRenderPipeline() and createComputePipeline(). Creation that throws is still counted.",
    caveats: [
      "Steady state should be zero. A non-zero value mid-run means pipelines are being built during rendering.",
      "The async variants are not counted, since their cost does not block the calling frame.",
    ],
  },
  "frame.pipelineCreationBlockingDurationSumInMs": {
    name: "frame.pipelineCreationBlockingDurationSumInMs",
    unit: "ms",
    source: "performance-clock",
    confidence: "measured",
    description:
      "Total wall-clock time the calling thread spent inside synchronous pipeline creation during this frame.",
    methodology:
      "performance.now() bracketing each createRenderPipeline() and createComputePipeline() call, summed over the frame.",
    caveats: [
      "This is blocking time on the calling thread, not GPU time and not total shader compilation cost.",
      "Implementations may defer real compilation, so a small value here does not prove compilation was cheap.",
      QUANTIZATION_CAVEAT,
    ],
  },
};
