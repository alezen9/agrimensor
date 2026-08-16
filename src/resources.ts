import { patchMethod } from "./patch";
import type { ResourceMetrics } from "./types";

/**
 * Live totals for resources created through the attached device.
 *
 * Destruction is observed by shadowing destroy() on each resource. Those shadows are
 * deliberately not registered for restore on Groma.destroy(): holding a restore per
 * resource would keep every buffer and texture reachable and defeat garbage collection.
 * A shadow dies with the object it sits on.
 */
export class ResourceRegistry {
  private bufferCount = 0;
  private textureCount = 0;
  private bufferBytes = 0;
  private textureBytes = 0;
  private peakBytes = 0;

  trackBuffer(buffer: GPUBuffer, allocationInBytes: number) {
    this.bufferCount++;
    this.bufferBytes += allocationInBytes;
    this.recordPeak();
    this.observeDestroy(buffer, "buffer", allocationInBytes);
  }

  trackTexture(texture: GPUTexture, allocationInBytes: number) {
    this.textureCount++;
    this.textureBytes += allocationInBytes;
    this.recordPeak();
    this.observeDestroy(texture, "texture", allocationInBytes);
  }

  toMetrics(): ResourceMetrics {
    const liveResourceAllocationSumInBytes =
      this.bufferBytes + this.textureBytes;

    return {
      liveBufferCount: this.bufferCount,
      liveTextureCount: this.textureCount,
      liveBufferAllocationSumInBytes: this.bufferBytes,
      liveTextureAllocationSumInBytes: this.textureBytes,
      liveResourceAllocationSumInBytes,
      liveResourceAllocationPeakInBytes: this.peakBytes,
    };
  }

  private observeDestroy(
    resource: GPUBuffer | GPUTexture,
    kind: "buffer" | "texture",
    allocationInBytes: number,
  ) {
    const registry = this;
    const release = { isDone: false };

    patchMethod(
      resource,
      "destroy",
      (original) =>
        function (this: GPUBuffer & GPUTexture) {
          // destroy() is idempotent in WebGPU, so only the first call may decrement
          if (!release.isDone) {
            release.isDone = true;
            registry.release(kind, allocationInBytes);
          }
          return original.call(this);
        },
    );
  }

  private release(kind: "buffer" | "texture", allocationInBytes: number) {
    if (kind === "buffer") {
      this.bufferCount--;
      this.bufferBytes -= allocationInBytes;
      return;
    }
    this.textureCount--;
    this.textureBytes -= allocationInBytes;
  }

  private recordPeak() {
    const total = this.bufferBytes + this.textureBytes;
    if (total > this.peakBytes) this.peakBytes = total;
  }
}
