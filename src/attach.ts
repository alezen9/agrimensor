import { METRIC_DEFINITIONS } from "./definitions";
import { instrumentDevice, instrumentQueue } from "./instrumentation/device";
import { RestoreRegistry } from "./patch";
import { GromaState } from "./state";
import type {
  Capabilities,
  Groma,
  MetricDefinition,
  MetricPath,
  Snapshot,
} from "./types";

const attachedDevices = new WeakSet<GPUDevice>();

class GromaInstance implements Groma {
  // returned live so a consumer holding it sees frameScope flip on the first marked frame
  private readonly detectedCapabilities = { frameScope: false };

  private readonly state = new GromaState();
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
    const frame = this.state.getPublishedFrame();
    return frame ? { frame } : {};
  }

  describe(metric: MetricPath): MetricDefinition {
    const definition = METRIC_DEFINITIONS[metric];
    if (!definition) throw new Error(`groma: unknown metric "${metric}"`);
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
      throw new Error("groma: this instance has been destroyed");
    }
  }
}

export const attach = (device: GPUDevice): Groma => {
  if (attachedDevices.has(device)) {
    throw new Error("groma: this device already has an instance attached");
  }
  attachedDevices.add(device);
  return new GromaInstance(device);
};
