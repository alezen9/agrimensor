import { describe, expect, it } from "vitest";
import { attach } from "./attach";
import { asDevice, FakeDevice } from "./webgpu.fake";
import type { MetricPath } from "./types";

describe("attach", () => {
  it("refuses a second instance on the same device", () => {
    const device = asDevice(new FakeDevice());
    const agrimensor = attach(device);

    expect(() => attach(device)).toThrow(/already has an instance/);

    agrimensor.destroy();
  });

  it("allows re-attaching after destroy", () => {
    const device = asDevice(new FakeDevice());
    attach(device).destroy();

    expect(() => attach(device).destroy()).not.toThrow();
  });

  it("throws when used after destroy", () => {
    const agrimensor = attach(asDevice(new FakeDevice()));
    agrimensor.destroy();

    expect(() => agrimensor.snapshot()).toThrow(/destroyed/);
    expect(() => agrimensor.beginRenderFrame()).toThrow(/destroyed/);
  });

  it("is safe to destroy twice", () => {
    const agrimensor = attach(asDevice(new FakeDevice()));
    agrimensor.destroy();

    expect(() => agrimensor.destroy()).not.toThrow();
  });

  it("restores every patched device method on destroy", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    expect(Object.hasOwn(device, "createCommandEncoder")).toBe(true);
    expect(Object.hasOwn(device.queue, "submit")).toBe(true);

    agrimensor.destroy();

    expect(Object.hasOwn(device, "createCommandEncoder")).toBe(false);
    expect(Object.hasOwn(device, "createRenderBundleEncoder")).toBe(false);
    expect(Object.hasOwn(device, "createRenderPipeline")).toBe(false);
    expect(Object.hasOwn(device, "createComputePipeline")).toBe(false);
    expect(Object.hasOwn(device.queue, "submit")).toBe(false);
  });

  it("leaves the underlying calls working after destroy", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    agrimensor.destroy();

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass();
    pass.draw();

    expect(pass.calls).toEqual(["draw"]);
  });
});

describe("frame scope", () => {
  it("reports no frame until beginRenderFrame is called", () => {
    const agrimensor = attach(asDevice(new FakeDevice()));

    expect(agrimensor.snapshot().frame).toBeUndefined();
    expect(agrimensor.capabilities.frameScope).toBe(false);
  });

  it("reports no frame after only one boundary, since that frame is still open", () => {
    const agrimensor = attach(asDevice(new FakeDevice()));
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame).toBeUndefined();
    expect(agrimensor.capabilities.frameScope).toBe(true);
  });

  it("publishes a frame once the next boundary closes it", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    const pass = device.createCommandEncoder().beginRenderPass();
    pass.draw();
    pass.drawIndexed();
    agrimensor.beginRenderFrame();

    const { frame } = agrimensor.snapshot();
    expect(frame?.renderedFrameCount).toBe(1);
    expect(frame?.drawCallCount).toBe(2);
    expect(frame?.renderPassCount).toBe(1);
  });

  it("does not carry counts from one frame into the next", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    device.createCommandEncoder().beginRenderPass().draw();
    agrimensor.beginRenderFrame();
    agrimensor.beginRenderFrame();

    const { frame } = agrimensor.snapshot();
    expect(frame?.renderedFrameCount).toBe(2);
    expect(frame?.drawCallCount).toBe(0);
  });
});

describe("counters", () => {
  it("counts all four draw commands as draws", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    const pass = device.createCommandEncoder().beginRenderPass();
    pass.draw();
    pass.drawIndexed();
    pass.drawIndirect();
    pass.drawIndexedIndirect();
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.drawCallCount).toBe(4);
  });

  it("counts both dispatch commands and the compute pass", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    const pass = device.createCommandEncoder().beginComputePass();
    pass.dispatchWorkgroups();
    pass.dispatchWorkgroupsIndirect();
    agrimensor.beginRenderFrame();

    const { frame } = agrimensor.snapshot();
    expect(frame?.computeDispatchCount).toBe(2);
    expect(frame?.computePassCount).toBe(1);
  });

  it("re-adds a bundle's draws on every replay", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    const bundleEncoder = device.createRenderBundleEncoder();
    bundleEncoder.draw();
    bundleEncoder.draw();
    bundleEncoder.drawIndexed();
    const bundle = bundleEncoder.finish();

    agrimensor.beginRenderFrame();
    const pass = device.createCommandEncoder().beginRenderPass();
    pass.executeBundles([bundle]);
    pass.executeBundles([bundle]);
    agrimensor.beginRenderFrame();

    // recording the bundle must not count, only the two replays of its three draws
    expect(agrimensor.snapshot().frame?.drawCallCount).toBe(6);
  });

  it("counts a pipeline creation that throws, and lets the error through", () => {
    const device = new FakeDevice();
    device.pipelineCreationError = new Error("bad shader");
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    expect(() => device.createRenderPipeline()).toThrow("bad shader");
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.pipelineCreationCount).toBe(1);
  });

  it("stops instrumenting encoders created after destroy", () => {
    const device = new FakeDevice();
    attach(asDevice(device)).destroy();

    const pass = device.createCommandEncoder().beginRenderPass();

    expect(Object.hasOwn(pass, "draw")).toBe(false);
    expect(Object.hasOwn(pass, "executeBundles")).toBe(false);
  });
});

const snapshotMetricPaths = () => {
  const agrimensor = attach(asDevice(new FakeDevice()));
  agrimensor.beginRenderFrame();
  agrimensor.beginRenderFrame();

  const { resources, frame } = agrimensor.snapshot();
  expect(frame).toBeDefined();

  return [
    ...Object.keys(resources).map((key) => `resources.${key}`),
    ...Object.keys(frame ?? {}).map((key) => `frame.${key}`),
  ] as MetricPath[];
};

// the reverse direction, that no definition exists without a matching metric, is
// enforced by the compiler: METRIC_DEFINITIONS is typed Record<MetricPath, ...>, so a
// missing entry fails to typecheck and an extra one is rejected as an unknown property
describe("describe", () => {
  it("has a complete definition for every metric a snapshot exposes", () => {
    const agrimensor = attach(asDevice(new FakeDevice()));

    for (const path of snapshotMetricPaths()) {
      const definition = agrimensor.describe(path);

      expect(definition.name).toBe(path);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.methodology.length).toBeGreaterThan(0);
      expect(definition.caveats.length).toBeGreaterThan(0);
    }
  });
});

describe("pipeline creation", () => {
  it("counts async pipeline creation, which three uses during compileAsync", async () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    await device.createRenderPipelineAsync({} as GPURenderPipelineDescriptor);
    await device.createComputePipelineAsync({} as GPUComputePipelineDescriptor);
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.pipelineCreationCount).toBe(2);
  });

  it("keeps async creation out of blocking time, since it does not block", async () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    await device.createRenderPipelineAsync({} as GPURenderPipelineDescriptor);
    agrimensor.beginRenderFrame();

    expect(
      agrimensor.snapshot().frame?.pipelineCreationBlockingDurationSumInMs,
    ).toBe(0);
  });
});

describe("submissions", () => {
  it("counts queue submissions per frame", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    device.queue.submit([]);
    device.queue.submit([]);
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.gpuSubmissionCount).toBe(2);
  });
});
