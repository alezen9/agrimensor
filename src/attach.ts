import { METRIC_DEFINITIONS } from "./definitions";
import { instrumentDevice } from "./instrumentation/device";
import { instrumentQueue } from "./instrumentation/queue";
import { RestoreRegistry } from "./patch";
import { AgrimensorState } from "./state";
import { TimestampRecorder } from "./timestamps";
import type {
  Capabilities,
  Agrimensor,
  GpuMetrics,
  MetricDefinition,
  MetricPath,
  Snapshot,
} from "./types";

const attachedDevices = new WeakSet<GPUDevice>();

class AgrimensorInstance implements Agrimensor {
  private readonly detectedCapabilities = {
    resourceTracking: true,
    frameScope: false,
    timestampQueries: false,
    crossSubmissionTimestampsComparable: true,
  };

  private readonly state = new AgrimensorState();
  private readonly registry = new RestoreRegistry();
  private readonly device: GPUDevice;
  private isDestroyed = false;

  constructor(device: GPUDevice) {
    this.device = device;
    // the recorder is created before instrumentation so its own query set and
    // buffers are not counted as consumer resources
    const recorder = new TimestampRecorder(device);
    this.state.timestamps = recorder;
    this.detectedCapabilities.timestampQueries = recorder.isSupported;

    instrumentDevice(device, this.state, this.registry);
    instrumentQueue(device.queue, this.state, this.registry);
  }

  /**
   * A fresh frozen object per read, matching snapshot(). Returning the live one
   * would hand back a stable identity that mutates underneath, so a consumer holding
   * it in reactive state would never see a capability change.
   */
  get capabilities(): Capabilities {
    return Object.freeze({ ...this.detectedCapabilities });
  }

  beginRenderFrame() {
    this.assertUsable();
    this.detectedCapabilities.frameScope = true;
    this.state.beginRenderFrame();

    const recorder = this.state.timestamps;
    if (!recorder) return;

    recorder.rotate(this.state.getStartedFrameCount());
    this.detectedCapabilities.crossSubmissionTimestampsComparable =
      recorder.isCrossSubmissionComparable;
  }

  snapshot(): Snapshot {
    this.assertUsable();
    const resources = this.state.resources.toMetrics();
    const frame = this.state.getPublishedFrame();
    const gpu = this.toGpuMetrics();

    if (frame && gpu) return { resources, frame, gpu };
    if (frame) return { resources, frame };
    return { resources };
  }

  largestResources(count?: number) {
    this.assertUsable();
    return this.state.resources.largestResources(count);
  }

  describe(metric: MetricPath): MetricDefinition {
    const definition = METRIC_DEFINITIONS[metric];
    if (!definition) throw new Error(`agrimensor: unknown metric "${metric}"`);
    return definition;
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.state.timestamps?.destroy();
    this.registry.runAll();
    attachedDevices.delete(this.device);
  }

  private toGpuMetrics(): GpuMetrics | undefined {
    const recorder = this.state.timestamps;
    const latest = recorder?.getLatest();
    if (!recorder || !latest || !recorder.isCrossSubmissionComparable) {
      return undefined;
    }

    return {
      resultLagFrameCount:
        this.state.getStartedFrameCount() - latest.frameNumber,
      submittedRenderPassDurationSumInMs: latest.renderPassDurationSumInMs,
      submittedComputePassDurationSumInMs: latest.computePassDurationSumInMs,
      submittedRenderAndComputePassExecutionInMs: latest.executionInMs,
      submittedRenderAndComputePassGapSumInMs: latest.gapSumInMs,
      uninstrumentedPassCount: latest.uninstrumentedPassCount,
    };
  }

  private assertUsable() {
    if (this.isDestroyed) {
      throw new Error("agrimensor: this instance has been destroyed");
    }
  }
}

export const attach = (device: GPUDevice): Agrimensor => {
  if (attachedDevices.has(device)) {
    throw new Error("agrimensor: this device already has an instance attached");
  }
  attachedDevices.add(device);
  return new AgrimensorInstance(device);
};
