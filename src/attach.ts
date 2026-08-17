import { METRIC_DEFINITIONS } from "./definitions";
import { instrumentDevice } from "./instrumentation/device";
import { instrumentQueue } from "./instrumentation/queue";
import { RestoreRegistry } from "./patch";
import { AgrimensorState } from "./state";
import type {
  Capabilities,
  Agrimensor,
  MetricDefinition,
  MetricPath,
  Snapshot,
} from "./types";

const attachedDevices = new WeakSet<GPUDevice>();

class AgrimensorInstance implements Agrimensor {
  // returned live so a consumer holding it sees frameScope flip on the first marked frame
  private readonly detectedCapabilities = {
    resourceTracking: true,
    frameScope: false,
  };

  private readonly state = new AgrimensorState();
  private readonly registry = new RestoreRegistry();
  private readonly device: GPUDevice;
  private isDestroyed = false;

  constructor(device: GPUDevice) {
    this.device = device;
    instrumentDevice(device, this.state, this.registry);
    instrumentQueue(device.queue, this.state, this.registry);
  }

  get capabilities(): Capabilities {
    return this.detectedCapabilities;
  }

  beginRenderFrame() {
    this.assertUsable();
    this.detectedCapabilities.frameScope = true;
    this.state.beginRenderFrame();
  }

  snapshot(): Snapshot {
    this.assertUsable();
    const resources = this.state.resources.toMetrics();
    const frame = this.state.getPublishedFrame();
    return frame ? { resources, frame } : { resources };
  }

  describe(metric: MetricPath): MetricDefinition {
    const definition = METRIC_DEFINITIONS[metric];
    if (!definition) throw new Error(`agrimensor: unknown metric "${metric}"`);
    return definition;
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.registry.runAll();
    attachedDevices.delete(this.device);
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
