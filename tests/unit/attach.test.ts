import { describe, expect, it } from "vitest";
import { attach } from "../../src/attach";
import { METRIC_DEFINITIONS } from "../../src/definitions";
import { asDevice, FakeDevice } from "../fakes/webgpu";
import type { MetricPath } from "../../src/types";

describe("attach", () => {
  it("refuses a second instance on the same device", () => {
    const device = asDevice(new FakeDevice());
    const groma = attach(device);

    expect(() => attach(device)).toThrow(/already has an instance/);

    groma.destroy();
  });

  it("allows re-attaching after destroy", () => {
    const device = asDevice(new FakeDevice());
    attach(device).destroy();

    expect(() => attach(device).destroy()).not.toThrow();
  });

  it("throws when used after destroy", () => {
    const groma = attach(asDevice(new FakeDevice()));
    groma.destroy();

    expect(() => groma.snapshot()).toThrow(/destroyed/);
    expect(() => groma.beginRenderFrame()).toThrow(/destroyed/);
  });

  it("is safe to destroy twice", () => {
    const groma = attach(asDevice(new FakeDevice()));
    groma.destroy();

    expect(() => groma.destroy()).not.toThrow();
  });

  it("restores every patched device method on destroy", () => {
    const device = new FakeDevice();
    const groma = attach(asDevice(device));

    expect(Object.hasOwn(device, "createCommandEncoder")).toBe(true);
    expect(Object.hasOwn(device.queue, "submit")).toBe(true);

    groma.destroy();

    expect(Object.hasOwn(device, "createCommandEncoder")).toBe(false);
    expect(Object.hasOwn(device, "createRenderBundleEncoder")).toBe(false);
    expect(Object.hasOwn(device, "createRenderPipeline")).toBe(false);
    expect(Object.hasOwn(device, "createComputePipeline")).toBe(false);
    expect(Object.hasOwn(device.queue, "submit")).toBe(false);
  });

  it("leaves the underlying calls working after destroy", () => {
    const device = new FakeDevice();
    const groma = attach(asDevice(device));
    groma.destroy();

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass();
    pass.draw();

    expect(pass.calls).toEqual(["draw"]);
  });
});

describe("frame scope", () => {
  it("reports no frame until beginRenderFrame is called", () => {
    const groma = attach(asDevice(new FakeDevice()));

    expect(groma.snapshot().frame).toBeUndefined();
    expect(groma.capabilities.frameScope).toBe(false);
  });

  it("reports no frame after only one boundary, since that frame is still open", () => {
    const groma = attach(asDevice(new FakeDevice()));
    groma.beginRenderFrame();

    expect(groma.snapshot().frame).toBeUndefined();
    expect(groma.capabilities.frameScope).toBe(true);
  });

  it("publishes a frame once the next boundary closes it", () => {
    const device = new FakeDevice();
    const groma = attach(asDevice(device));

    groma.beginRenderFrame();
    const pass = device.createCommandEncoder().beginRenderPass();
    pass.draw();
    pass.drawIndexed();
    groma.beginRenderFrame();

    const { frame } = groma.snapshot();
    expect(frame?.renderedFrameCount).toBe(1);
    expect(frame?.drawCallCount).toBe(2);
    expect(frame?.renderPassCount).toBe(1);
  });

  it("does not carry counts from one frame into the next", () => {
    const device = new FakeDevice();
    const groma = attach(asDevice(device));

    groma.beginRenderFrame();
    device.createCommandEncoder().beginRenderPass().draw();
    groma.beginRenderFrame();
    groma.beginRenderFrame();

    const { frame } = groma.snapshot();
    expect(frame?.renderedFrameCount).toBe(2);
    expect(frame?.drawCallCount).toBe(0);
  });
});

describe("counters", () => {
  it("counts all four draw commands as draws", () => {
    const device = new FakeDevice();
    const groma = attach(asDevice(device));

    groma.beginRenderFrame();
    const pass = device.createCommandEncoder().beginRenderPass();
    pass.draw();
    pass.drawIndexed();
    pass.drawIndirect();
    pass.drawIndexedIndirect();
    groma.beginRenderFrame();

    expect(groma.snapshot().frame?.drawCallCount).toBe(4);
  });

  it("counts both dispatch commands and the compute pass", () => {
    const device = new FakeDevice();
    const groma = attach(asDevice(device));

    groma.beginRenderFrame();
    const pass = device.createCommandEncoder().beginComputePass();
    pass.dispatchWorkgroups();
    pass.dispatchWorkgroupsIndirect();
    groma.beginRenderFrame();

    const { frame } = groma.snapshot();
    expect(frame?.computeDispatchCount).toBe(2);
    expect(frame?.computePassCount).toBe(1);
  });

  it("re-adds a bundle's draws on every replay", () => {
    const device = new FakeDevice();
    const groma = attach(asDevice(device));

    const bundleEncoder = device.createRenderBundleEncoder();
    bundleEncoder.draw();
    bundleEncoder.draw();
    bundleEncoder.drawIndexed();
    const bundle = bundleEncoder.finish();

    groma.beginRenderFrame();
    const pass = device.createCommandEncoder().beginRenderPass();
    pass.executeBundles([bundle]);
    pass.executeBundles([bundle]);
    groma.beginRenderFrame();

    // recording the bundle must not count, only the two replays of its three draws
    expect(groma.snapshot().frame?.drawCallCount).toBe(6);
  });

  it("counts a pipeline creation that throws, and lets the error through", () => {
    const device = new FakeDevice();
    device.pipelineCreationError = new Error("bad shader");
    const groma = attach(asDevice(device));

    groma.beginRenderFrame();
    expect(() => device.createRenderPipeline()).toThrow("bad shader");
    groma.beginRenderFrame();

    expect(groma.snapshot().frame?.pipelineCreationCount).toBe(1);
  });

  it("stops instrumenting encoders created after destroy", () => {
    const device = new FakeDevice();
    attach(asDevice(device)).destroy();

    const pass = device.createCommandEncoder().beginRenderPass();

    expect(Object.hasOwn(pass, "draw")).toBe(false);
    expect(Object.hasOwn(pass, "executeBundles")).toBe(false);
  });
});

describe("describe", () => {
  it("has a definition for every metric a snapshot exposes", () => {
    const device = new FakeDevice();
    const groma = attach(asDevice(device));
    groma.beginRenderFrame();
    groma.beginRenderFrame();

    const { frame } = groma.snapshot();
    expect(frame).toBeDefined();

    for (const key of Object.keys(frame ?? {})) {
      const path = `frame.${key}` as MetricPath;
      const definition = groma.describe(path);

      expect(definition.name).toBe(path);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.methodology.length).toBeGreaterThan(0);
      expect(definition.caveats.length).toBeGreaterThan(0);
    }
  });

  it("exposes no definition without a matching metric", () => {
    const groma = attach(asDevice(new FakeDevice()));
    groma.beginRenderFrame();
    groma.beginRenderFrame();

    const frameKeys = Object.keys(groma.snapshot().frame ?? {});
    const definedPaths = Object.keys(METRIC_DEFINITIONS);

    expect(definedPaths.sort()).toEqual(
      frameKeys.map((key) => `frame.${key}`).sort(),
    );
  });
});
