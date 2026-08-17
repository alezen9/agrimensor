import { describe, expect, it } from "vitest";
import { attach } from "./attach";
import { asDevice, FakeDevice, withTimestampSupport } from "./webgpu.fake";

const encodePass = (device: FakeDevice) => {
  device.createCommandEncoder().beginComputePass({} as never);
};

describe("failure paths", () => {
  it("keeps the consumer's frame alive when its own resolve encoding fails", () => {
    const device = withTimestampSupport(new FakeDevice());
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    encodePass(device);
    device.encoderFailure = new Error("device lost");

    // a metrics library must never take the render loop down with it
    expect(() => agrimensor.beginRenderFrame()).not.toThrow();
  });

  it("still reports resources after its own timing has failed", () => {
    const device = withTimestampSupport(new FakeDevice());
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    encodePass(device);
    device.encoderFailure = new Error("device lost");
    agrimensor.beginRenderFrame();
    device.encoderFailure = undefined;

    device.createBuffer({ size: 2048, usage: 0 });
    expect(agrimensor.snapshot().resources.liveBufferAllocationSumInBytes).toBe(
      2048,
    );
  });

  it("releases the region when readback rejects, so timing recovers", async () => {
    const device = withTimestampSupport(new FakeDevice());
    device.mapRejection = new Error("readback failed");
    const agrimensor = attach(asDevice(device));

    for (let frame = 0; frame < 12; frame++) {
      agrimensor.beginRenderFrame();
      encodePass(device);
      await Promise.resolve();
    }

    // regions must not stay pending forever after a rejected map
    expect(() => agrimensor.beginRenderFrame()).not.toThrow();
    expect(agrimensor.snapshot().gpu).toBeUndefined();
  });

  it("can still be destroyed cleanly after a failure", () => {
    const device = withTimestampSupport(new FakeDevice());
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    encodePass(device);
    device.encoderFailure = new Error("device lost");
    agrimensor.beginRenderFrame();

    expect(() => agrimensor.destroy()).not.toThrow();
  });
});
