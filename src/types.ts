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
  readonly uploadedSumInBytes: number;
  readonly readbackSumInBytes: number;
  readonly gpuInternalCopySumInBytes: number;
  readonly pipelineCreationCount: number;
  readonly pipelineCreationBlockingDurationSumInMs: number;
};

// every field is optional: results resolve several frames after the work, and the
// span is gated on a runtime check that cross-submission timestamps stay ordered
export type GpuMetrics = {
  readonly resultLagFrameCount?: number;
  readonly submittedRenderPassDurationSumInMs?: number;
  readonly submittedComputePassDurationSumInMs?: number;
  readonly submittedPassSpanInMs?: number;
  readonly uninstrumentedPassCount?: number;
};

export type Snapshot = {
  readonly resources: ResourceMetrics;
  // undefined until beginRenderFrame() is called: a frame boundary is the consumer's
  // to declare, and guessing one from rAF is wrong for any app that renders on a divisor
  readonly frame?: FrameMetrics;
  readonly gpu?: GpuMetrics;
};

export type Capabilities = {
  readonly resourceTracking: boolean;
  readonly timestampQueries: boolean;
  readonly frameScope: boolean;
  readonly crossSubmissionTimestampsComparable: boolean;
};

type LeafPaths<T, Prefix extends string> = {
  [K in keyof T & string]: `${Prefix}.${K}`;
}[keyof T & string];

export type MetricPath =
  | LeafPaths<ResourceMetrics, "resources">
  | LeafPaths<FrameMetrics, "frame">
  | LeafPaths<GpuMetrics, "gpu">;

export type Groma = {
  readonly capabilities: Capabilities;
  beginRenderFrame(): void;
  snapshot(): Snapshot;
  describe(metric: MetricPath): MetricDefinition;
  destroy(): void;
};
