import { patchMethod } from "../patch";
import type { GromaState } from "../state";
import { instrumentComputePass, instrumentRenderPass } from "./passes";

export const instrumentCommandEncoder = (
  encoder: GPUCommandEncoder,
  state: GromaState,
) => {
  patchMethod(
    encoder,
    "beginRenderPass",
    (original) =>
      function (this: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) {
        state.current.renderPassCount++;
        const pass = original.call(this, descriptor);
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
        const pass = original.call(this, descriptor);
        instrumentComputePass(pass, state);
        return pass;
      },
  );
};
