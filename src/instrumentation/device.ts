import { patchMethod, type RestoreRegistry } from "../patch";
import type { AgrimensorState } from "../state";
import { instrumentCommandEncoder } from "./commandEncoder";
import { instrumentRenderBundleEncoder } from "./passes";

export const instrumentDevice = (
  device: GPUDevice,
  state: AgrimensorState,
  registry: RestoreRegistry,
) => {
  registry.add(
    patchMethod(
      device,
      "createBuffer",
      (original) =>
        function (this: GPUDevice, descriptor: GPUBufferDescriptor) {
          const buffer = original.call(this, descriptor);
          state.resources.trackBuffer(buffer, descriptor);
          return buffer;
        },
    ),
  );

  registry.add(
    patchMethod(
      device,
      "createTexture",
      (original) =>
        function (this: GPUDevice, descriptor: GPUTextureDescriptor) {
          const texture = original.call(this, descriptor);
          state.resources.trackTexture(texture, descriptor);
          return texture;
        },
    ),
  );

  registry.add(
    patchMethod(
      device,
      "createRenderPipelineAsync",
      (original) =>
        function (this: GPUDevice, descriptor: GPURenderPipelineDescriptor) {
          // counted when requested, not when resolved: this is the frame that asked for it.
          // deliberately no blocking duration, the cost is off the calling thread
          state.current.pipelineCreationCount++;
          return original.call(this, descriptor);
        },
    ),
  );

  registry.add(
    patchMethod(
      device,
      "createComputePipelineAsync",
      (original) =>
        function (this: GPUDevice, descriptor: GPUComputePipelineDescriptor) {
          state.current.pipelineCreationCount++;
          return original.call(this, descriptor);
        },
    ),
  );

  registry.add(
    patchMethod(
      device,
      "createCommandEncoder",
      (original) =>
        function (this: GPUDevice, descriptor?: GPUCommandEncoderDescriptor) {
          const encoder = original.call(this, descriptor);
          instrumentCommandEncoder(encoder, state);
          return encoder;
        },
    ),
  );

  registry.add(
    patchMethod(
      device,
      "createRenderBundleEncoder",
      (original) =>
        function (
          this: GPUDevice,
          descriptor: GPURenderBundleEncoderDescriptor,
        ) {
          const encoder = original.call(this, descriptor);
          instrumentRenderBundleEncoder(encoder, state);
          return encoder;
        },
    ),
  );

  registry.add(
    patchMethod(
      device,
      "createRenderPipeline",
      (original) =>
        function (this: GPUDevice, descriptor: GPURenderPipelineDescriptor) {
          const startedAt = performance.now();
          try {
            return original.call(this, descriptor);
          } finally {
            // finally so a failed creation still reports the time it blocked for
            state.current.pipelineCreationCount++;
            state.current.pipelineCreationBlockingDurationSumInMs +=
              performance.now() - startedAt;
          }
        },
    ),
  );

  registry.add(
    patchMethod(
      device,
      "createComputePipeline",
      (original) =>
        function (this: GPUDevice, descriptor: GPUComputePipelineDescriptor) {
          const startedAt = performance.now();
          try {
            return original.call(this, descriptor);
          } finally {
            state.current.pipelineCreationCount++;
            state.current.pipelineCreationBlockingDurationSumInMs +=
              performance.now() - startedAt;
          }
        },
    ),
  );
};
