import { describe, expect, it } from "vitest";
import { attach } from "./attach";
import { ResourceRegistry } from "./resources";
import type { ResourceEntry } from "./types";
import { asDevice, FakeDevice } from "./webgpu.fake";

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

  it("adds buffers and textures into the total", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    device.createBuffer({ size: 1000, usage: 0 });
    device.createTexture(rgba(16, 16));

    const { resources } = agrimensor.snapshot();
    expect(resources.liveTextureCount).toBe(1);
    expect(resources.liveTextureAllocationSumInBytes).toBe(16 * 16 * 4);
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

describe("largestResources", () => {
  it("returns nothing before anything is created", () => {
    expect(attach(asDevice(new FakeDevice())).largestResources()).toEqual([]);
  });

  it("orders by allocated bytes, biggest first", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    device.createBuffer({ size: 1024, usage: 0 });
    device.createTexture(rgba(256, 256));
    device.createBuffer({ size: 4096, usage: 0 });

    const largest = agrimensor.largestResources();
    expect(largest.map((entry) => entry.allocationInBytes)).toEqual([
      256 * 256 * 4,
      4096,
      1024,
    ]);
  });

  it("carries the shape of a texture, so it is identifiable without a label", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    device.createTexture({ ...rgba(512, 256), label: "bloomTarget" });

    const [entry] = agrimensor.largestResources();
    expect(entry).toMatchObject({
      kind: "texture",
      label: "bloomTarget",
      format: "rgba8unorm",
      width: 512,
      height: 256,
    });
  });

  it("reports an empty label rather than inventing one", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    device.createBuffer({ size: 64, usage: 0 });

    expect(agrimensor.largestResources()[0]?.label).toBe("");
  });

  it("drops a resource once it is destroyed", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    const buffer = device.createBuffer({ size: 4096, usage: 0 });
    device.createBuffer({ size: 8, usage: 0 });

    buffer.destroy();

    const largest = agrimensor.largestResources();
    expect(largest.length).toBe(1);
    expect(largest[0]?.allocationInBytes).toBe(8);
  });

  it("honours the requested count", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    for (let i = 1; i <= 20; i++)
      device.createBuffer({ size: i * 100, usage: 0 });

    expect(agrimensor.largestResources(3).length).toBe(3);
    expect(agrimensor.largestResources().length).toBe(10);
  });

  it("does not retain anything as resources churn", () => {
    const device = new FakeDevice();
    const registry = new ResourceRegistry();

    for (let i = 0; i < 5000; i++) {
      const descriptor = { size: 128, usage: 0 };
      const buffer = device.createBuffer(descriptor);
      registry.trackBuffer(buffer as unknown as GPUBuffer, descriptor);
      buffer.destroy();
    }

    expect(registry.trackedCount).toBe(0);
    expect(registry.largestResources(50)).toEqual([]);
  });
});

describe("resource hooks", () => {
  it("reports a creation under the same id largestResources will use", () => {
    const device = new FakeDevice();
    const created: ResourceEntry[] = [];
    const agrimensor = attach(asDevice(device), {
      onResourceCreated: (resource) => created.push(resource),
    });

    device.createTexture({ ...rgba(256, 128), label: "bloomTarget" });

    expect(created.length).toBe(1);
    expect(created[0]).toMatchObject({
      kind: "texture",
      label: "bloomTarget",
      allocationInBytes: 256 * 128 * 4,
      width: 256,
      height: 128,
    });
    // the join a consumer makes between an origin recorded here and a total read later
    expect(created[0]?.id).toBe(agrimensor.largestResources()[0]?.id);
  });

  it("reports the destruction of the resource it reported creating", () => {
    const device = new FakeDevice();
    const created: ResourceEntry[] = [];
    const destroyed: ResourceEntry[] = [];
    attach(asDevice(device), {
      onResourceCreated: (resource) => created.push(resource),
      onResourceDestroyed: (resource) => destroyed.push(resource),
    });

    const buffer = device.createBuffer({ size: 2048, usage: 0 });
    buffer.destroy();

    // without this a consumer keying origins by id has no way to prune, since
    // there is no way to ask which ids are still live
    expect(destroyed.length).toBe(1);
    expect(destroyed[0]?.id).toBe(created[0]?.id);
  });

  it("reports a destruction once even though destroy is idempotent", () => {
    const device = new FakeDevice();
    const destroyed: ResourceEntry[] = [];
    attach(asDevice(device), {
      onResourceDestroyed: (resource) => destroyed.push(resource),
    });

    const buffer = device.createBuffer({ size: 64, usage: 0 });
    buffer.destroy();
    buffer.destroy();

    expect(destroyed.length).toBe(1);
  });

  it("contains a throwing creation hook inside the allocation that fired it", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device), {
      onResourceCreated: () => {
        throw new Error("consumer bug");
      },
    });

    expect(() => device.createTexture(rgba(64, 64))).not.toThrow();
    expect(agrimensor.snapshot().resources.liveTextureCount).toBe(1);
  });

  it("contains a throwing destruction hook inside the destroy that fired it", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device), {
      onResourceDestroyed: () => {
        throw new Error("consumer bug");
      },
    });

    const buffer = device.createBuffer({ size: 64, usage: 0 });

    expect(() => buffer.destroy()).not.toThrow();
    expect(buffer.destroyCount).toBe(1);
    expect(agrimensor.snapshot().resources.liveBufferCount).toBe(0);
  });

  it("says nothing about resources created before attach", () => {
    const device = new FakeDevice();
    device.createBuffer({ size: 9999, usage: 0 });

    const created: ResourceEntry[] = [];
    attach(asDevice(device), {
      onResourceCreated: (resource) => created.push(resource),
    });

    expect(created).toEqual([]);
  });
});

describe("resource identity and descriptor facts", () => {
  it("gives identical textures distinct ids, so a keyed list is safe", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    device.createTexture(rgba(128, 128));
    device.createTexture(rgba(128, 128));

    const [first, second] = agrimensor.largestResources();
    expect(first?.allocationInBytes).toBe(second?.allocationInBytes);
    expect(first?.id).not.toBe(second?.id);
  });

  it("never reuses an id after a resource is destroyed", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    const first = device.createBuffer({ size: 64, usage: 0 });
    const firstId = agrimensor.largestResources()[0]?.id;
    first.destroy();
    device.createBuffer({ size: 64, usage: 0 });

    // telling "still alive" from "allocated again" depends on this
    expect(agrimensor.largestResources()[0]?.id).not.toBe(firstId);
  });

  it("carries usage through untouched, so render targets are separable", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    const RENDER_ATTACHMENT = 0x10;
    const TEXTURE_BINDING = 0x04;

    device.createTexture({ ...rgba(64, 64), usage: RENDER_ATTACHMENT });
    device.createTexture({ ...rgba(32, 32), usage: TEXTURE_BINDING });

    const targets = agrimensor
      .largestResources()
      .filter((entry) => (entry.usage & RENDER_ATTACHMENT) !== 0);

    expect(targets.length).toBe(1);
    expect(targets[0]?.width).toBe(64);
  });

  it("reports the sample and mip counts that explain the byte figure", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    device.createTexture({ ...rgba(64, 64), sampleCount: 4 });

    const [entry] = agrimensor.largestResources();
    expect(entry?.sampleCount).toBe(4);
    expect(entry?.mipLevelCount).toBe(1);
    expect(entry?.allocationInBytes).toBe(64 * 64 * 4 * 4);
  });
});
