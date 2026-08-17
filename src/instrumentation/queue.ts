import { calculateWrittenBufferBytes } from "../bufferBytes";
import { patchMethod, type RestoreRegistry } from "../patch";
import type { AgrimensorState } from "../state";
import { calculateCopyRegionBytes } from "../textureBytes";

export const instrumentQueue = (
  queue: GPUQueue,
  state: AgrimensorState,
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

  registry.add(
    patchMethod(
      queue,
      "writeBuffer",
      (original) =>
        function (
          this: GPUQueue,
          buffer: GPUBuffer,
          bufferOffset: GPUSize64,
          data: GPUAllowSharedBufferSource,
          dataOffset?: GPUSize64,
          size?: GPUSize64,
        ) {
          state.current.queueWriteSumInBytes += calculateWrittenBufferBytes(
            data,
            dataOffset,
            size,
          );
          return original.call(
            this,
            buffer,
            bufferOffset,
            data,
            dataOffset,
            size,
          );
        },
    ),
  );

  registry.add(
    patchMethod(
      queue,
      "writeTexture",
      (original) =>
        function (
          this: GPUQueue,
          destination: GPUTexelCopyTextureInfo,
          data: GPUAllowSharedBufferSource,
          dataLayout: GPUTexelCopyBufferLayout,
          size: GPUExtent3DStrict,
        ) {
          state.current.queueWriteSumInBytes += calculateCopyRegionBytes(
            destination.texture.format,
            size,
          );
          return original.call(this, destination, data, dataLayout, size);
        },
    ),
  );
};
