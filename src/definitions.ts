import type { MetricDefinition, MetricPath } from "./types";

const QUANTIZATION_CAVEAT =
  "Browsers coarsen performance.now() for security, so very short durations are quantized.";

const QUANTUM_CAVEAT =
  "Chrome reports timestamps in multiples of 65.536 microseconds unless the WebGPU developer features flag is enabled, so durations are quantised to that granularity and gaps shorter than it are invisible.";

const CLOCK_DRIFT_CAVEAT =
  "Pass durations shift when GPU load changes. Observed in a real app: halving the frame rate cap raised durations by roughly 40 percent for identical per-frame work. The likely cause is frequency scaling on a less loaded GPU, inferred from duty cycle arithmetic rather than confirmed against a frequency reading. Whatever the cause, the observation stands: durations are not comparable across frame rate caps, resolutions, or any change that alters GPU load, and cannot be benchmarked at one setting and carried to another.";

const OVERLAP_CAVEAT =
  "Passes execute concurrently, so each one can occupy most of the frame's whole pass window at the same time as the others. Observed in a real Three.js app on Apple Silicon: 8 render passes each averaging about two thirds of a 5.2ms window, because one pass's vertex phase overlaps another's fragment phase. Summing them therefore counts overlapping time once per pass and produced 27ms, 6.75 times the real elapsed GPU time. Read gpu.submittedRenderAndComputePassExecutionInMs for time actually spent.";

const SINGLE_FRAME_CAVEAT =
  "Describes one single frame, the most recently completed one, and is never an average. Reading this on a timer samples an arbitrary frame rather than a representative one. To characterise behaviour over time, read it every frame and aggregate yourself.";

const SUBMITTED_CAVEAT =
  "Covers passes submitted during that frame. GPU and CPU clocks cannot be aligned, so this is not the frame the work executed in.";

export const METRIC_DEFINITIONS: Readonly<
  Record<MetricPath, MetricDefinition>
