import { describe, expect, it } from "vitest";
import { attach } from "../../src/attach";
import { calculateWrittenBufferBytes } from "../../src/bufferBytes";
import { asDevice, FakeDevice, FakeTexture } from "../fakes/webgpu";

const rgbaTexture = () => {
  const texture = new FakeTexture();
  return { texture: { ...texture, format: "rgba8unorm" } };
};

describe("calculateWrittenBufferBytes", () => {
  it("uses the whole buffer when no offset or size is given", () => {
    expect(calculateWrittenBufferBytes(new ArrayBuffer(256))).toBe(256);
  });

  it("treats a plain ArrayBuffer offset as bytes", () => {
    expect(calculateWrittenBufferBytes(new ArrayBuffer(256), 64)).toBe(192);
  });

  it("treats a typed array offset as elements, not bytes", () => {
    // 64 float32 elements is 256 bytes; skipping 16 elements skips 64 bytes
    const data = new Float32Array(64);
    expect(calculateWrittenBufferBytes(data, 16)).toBe(192);
  });

  it("treats an explicit size as elements for a typed array", () => {
    expect(calculateWrittenBufferBytes(new Float32Array(64), 0, 10)).toBe(40);
  });

  it("treats an explicit size as bytes for an ArrayBuffer", () => {
    expect(calculateWrittenBufferBytes(new ArrayBuffer(256), 0, 10)).toBe(10);
  });

  it("scales by element size for wider types", () => {
    expect(calculateWrittenBufferBytes(new Float64Array(8))).toBe(64);
    expect(calculateWrittenBufferBytes(new Uint8Array(8))).toBe(8);
  });

  it("treats a DataView offset as bytes, since it has no element size", () => {
    const view = new DataView(new ArrayBuffer(256));
    expect(calculateWrittenBufferBytes(view, 64)).toBe(192);
  });

  it("never reports a negative size", () => {
    expect(calculateWrittenBufferBytes(new ArrayBuffer(16), 999)).toBe(0);
  });
});

describe("queue writes", () => {
  it("sums writeBuffer and writeTexture into the frame", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    const buffer = device.createBuffer({ size: 1024, usage: 0 });

    agrimensor.beginRenderFrame();
    device.queue.writeBuffer(buffer, 0, new Float32Array(16));
    device.queue.writeTexture(rgbaTexture(), new ArrayBuffer(64), {}, [4, 4]);
    agrimensor.beginRenderFrame();

    // 16 floats is 64 bytes, plus a 4x4 rgba8 region is another 64
    expect(agrimensor.snapshot().frame?.queueWriteSumInBytes).toBe(128);
  });

  it("keeps queue writes out of the copy total", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    const buffer = device.createBuffer({ size: 1024, usage: 0 });

    agrimensor.beginRenderFrame();
    device.queue.writeBuffer(buffer, 0, new Uint8Array(32));
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.commandCopySumInBytes).toBe(0);
  });
});

describe("command copies", () => {
  it("uses the declared size in the long form", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    const source = device.createBuffer({ size: 1024, usage: 0 });
    const destination = device.createBuffer({ size: 1024, usage: 0 });

    agrimensor.beginRenderFrame();
    device
      .createCommandEncoder()
      .copyBufferToBuffer(source, 0, destination, 0, 512);
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.commandCopySumInBytes).toBe(512);
  });

  it("falls back to the source size minus its offset when size is omitted", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    const source = device.createBuffer({ size: 1024, usage: 0 });
    const destination = device.createBuffer({ size: 1024, usage: 0 });

    agrimensor.beginRenderFrame();
    device
      .createCommandEncoder()
      .copyBufferToBuffer(source, 256, destination, 0);
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.commandCopySumInBytes).toBe(768);
  });

  it("handles the shorthand overload with an explicit size", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    const source = device.createBuffer({ size: 1024, usage: 0 });
    const destination = device.createBuffer({ size: 1024, usage: 0 });

    agrimensor.beginRenderFrame();
    device.createCommandEncoder().copyBufferToBuffer(source, destination, 128);
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.commandCopySumInBytes).toBe(128);
  });

  it("handles the shorthand overload with no size, using the whole source", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    const source = device.createBuffer({ size: 700, usage: 0 });
    const destination = device.createBuffer({ size: 1024, usage: 0 });

    agrimensor.beginRenderFrame();
    device.createCommandEncoder().copyBufferToBuffer(source, destination);
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.commandCopySumInBytes).toBe(700);
  });

  it("computes texture copy regions from the format", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToTexture(rgbaTexture(), rgbaTexture(), [8, 8]);
    encoder.copyTextureToBuffer(rgbaTexture(), {}, [4, 4]);
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.commandCopySumInBytes).toBe(
      8 * 8 * 4 + 4 * 4 * 4,
    );
  });

  it("resets copy totals between frames", () => {
    const device = new FakeDevice();
    const agrimensor = attach(asDevice(device));
    const source = device.createBuffer({ size: 512, usage: 0 });
    const destination = device.createBuffer({ size: 512, usage: 0 });

    agrimensor.beginRenderFrame();
    device.createCommandEncoder().copyBufferToBuffer(source, destination);
    agrimensor.beginRenderFrame();
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.commandCopySumInBytes).toBe(0);
  });
});
