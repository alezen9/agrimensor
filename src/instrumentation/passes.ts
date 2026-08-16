import { patchMethod } from "../patch";
import type { GromaState } from "../state";

// these are unrolled rather than looped over a list of method names: the four draw
// signatures differ, so a loop would collapse them into a union that only typechecks
// behind a cast

export const instrumentRenderPass = (
  pass: GPURenderPassEncoder,
  state: GromaState,
) => {
  patchMethod(
    pass,
    "draw",
    (original) =>
      function (
        this: GPURenderPassEncoder,
        ...args: Parameters<GPURenderPassEncoder["draw"]>
      ) {
        state.current.drawCallCount++;
        return original.apply(this, args);
      },
  );

  patchMethod(
    pass,
    "drawIndexed",
    (original) =>
      function (
        this: GPURenderPassEncoder,
        ...args: Parameters<GPURenderPassEncoder["drawIndexed"]>
      ) {
        state.current.drawCallCount++;
        return original.apply(this, args);
      },
  );

  patchMethod(
    pass,
    "drawIndirect",
    (original) =>
      function (
        this: GPURenderPassEncoder,
        ...args: Parameters<GPURenderPassEncoder["drawIndirect"]>
      ) {
        state.current.drawCallCount++;
        return original.apply(this, args);
      },
  );

  patchMethod(
    pass,
    "drawIndexedIndirect",
    (original) =>
      function (
        this: GPURenderPassEncoder,
        ...args: Parameters<GPURenderPassEncoder["drawIndexedIndirect"]>
      ) {
        state.current.drawCallCount++;
        return original.apply(this, args);
      },
  );

  patchMethod(
    pass,
    "executeBundles",
    (original) =>
      function (
        this: GPURenderPassEncoder,
        bundles: Iterable<GPURenderBundle>,
      ) {
        // a bundle's draws were counted once when it was finished, so each replay has to
        // re-add them or drawCallCount silently undercounts every frame that uses bundles
        for (const bundle of bundles) {
          state.current.drawCallCount +=
            state.bundleDrawCounts.get(bundle) ?? 0;
        }
        return original.call(this, bundles);
      },
  );
};

export const instrumentComputePass = (
  pass: GPUComputePassEncoder,
  state: GromaState,
) => {
  patchMethod(
    pass,
    "dispatchWorkgroups",
    (original) =>
      function (
        this: GPUComputePassEncoder,
        ...args: Parameters<GPUComputePassEncoder["dispatchWorkgroups"]>
      ) {
        state.current.computeDispatchCount++;
        return original.apply(this, args);
      },
  );

  patchMethod(
    pass,
    "dispatchWorkgroupsIndirect",
    (original) =>
      function (
        this: GPUComputePassEncoder,
        ...args: Parameters<GPUComputePassEncoder["dispatchWorkgroupsIndirect"]>
      ) {
        state.current.computeDispatchCount++;
        return original.apply(this, args);
      },
  );
};

export const instrumentRenderBundleEncoder = (
  encoder: GPURenderBundleEncoder,
  state: GromaState,
) => {
  const counter = { drawCount: 0 };

  patchMethod(
    encoder,
    "draw",
    (original) =>
      function (
        this: GPURenderBundleEncoder,
        ...args: Parameters<GPURenderBundleEncoder["draw"]>
      ) {
        counter.drawCount++;
        return original.apply(this, args);
      },
  );

  patchMethod(
    encoder,
    "drawIndexed",
    (original) =>
      function (
        this: GPURenderBundleEncoder,
        ...args: Parameters<GPURenderBundleEncoder["drawIndexed"]>
      ) {
        counter.drawCount++;
        return original.apply(this, args);
      },
  );

  patchMethod(
    encoder,
    "drawIndirect",
    (original) =>
      function (
        this: GPURenderBundleEncoder,
        ...args: Parameters<GPURenderBundleEncoder["drawIndirect"]>
      ) {
        counter.drawCount++;
        return original.apply(this, args);
      },
  );

  patchMethod(
    encoder,
    "drawIndexedIndirect",
    (original) =>
      function (
        this: GPURenderBundleEncoder,
        ...args: Parameters<GPURenderBundleEncoder["drawIndexedIndirect"]>
      ) {
        counter.drawCount++;
        return original.apply(this, args);
      },
  );

  patchMethod(
    encoder,
    "finish",
    (original) =>
      function (
        this: GPURenderBundleEncoder,
        descriptor?: GPURenderBundleDescriptor,
      ) {
        const bundle = original.call(this, descriptor);
        state.bundleDrawCounts.set(bundle, counter.drawCount);
        return bundle;
      },
  );
};
