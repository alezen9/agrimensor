import { calculateBufferCopyBytes } from "../bufferBytes";
import { patchMethod } from "../patch";
import type { AgrimensorState } from "../state";
import type { PassKind } from "../types";
import { calculateCopyRegionBytes } from "../textureBytes";
import { instrumentComputePass, instrumentRenderPass } from "./passes";

/**
 * A pass descriptor carries exactly one timestampWrites, so when the application
 * already set it there is no way to co-instrument. Agrimensor yields and counts the
 * pass as uninstrumented rather than overwriting the application's own profiling.
 * The descriptor is copied rather than mutated, because engines reuse descriptor
 * objects between frames.
 */
const withTimestamps = <
  T extends { label?: string; timestampWrites?: unknown },
>(
  descriptor: T,
  state: AgrimensorState,
  kind: PassKind,
  encoderLabel: string,
): T => {
  const recorder = state.timestamps;
  if (!recorder?.isSupported) return descriptor;

  if (descriptor.timestampWrites) {
    recorder.countUninstrumentedPass();
    return descriptor;
  }

  const timestampWrites = recorder.claimPass(
    kind,
    descriptor.label || encoderLabel,
  );
  if (!timestampWrites) {
    recorder.countUninstrumentedPass();
    return descriptor;
  }

  return { ...descriptor, timestampWrites };
};

const instrumentCopies = (
  encoder: GPUCommandEncoder,
  state: AgrimensorState,
) => {
  patchMethod(
    encoder,
    "copyBufferToBuffer",
    (original) =>
      function (
        this: GPUCommandEncoder,
        // a rest of the union satisfies both the long form and the shorthand overload
        ...args: (GPUBuffer | GPUSize64 | undefined)[]
      ) {
        state.current.commandCopySumInBytes += calculateBufferCopyBytes(args);
        return Reflect.apply(original, this, args);
      },
  );

  patchMethod(
    encoder,
    "copyBufferToTexture",
    (original) =>
      function (
        this: GPUCommandEncoder,
        source: GPUTexelCopyBufferInfo,
        destination: GPUTexelCopyTextureInfo,
        copySize: GPUExtent3DStrict,
      ) {
        state.current.commandCopySumInBytes += calculateCopyRegionBytes(
          destination.texture.format,
          copySize,
        );
        return original.call(this, source, destination, copySize);
      },
  );

  patchMethod(
    encoder,
    "copyTextureToBuffer",
    (original) =>
      function (
        this: GPUCommandEncoder,
        source: GPUTexelCopyTextureInfo,
        destination: GPUTexelCopyBufferInfo,
        copySize: GPUExtent3DStrict,
      ) {
        state.current.commandCopySumInBytes += calculateCopyRegionBytes(
          source.texture.format,
          copySize,
        );
        return original.call(this, source, destination, copySize);
      },
  );

  patchMethod(
    encoder,
    "copyTextureToTexture",
    (original) =>
      function (
        this: GPUCommandEncoder,
        source: GPUTexelCopyTextureInfo,
        destination: GPUTexelCopyTextureInfo,
        copySize: GPUExtent3DStrict,
      ) {
        state.current.commandCopySumInBytes += calculateCopyRegionBytes(
          source.texture.format,
          copySize,
        );
        return original.call(this, source, destination, copySize);
      },
  );
};

export const instrumentCommandEncoder = (
  encoder: GPUCommandEncoder,
  state: AgrimensorState,
  encoderLabel: string,
) => {
  instrumentCopies(encoder, state);

  patchMethod(
    encoder,
    "beginRenderPass",
    (original) =>
      function (this: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) {
        state.current.renderPassCount++;
        const pass = original.call(
          this,
          withTimestamps(descriptor, state, "render", encoderLabel),
        );
        instrumentRenderPass(pass, state);
        return pass;
      },
  );

  patchMethod(
    encoder,
    "beginComputePass",
    (original) =>
      function (
        this: GPUCommandEncoder,
        descriptor?: GPUComputePassDescriptor,
      ) {
        state.current.computePassCount++;
        const pass = original.call(
          this,
          withTimestamps(descriptor ?? {}, state, "compute", encoderLabel),
        );
        instrumentComputePass(pass, state);
        return pass;
      },
  );
};
