import type { MetricDefinition, MetricPath } from "./types";

const QUANTIZATION_CAVEAT =
  "Browsers coarsen performance.now() for security, so very short durations are quantized.";

export const METRIC_DEFINITIONS: Readonly<
  Record<MetricPath, MetricDefinition>
> = {
  "resources.liveBufferCount": {
    name: "resources.liveBufferCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Buffers created through the attached device that Groma has not observed being destroyed.",
    methodology:
      "Incremented on createBuffer(), decremented the first time destroy() is called on that buffer.",
    caveats: [
      "Buffers created before attach() are not included.",
      "A buffer released by garbage collection without an explicit destroy() call stays counted, because that release is not observable.",
    ],
  },
  "resources.liveTextureCount": {
    name: "resources.liveTextureCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Textures created through the attached device that Groma has not observed being destroyed.",
    methodology:
      "Incremented on createTexture(), decremented the first time destroy() is called on that texture.",
    caveats: [
      "Textures created before attach() are not included.",
      "Canvas textures from getCurrentTexture() never appear, since they are not created through createTexture().",
      "A texture released by garbage collection without an explicit destroy() call stays counted.",
    ],
  },
  "resources.liveBufferAllocationSumInBytes": {
    name: "resources.liveBufferAllocationSumInBytes",
    unit: "bytes",
    source: "gpu-resource-descriptor",
    confidence: "measured",
    description:
      "Sum of the declared sizes of live buffers created through the attached device.",
    methodology:
      "The size field of each createBuffer() descriptor, added on creation and subtracted when destruction is observed.",
    caveats: [
      "This is not physical GPU memory usage and must not be read as VRAM.",
      "Excludes browser, driver and implementation-internal allocations, staging buffers, alignment padding and pipeline caches.",
      "Buffers created before attach() are not included.",
    ],
  },
  "resources.liveTextureAllocationSumInBytes": {
    name: "resources.liveTextureAllocationSumInBytes",
    unit: "bytes",
    source: "gpu-resource-descriptor",
    confidence: "derived",
    description:
      "Sum of the logical allocation of live textures created through the attached device.",
    methodology:
      "Per texture, block dimensions and bytes per block for its format are taken from a WebGPU format table, applied across its full declared mip chain, then multiplied by array layers and sample count.",
    caveats: [
      "This is a calculation from the descriptor, not a reading from the driver.",
      "depth24plus, depth24plus-stencil8 and depth32float-stencil8 have implementation-defined storage. Groma models them as 4, 4 and 8 bytes per texel respectively, which matches common Dawn backends but is not reported by the API.",
      "Multisampled textures are multiplied by sampleCount. Some GPUs compress multisampled surfaces, so real footprint can be lower.",
      "Assumes the full declared mip chain is allocated.",
      "This is not physical GPU memory usage and must not be read as VRAM.",
    ],
  },
  "resources.liveResourceAllocationSumInBytes": {
    name: "resources.liveResourceAllocationSumInBytes",
    unit: "bytes",
    source: "derived",
    confidence: "derived",
    description:
      "Live buffer allocation plus live texture allocation, for resources created through the attached device.",
    methodology:
      "The sum of resources.liveBufferAllocationSumInBytes and resources.liveTextureAllocationSumInBytes.",
    caveats: [
      "Inherits every caveat of the two figures it adds.",
      "This is not physical GPU memory usage and must not be read as VRAM.",
    ],
  },
  "resources.liveResourceAllocationPeakInBytes": {
    name: "resources.liveResourceAllocationPeakInBytes",
    unit: "bytes",
    source: "derived",
    confidence: "derived",
    description:
      "Highest value resources.liveResourceAllocationSumInBytes has reached since attach.",
    methodology:
      "Recomputed and compared against the running maximum each time a resource is created.",
    caveats: [
      "Only sampled on creation, so a peak reached between two creations is not captured.",
      "Never decreases while the instance is attached.",
      "Inherits every caveat of the figure it tracks.",
    ],
  },
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
  "frame.queueWriteSumInBytes": {
    name: "frame.queueWriteSumInBytes",
    unit: "bytes",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Bytes handed to the queue during this frame through writeBuffer() and writeTexture().",
    methodology:
      "For writeBuffer, the declared size, accounting for dataOffset and size being expressed in elements for a typed array and in bytes otherwise. For writeTexture, the copy region computed from the extent and the destination texture format.",
    caveats: [
      "This is data handed to the API, not bus traffic. Implementations batch, stage and schedule the real transfer.",
      "Excludes data reaching the GPU through mappedAtCreation buffers or mapAsync writes, which are not observable as a queue call.",
    ],
  },
  "frame.commandCopySumInBytes": {
    name: "frame.commandCopySumInBytes",
    unit: "bytes",
    source: "derived",
    confidence: "derived",
    description:
      "Bytes moved by copy commands recorded during this frame, across copyBufferToBuffer, copyBufferToTexture, copyTextureToBuffer and copyTextureToTexture.",
    methodology:
      "Buffer copies use the declared size, or the source buffer size minus its offset when size is omitted. Texture copies compute the region from the extent and the relevant texture format.",
    caveats: [
      "Counts bytes described by recorded commands, not bytes actually moved. A command buffer that is never submitted is still counted.",
      "This is GPU-side movement. It is not a CPU upload and not a readback: copyTextureToBuffer only reaches a GPU buffer, and the transfer to CPU memory happens later at mapAsync, which this does not measure.",
    ],
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
