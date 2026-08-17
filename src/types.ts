export type MetricUnit = "bytes" | "ms" | "count";

export type MetricSource =
  | "webgpu-timestamp-query"
  | "gpu-resource-descriptor"
  | "webgpu-api-observation"
  | "performance-clock"
  | "derived";

export type MetricConfidence = "measured" | "derived";

export type MetricDefinition = {
  readonly name: MetricPath;
  readonly unit: MetricUnit;
  readonly source: MetricSource;
  readonly confidence: MetricConfidence;
  readonly description: string;
  readonly methodology: string;
  readonly caveats: readonly string[];
  /**
   * A metric that answers the same question more reliably. Present when this figure
   * is easy to misread, so a dashboard showing one number can redirect. confidence
   * describes where a value came from, which is a different axis from whether it is
   * safe to read at face value, and the two can point opposite ways.
   */
  readonly preferInstead?: MetricPath;
};

export type ResourceMetrics = {
  readonly liveBufferCount: number;
  readonly liveTextureCount: number;
  readonly liveBufferAllocationSumInBytes: number;
  readonly liveTextureAllocationSumInBytes: number;
  readonly liveResourceAllocationSumInBytes: number;
  readonly liveResourceAllocationPeakInBytes: number;
};

export type FrameMetrics = {
  readonly renderedFrameCount: number;
  readonly drawCallCount: number;
  readonly computeDispatchCount: number;
  readonly renderPassCount: number;
  readonly computePassCount: number;
  readonly gpuSubmissionCount: number;
  readonly queueWriteSumInBytes: number;
  readonly commandCopySumInBytes: number;
  readonly pipelineCreationCount: number;
  readonly pipelineCreationBlockingDurationSumInMs: number;
};

export type GpuMetrics = {
  readonly resultLagFrameCount: number;
  readonly submittedRenderPassDurationSumInMs: number;
  readonly submittedComputePassDurationSumInMs: number;
  readonly submittedRenderAndComputePassExecutionInMs: number;
  readonly submittedRenderAndComputePassGapSumInMs: number;
  readonly uninstrumentedPassCount: number;
};

export type Snapshot = {
  /** Live levels, not flows, so these need no frame boundary and are always present. */
  readonly resources: ResourceMetrics;
  /**
   * Undefined until two beginRenderFrame() calls have happened: the tick that opens a
   * frame is what closes the previous one, so the first frame is not complete yet.
   * Also undefined for the whole run if beginRenderFrame() is never called, because a
   * frame boundary is the consumer's to declare and inferring one from rAF is wrong for
   * any app that renders on a divisor.
   */
  readonly frame?: FrameMetrics;
  /**
   * Timestamp results arrive several frames after the work they measure, so this
   * describes an older frame than `frame` does. resultLagFrameCount says how many
   * frames back. Undefined when the device lacks timestamp-query, when no frame has
   * resolved yet, or when the timestamps proved not to share a timeline.
   */
  readonly gpu?: GpuMetrics;
};

export type ResourceEntry = {
  /**
   * Stable for the life of the resource and never reused. Two identical textures
   * are separate entries with separate ids, so a consumer can key a list safely,
   * group duplicates itself, and tell "the same resource is still alive" from
   * "an identical one was allocated again".
   */
  readonly id: number;
  readonly kind: "buffer" | "texture";
  /** The label the application gave the resource, empty when it set none. */
  readonly label: string;
  readonly allocationInBytes: number;
  /**
   * The usage flags from the descriptor, unmodified. Bit-test against
   * GPUTextureUsage or GPUBufferUsage: RENDER_ATTACHMENT separates render targets
   * from asset textures at a glance.
   */
  readonly usage: number;
  /** Texture only, and the reason a shape is recognisable without a label. */
  readonly format?: GPUTextureFormat;
  readonly width?: number;
  readonly height?: number;
  readonly depthOrArrayLayers?: number;
  readonly sampleCount?: number;
  readonly mipLevelCount?: number;
};

export type Capabilities = {
  readonly resourceTracking: boolean;
  readonly frameScope: boolean;
  readonly timestampQueries: boolean;
  readonly crossSubmissionTimestampsComparable: boolean;
};

type LeafPaths<T, Prefix extends string> = {
  [K in keyof T & string]: `${Prefix}.${K}`;
}[keyof T & string];

export type MetricPath =
  | LeafPaths<ResourceMetrics, "resources">
  | LeafPaths<FrameMetrics, "frame">
  | LeafPaths<GpuMetrics, "gpu">;

/**
 * Fired the moment a resource is created or destroyed, which is the only point at
 * which the call stack still says where it came from. Agrimensor stores nothing of
 * its own here: what to capture, how much of it to keep and when to discard it are
 * decisions that belong to the consumer, not to a measurement library.
 *
 * A hook that throws is swallowed. It runs synchronously inside the call that
 * allocated the resource, so it must not call back into the device and must not do
 * expensive work: record and defer.
 */
export type AttachOptions = {
  readonly onResourceCreated?: (resource: ResourceEntry) => void;
  /**
   * Only fires for an explicit destroy(). A resource dropped to garbage collection
   * never calls it, so anything a consumer keys by id outlives such a resource and
   * has to tolerate that, exactly as the live totals do.
   */
  readonly onResourceDestroyed?: (resource: ResourceEntry) => void;
};

export type Agrimensor = {
  readonly capabilities: Capabilities;
  beginRenderFrame(): void;
  snapshot(): Snapshot;
  /**
   * The largest live resources by allocated bytes, biggest first. Deliberately not
   * part of snapshot(), which stays cheap enough to call every frame: this allocates
   * proportionally to the count requested and is meant for occasional inspection.
   *
   * Answers which allocation to go and look at, rather than only how many bytes exist
   * in total. It is not a resource explorer: there is no enumeration of everything, no
   * contents, and no lifetime history.
   */
  largestResources(count?: number): readonly ResourceEntry[];
  describe(metric: MetricPath): MetricDefinition;
  destroy(): void;
};