> = {
  "resources.liveBufferCount": {
    name: "resources.liveBufferCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Buffers created through the attached device that Agrimensor has not observed being destroyed.",
    methodology:
      "Incremented on createBuffer(), decremented the first time destroy() is called on that buffer.",
    caveats: [
      "Buffers created before attach() are not included.",
      "A buffer released by garbage collection without an explicit destroy() call stays counted, because that release is not observable. Read this as buffers created and not explicitly destroyed, which can drift upward over a long session.",
    ],
  },
  "resources.liveTextureCount": {
    name: "resources.liveTextureCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Textures created through the attached device that Agrimensor has not observed being destroyed.",
    methodology:
      "Incremented on createTexture(), decremented the first time destroy() is called on that texture.",
    caveats: [
      "Textures created before attach() are not included.",
      "Canvas textures from getCurrentTexture() never appear, since they are not created through createTexture().",
      "A texture released by garbage collection without an explicit destroy() call stays counted. Read this as textures created and not explicitly destroyed, which can drift upward over a long session.",
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
      "depth24plus, depth24plus-stencil8 and depth32float-stencil8 have implementation-defined storage. Agrimensor models them as 4, 4 and 8 bytes per texel respectively, which matches common Dawn backends but is not reported by the API.",
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
      SINGLE_FRAME_CAVEAT,
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
      "Draws recorded before attach, or through a device Agrimensor is not attached to, are not counted.",
      SINGLE_FRAME_CAVEAT,
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
      SINGLE_FRAME_CAVEAT,
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
    caveats: [
      "Counts passes begun, not passes that completed successfully.",
      SINGLE_FRAME_CAVEAT,
    ],
  },
  "frame.computePassCount": {
    name: "frame.computePassCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description: "Compute passes begun during this frame.",
    methodology:
      "Counted on every beginComputePass() call on command encoders created through the attached device.",
    caveats: [
      "Counts passes begun, not passes that completed successfully.",
      SINGLE_FRAME_CAVEAT,
    ],
  },
  "frame.gpuSubmissionCount": {
    name: "frame.gpuSubmissionCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Times work was handed to the GPU queue during this frame, via queue.submit().",
    methodology:
      "Counted on every submit() call on the attached device's queue. Submissions Agrimensor makes for its own bookkeeping are excluded.",
    caveats: [
      "Counts submit() calls, not command buffers. One submission can carry several.",
      "A rendering engine may split one rendered frame across several submissions.",
      SINGLE_FRAME_CAVEAT,
    ],
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
      SINGLE_FRAME_CAVEAT,
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
      SINGLE_FRAME_CAVEAT,
    ],
  },
  "frame.pipelineCreationCount": {
    name: "frame.pipelineCreationCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Render and compute pipelines requested during this frame, synchronous and asynchronous alike.",
    methodology:
      "Counted on createRenderPipeline(), createComputePipeline() and their Async variants. Async creation is counted when requested, not when it resolves. Creation that throws is still counted.",
    caveats: [
      "Steady state should be zero. A non-zero value mid-run means pipelines are being built during rendering.",
      "Only the synchronous variants contribute to frame.pipelineCreationBlockingDurationSumInMs, so a frame can show creations with no blocking time.",
      SINGLE_FRAME_CAVEAT,
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
      "Excludes createRenderPipelineAsync and createComputePipelineAsync, which do not block. Those still appear in frame.pipelineCreationCount.",
      "Implementations may defer real compilation, so a small value here does not prove compilation was cheap.",
      QUANTIZATION_CAVEAT,
      SINGLE_FRAME_CAVEAT,
    ],
  },
  "gpu.resultLagFrameCount": {
    name: "gpu.resultLagFrameCount",
    unit: "count",
    source: "derived",
    confidence: "derived",
    description:
      "How many rendered frames back the gpu figures in this snapshot describe.",
    methodology:
      "The current beginRenderFrame() count minus the frame number attached to the timestamp batch that most recently finished reading back.",
    caveats: [
      "Timestamp results are read back asynchronously, so gpu figures always describe an earlier frame than the frame group does.",
      "The value grows if readback is slow, and no figure is ever relabelled to the current frame.",
      SINGLE_FRAME_CAVEAT,
    ],
  },
  "gpu.submittedRenderPassDurationSumInMs": {
    name: "gpu.submittedRenderPassDurationSumInMs",
    unit: "ms",
    source: "webgpu-timestamp-query",
    confidence: "derived",
    preferInstead: "gpu.submittedRenderAndComputePassExecutionInMs",
    description:
      "Sum of the GPU durations of every render pass submitted during that frame.",
    methodology:
      "Each render pass is given a timestamp pair through its descriptor. Every pass duration is end minus beginning, and those durations are added together.",
    caveats: [
      OVERLAP_CAVEAT,
      SUBMITTED_CAVEAT,
      QUANTUM_CAVEAT,
      CLOCK_DRIFT_CAVEAT,
      SINGLE_FRAME_CAVEAT,
    ],
  },
  "gpu.submittedComputePassDurationSumInMs": {
    name: "gpu.submittedComputePassDurationSumInMs",
    unit: "ms",
    source: "webgpu-timestamp-query",
    confidence: "derived",
    preferInstead: "gpu.submittedRenderAndComputePassExecutionInMs",
    description:
      "Sum of the GPU durations of every compute pass submitted during that frame.",
    methodology:
      "Each compute pass is given a timestamp pair through its descriptor. Every pass duration is end minus beginning, and those durations are added together.",
    caveats: [
      OVERLAP_CAVEAT,
      SUBMITTED_CAVEAT,
      QUANTUM_CAVEAT,
      CLOCK_DRIFT_CAVEAT,
      SINGLE_FRAME_CAVEAT,
    ],
  },
  "gpu.submittedRenderAndComputePassExecutionInMs": {
    name: "gpu.submittedRenderAndComputePassExecutionInMs",
    unit: "ms",
    source: "webgpu-timestamp-query",
    confidence: "derived",
    description:
      "GPU time actually spent executing passes submitted during that frame, counting concurrent passes once.",
    methodology:
      "The begin and end timestamps of every render and compute pass in the frame are merged into non-overlapping intervals, and the lengths of those merged intervals are added. Time when two or more passes ran at once is counted a single time, which is what distinguishes this from the duration sums.",
    caveats: [
      "Covers render and compute passes only. Buffer and texture copies, queue writes, clears and browser compositing are not passes and cannot carry timestamps, so they are excluded.",
      "Adding this to gpu.submittedRenderAndComputePassGapSumInMs gives the elapsed GPU time from the frame's first pass beginning to its last pass ending.",
      SUBMITTED_CAVEAT,
      QUANTUM_CAVEAT,
      CLOCK_DRIFT_CAVEAT,
      SINGLE_FRAME_CAVEAT,
    ],
  },
  "gpu.submittedRenderAndComputePassGapSumInMs": {
    name: "gpu.submittedRenderAndComputePassGapSumInMs",
    unit: "ms",
    source: "webgpu-timestamp-query",
    confidence: "derived",
    description:
      "GPU time inside that frame's pass window during which no pass was executing.",
    methodology:
      "The elapsed span from the earliest pass beginning to the latest pass ending, minus gpu.submittedRenderAndComputePassExecutionInMs. Both figures come from the same merged intervals, so this is the total length of the holes between them.",
    caveats: [
      "This is not purely idle time. It also contains GPU work that cannot carry a timestamp, such as buffer and texture copies encoded between passes. When frame.commandCopySumInBytes is zero for the same frame, the value is genuine idle.",
      "Measured between the first and last pass of the frame only, so it says nothing about time before or after that window.",
      QUANTUM_CAVEAT,
      CLOCK_DRIFT_CAVEAT,
      SINGLE_FRAME_CAVEAT,
    ],
  },
  "gpu.uninstrumentedPassCount": {
    name: "gpu.uninstrumentedPassCount",
    unit: "count",
    source: "webgpu-api-observation",
    confidence: "measured",
    description:
      "Passes in that frame that agrimensor could not time, and which are therefore missing from every gpu figure above.",
    methodology:
      "Counted when a pass descriptor already carries timestampWrites, since a descriptor holds only one and the application's own profiling is never overwritten, or when the frame's timestamp slots are exhausted.",
    caveats: [
      "Zero is the healthy value. Any non-zero value means the gpu durations are partial, which is the only signal that they undercount.",
      "A rendering engine with its own timestamp profiling enabled will drive this above zero.",
      "A frame where every timestamp region was still reading back produces no gpu entry at all rather than a zero, so a rising gpu.resultLagFrameCount is the signal for that case.",
      SINGLE_FRAME_CAVEAT,
    ],
  },
};
