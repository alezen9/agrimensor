/**
 * A deliberately small stand-in for the parts of WebGPU that Agrimensor patches. It is not a
 * WebGPU implementation and should never grow into one.
 *
 * Methods live on the prototypes on purpose: that is where WebIDL puts them, and it is
 * what makes the restore-on-destroy tests meaningful. A fake with own-property methods
 * would pass those tests for the wrong reason.
 *
 * The casts below are the one place casting is justified. Structurally implementing
 * GPUDevice and friends would mean reimplementing WebGPU, which the mock must not do.
 */

export class FakeRenderBundle {}

export class FakeBuffer {
  destroyCount = 0;
  mapped?: ArrayBuffer;

  readonly size: number;

  constructor(size = 0) {
    this.size = size;
  }

  async mapAsync() {}

  getMappedRange(offset = 0, size = this.size) {
    this.mapped ??= new ArrayBuffer(this.size);
    return this.mapped.slice(offset, offset + size);
  }

  unmap() {}

  destroy() {
    this.destroyCount++;
  }
}

export class FakeTexture {
  destroyCount = 0;

  destroy() {
    this.destroyCount++;
  }
}

export class FakeRenderPassEncoder {
  readonly calls: string[] = [];

  draw() {
    this.calls.push("draw");
  }
  drawIndexed() {
    this.calls.push("drawIndexed");
  }
  drawIndirect() {
    this.calls.push("drawIndirect");
  }
  drawIndexedIndirect() {
    this.calls.push("drawIndexedIndirect");
  }
  executeBundles(bundles: Iterable<FakeRenderBundle>) {
    this.calls.push(`executeBundles:${[...bundles].length}`);
  }
}

export class FakeComputePassEncoder {
  readonly calls: string[] = [];

  dispatchWorkgroups() {
    this.calls.push("dispatchWorkgroups");
  }
  dispatchWorkgroupsIndirect() {
    this.calls.push("dispatchWorkgroupsIndirect");
  }
}

export class FakeRenderBundleEncoder {
  draw() {}
  drawIndexed() {}
  drawIndirect() {}
  drawIndexedIndirect() {}
  finish() {
    return new FakeRenderBundle();
  }
}

export class FakeCommandEncoder {
  lastRenderPassDescriptor: { timestampWrites?: unknown } | undefined;
  lastComputePassDescriptor: { timestampWrites?: unknown } | undefined;

  resolveQuerySet(..._args: unknown[]) {}
  finish() {
    return { kind: "command-buffer" };
  }
  copyBufferToBuffer(..._args: unknown[]) {}
  copyBufferToTexture(..._args: unknown[]) {}
  copyTextureToBuffer(..._args: unknown[]) {}
  copyTextureToTexture(..._args: unknown[]) {}

  beginRenderPass(descriptor?: { timestampWrites?: unknown }) {
    this.lastRenderPassDescriptor = descriptor;
    return new FakeRenderPassEncoder();
  }
  beginComputePass(descriptor?: { timestampWrites?: unknown }) {
    this.lastComputePassDescriptor = descriptor;
    return new FakeComputePassEncoder();
  }
}

export class FakeQueue {
  readonly submitted: unknown[][] = [];

  submit(commandBuffers: Iterable<unknown>) {
    this.submitted.push([...commandBuffers]);
  }
  writeBuffer(..._args: unknown[]) {}
  writeTexture(..._args: unknown[]) {}
}

/**
 * Enough of a query set and mappable buffer to drive TimestampRecorder end to end.
 * Timestamps are supplied by the test rather than a GPU, so the recorder's slot
 * bookkeeping and readback path can be checked against known values.
 */
export class FakeQuerySet {
  destroyed = false;

  destroy() {
    this.destroyed = true;
  }
}

export const withTimestampSupport = (device: FakeDevice) => {
  device.features.add("timestamp-query");
  return device;
};

export class FakeDevice {
  readonly queue = new FakeQueue();
  // empty by default, so the timestamp recorder reports unsupported and the
  // resource and counter tests exercise the path most devices without the
  // feature would take
  readonly features = new Set<string>();
  readonly querySets: FakeQuerySet[] = [];
  readonly encoders: FakeCommandEncoder[] = [];
  pipelineCreationError?: Error;

  createQuerySet(_descriptor: GPUQuerySetDescriptor) {
    const querySet = new FakeQuerySet();
    this.querySets.push(querySet);
    return querySet;
  }
  createBuffer(descriptor: GPUBufferDescriptor) {
    return new FakeBuffer(descriptor.size);
  }
  createTexture(_descriptor: GPUTextureDescriptor) {
    return new FakeTexture();
  }
  createCommandEncoder() {
    const encoder = new FakeCommandEncoder();
    this.encoders.push(encoder);
    return encoder;
  }
  createRenderBundleEncoder() {
    return new FakeRenderBundleEncoder();
  }
  createRenderPipelineAsync(_descriptor: GPURenderPipelineDescriptor) {
    return Promise.resolve({ kind: "render-pipeline" });
  }
  createComputePipelineAsync(_descriptor: GPUComputePipelineDescriptor) {
    return Promise.resolve({ kind: "compute-pipeline" });
  }
  createRenderPipeline() {
    if (this.pipelineCreationError) throw this.pipelineCreationError;
    return { kind: "render-pipeline" };
  }
  createComputePipeline() {
    if (this.pipelineCreationError) throw this.pipelineCreationError;
    return { kind: "compute-pipeline" };
  }
}

export const asDevice = (device: FakeDevice) =>
  device as unknown as GPUDevice & FakeDevice;
