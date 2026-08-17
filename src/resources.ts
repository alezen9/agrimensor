import { patchMethod } from "./patch";
import { calculateTextureAllocationBytes } from "./textureBytes";
import type { AttachOptions, ResourceEntry, ResourceMetrics } from "./types";

const DEFAULT_LARGEST_COUNT = 10;

type TrackedResource = ResourceEntry;

/**
 * A consumer's broken hook must never reach the call that allocated or released the
 * resource, the same containment the timing path got in alpha.6.
 */
const notify = (
  hook: ((resource: ResourceEntry) => void) | undefined,
  resource: TrackedResource,
) => {
  if (!hook) return;
  try {
    hook(resource);
  } catch {
    // deliberately swallowed
  }
};

const describeTexture = (
  id: number,
  descriptor: GPUTextureDescriptor,
  allocationInBytes: number,
): TrackedResource => {
  const size = descriptor.size;
  const extent =
    Symbol.iterator in size
      ? (() => {
          const [width = 1, height = 1, depthOrArrayLayers = 1] = [...size];
          return { width, height, depthOrArrayLayers };
        })()
      : {
          width: size.width,
          height: size.height ?? 1,
          depthOrArrayLayers: size.depthOrArrayLayers ?? 1,
        };

  return {
    id,
    kind: "texture",
    label: descriptor.label ?? "",
    allocationInBytes,
    usage: descriptor.usage,
    format: descriptor.format,
    ...extent,
    sampleCount: descriptor.sampleCount ?? 1,
    mipLevelCount: descriptor.mipLevelCount ?? 1,
  };
};

/**
 * Live totals for resources created through the attached device.
 *
 * Destruction is observed by shadowing destroy() on each resource. Those shadows are
 * deliberately not registered for restore on Agrimensor.destroy(): holding a restore per
 * resource would keep every buffer and texture reachable and defeat garbage collection.
 * A shadow dies with the object it sits on.
 */
export class ResourceRegistry {
  private readonly options: AttachOptions;
  private bufferCount = 0;
  private textureCount = 0;
  private bufferBytes = 0;
  private textureBytes = 0;
  private peakBytes = 0;
  // holds descriptor facts and never the GPU object, so it cannot keep a resource
  // alive. Entries are dropped on destroy rather than accumulating.
  private readonly tracked = new Set<TrackedResource>();
  private nextId = 1;

  constructor(options: AttachOptions = {}) {
    this.options = options;
  }

  trackBuffer(buffer: GPUBuffer, descriptor: GPUBufferDescriptor) {
    const allocationInBytes = descriptor.size;
    this.bufferCount++;
    this.bufferBytes += allocationInBytes;
    this.recordPeak();

    const entry: TrackedResource = {
      id: this.nextId++,
      kind: "buffer",
      label: descriptor.label ?? "",
      allocationInBytes,
      usage: descriptor.usage,
    };
    this.tracked.add(entry);
    this.observeDestroy(buffer, "buffer", allocationInBytes, entry);
    // notified last, so the resource a consumer sees is already tracked and its
    // destruction already observable
    notify(this.options.onResourceCreated, entry);
  }

  trackTexture(texture: GPUTexture, descriptor: GPUTextureDescriptor) {
    const allocationInBytes = calculateTextureAllocationBytes(descriptor);
    this.textureCount++;
    this.textureBytes += allocationInBytes;
    this.recordPeak();

    const entry = describeTexture(this.nextId++, descriptor, allocationInBytes);
    this.tracked.add(entry);
    this.observeDestroy(texture, "texture", allocationInBytes, entry);
    notify(this.options.onResourceCreated, entry);
  }

  largestResources(count = DEFAULT_LARGEST_COUNT): readonly ResourceEntry[] {
    // membership is the single source of truth: an entry is dropped on destroy, so
    // the set never holds anything that is not live and cannot grow under churn
    const live = [...this.tracked];
    live.sort((a, b) => b.allocationInBytes - a.allocationInBytes);
    return live.slice(0, Math.max(0, count));
  }

  /** Internal, for tests that need to prove the set does not grow under churn. */
  get trackedCount() {
    return this.tracked.size;
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
    entry: TrackedResource,
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
            registry.forget(entry);
            registry.release(kind, allocationInBytes);
            notify(registry.options.onResourceDestroyed, entry);
          }
          return original.call(this);
        },
    );
  }

  private forget(entry: TrackedResource) {
    this.tracked.delete(entry);
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
