import type { FrameMetrics } from "./types";

export class FrameCounters {
  drawCallCount = 0;
  computeDispatchCount = 0;
  renderPassCount = 0;
  computePassCount = 0;
  pipelineCreationCount = 0;
  pipelineCreationBlockingDurationSumInMs = 0;
  gpuSubmissionCount = 0;

  reset() {
    this.drawCallCount = 0;
    this.computeDispatchCount = 0;
    this.renderPassCount = 0;
    this.computePassCount = 0;
    this.pipelineCreationCount = 0;
    this.pipelineCreationBlockingDurationSumInMs = 0;
    this.gpuSubmissionCount = 0;
  }
}

export class GromaState {
  readonly current = new FrameCounters();
  readonly bundleDrawCounts = new WeakMap<GPURenderBundle, number>();

  private startedFrameCount = 0;
  private published?: FrameMetrics;

  beginRenderFrame() {
    // the tick that opens frame N also closes frame N-1, so the first tick publishes nothing
    if (this.startedFrameCount > 0) {
      this.published = this.toFrameMetrics(this.startedFrameCount);
    }
    this.startedFrameCount++;
    this.current.reset();
  }

  getPublishedFrame() {
    return this.published;
  }

  private toFrameMetrics(renderedFrameCount: number): FrameMetrics {
    const {
      drawCallCount,
      computeDispatchCount,
      renderPassCount,
      computePassCount,
      pipelineCreationCount,
      pipelineCreationBlockingDurationSumInMs,
    } = this.current;

    return {
      renderedFrameCount,
      drawCallCount,
      computeDispatchCount,
      renderPassCount,
      computePassCount,
      pipelineCreationCount,
      pipelineCreationBlockingDurationSumInMs,
    };
  }
}
