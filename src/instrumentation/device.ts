import { patchMethod, type RestoreRegistry } from "../patch";
import type { GromaState } from "../state";
import { instrumentCommandEncoder } from "./commandEncoder";
import { instrumentRenderBundleEncoder } from "./passes";

export const instrumentDevice = (
  device: GPUDevice,
  state: GromaState,
  registry: RestoreRegistry,
) => {
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

export const instrumentQueue = (
  queue: GPUQueue,
  state: GromaState,
  registry: RestoreRegistry,
) => {
  registry.add(
    patchMethod(
      queue,
      "submit",
      (original) =>
        function (this: GPUQueue, commandBuffers: Iterable<GPUCommandBuffer>) {
          state.current.gpuSubmissionCount++;
          return original.call(this, commandBuffers);
        },
    ),
  );
};
