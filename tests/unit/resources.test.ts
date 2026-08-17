import { describe, expect, it } from "vitest";
import { attach } from "../../src/attach";
import { asDevice, FakeDevice } from "../fakes/webgpu";

const rgba = (width: number, height: number): GPUTextureDescriptor => ({
  size: [width, height],
  format: "rgba8unorm",
  usage: 0,
});

describe("resource tracking", () => {
  it("is available without a frame boundary", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    device.createBuffer({ size: 1024, usage: 0 });

    const { resources, frame } = agrimensor.snapshot();
    expect(frame).toBeUndefined();
    expect(resources.liveBufferCount).toBe(1);
    expect(agrimensor.capabilities.resourceTracking).toBe(true);
  });

  it("sums declared buffer sizes", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    device.createBuffer({ size: 1024, usage: 0 });
    device.createBuffer({ size: 256, usage: 0 });

    const { resources } = agrimensor.snapshot();
    expect(resources.liveBufferCount).toBe(2);
    expect(resources.liveBufferAllocationSumInBytes).toBe(1280);
  });

  it("computes texture bytes from the descriptor", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    device.createTexture(rgba(64, 64));

    const { resources } = agrimensor.snapshot();
    expect(resources.liveTextureCount).toBe(1);
    expect(resources.liveTextureAllocationSumInBytes).toBe(64 * 64 * 4);
  });

  it("adds buffers and textures into the total", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    device.createBuffer({ size: 1000, usage: 0 });
    device.createTexture(rgba(16, 16));

    const { resources } = agrimensor.snapshot();
    expect(resources.liveResourceAllocationSumInBytes).toBe(1000 + 16 * 16 * 4);
  });

  it("releases on destroy and forwards to the real destroy", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    const buffer = device.createBuffer({ size: 1024, usage: 0 });
    buffer.destroy();

    const { resources } = agrimensor.snapshot();
    expect(resources.liveBufferCount).toBe(0);
    expect(resources.liveBufferAllocationSumInBytes).toBe(0);
    expect(buffer.destroyCount).toBe(1);
  });

  it("decrements once even though destroy is idempotent", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    const buffer = device.createBuffer({ size: 1024, usage: 0 });
    buffer.destroy();
    buffer.destroy();
    buffer.destroy();

    const { resources } = agrimensor.snapshot();
    expect(resources.liveBufferCount).toBe(0);
    expect(resources.liveBufferAllocationSumInBytes).toBe(0);
    expect(buffer.destroyCount).toBe(3);
  });

  it("releases textures by the same amount they were counted for", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    const texture = device.createTexture(rgba(128, 128));
    device.createTexture(rgba(32, 32));
    texture.destroy();

    const { resources } = agrimensor.snapshot();
    expect(resources.liveTextureCount).toBe(1);
    expect(resources.liveTextureAllocationSumInBytes).toBe(32 * 32 * 4);
  });

  it("keeps the peak after resources are released", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    const buffer = device.createBuffer({ size: 4096, usage: 0 });
    expect(
      agrimensor.snapshot().resources.liveResourceAllocationPeakInBytes,
    ).toBe(4096);

    buffer.destroy();

    const { resources } = agrimensor.snapshot();
    expect(resources.liveResourceAllocationSumInBytes).toBe(0);
    expect(resources.liveResourceAllocationPeakInBytes).toBe(4096);
  });

  it("ignores resources created before attach", () => {
    const device = new FakeDevice();
    device.createBuffer({ size: 9999, usage: 0 });

    const agrimensor = attach(asDevice(device));

    expect(agrimensor.snapshot().resources.liveBufferCount).toBe(0);
  });

  it("stops tracking resources created after destroy", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    device.createBuffer({ size: 1024, usage: 0 });
    agrimensor.destroy();

    const later = device.createBuffer({ size: 1024, usage: 0 });
    later.destroy();

    expect(Object.hasOwn(later, "destroy")).toBe(false);
    expect(later.destroyCount).toBe(1);
  });
});
