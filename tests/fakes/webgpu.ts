/**
 * A deliberately small stand-in for the parts of WebGPU that Groma patches. It is not a
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

  readonly size: number;

  constructor(size = 0) {
    this.size = size;
  }

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
  copyBufferToBuffer(..._args: unknown[]) {}
  copyBufferToTexture(..._args: unknown[]) {}
  copyTextureToBuffer(..._args: unknown[]) {}
  copyTextureToTexture(..._args: unknown[]) {}

  beginRenderPass() {
    return new FakeRenderPassEncoder();
  }
  beginComputePass() {
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

export class FakeDevice {
  readonly queue = new FakeQueue();
  pipelineCreationError?: Error;

  createBuffer(descriptor: GPUBufferDescriptor) {
    return new FakeBuffer(descriptor.size);
  }
  createTexture(_descriptor: GPUTextureDescriptor) {
    return new FakeTexture();
  }
  createCommandEncoder() {
    return new FakeCommandEncoder();
  }
  createRenderBundleEncoder() {
    return new FakeRenderBundleEncoder();
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
