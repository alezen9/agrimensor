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

export type Agrimensor = {
  readonly capabilities: Capabilities;
  beginRenderFrame(): void;
  snapshot(): Snapshot;
  describe(metric: MetricPath): MetricDefinition;
  destroy(): void;
};
