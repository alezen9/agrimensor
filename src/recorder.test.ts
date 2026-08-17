import { describe, expect, it } from "vitest";
import { attach } from "./attach";
import { asDevice, FakeDevice, withTimestampSupport } from "./webgpu.fake";

const supported = () => asDevice(withTimestampSupport(new FakeDevice()));

describe("timestamp capability", () => {
  it("reports unsupported when the device lacks the feature", () => {
    const agrimensor = attach(asDevice(new FakeDevice()));

    expect(agrimensor.capabilities.timestampQueries).toBe(false);
    expect(agrimensor.snapshot().gpu).toBeUndefined();
  });

  it("reports supported when the device has the feature", () => {
    expect(attach(supported()).capabilities.timestampQueries).toBe(true);
  });

  it("creates its own query set rather than borrowing one", () => {
    const device = withTimestampSupport(new FakeDevice());
    attach(asDevice(device));

    expect(device.querySets.length).toBe(1);
  });

  it("releases the query set on destroy", () => {
    const device = withTimestampSupport(new FakeDevice());
    attach(asDevice(device)).destroy();

    expect(device.querySets.every((set) => set.destroyed)).toBe(true);
  });
});

describe("pass instrumentation", () => {
  it("injects timestampWrites into a pass that has none", () => {
    const device = withTimestampSupport(new FakeDevice());
    const agrimensor = attach(asDevice(device));
    agrimensor.beginRenderFrame();

    const encoder = device.createCommandEncoder();
    const descriptor = { colorAttachments: [] };
    encoder.beginRenderPass(descriptor as never);

    expect(encoder.lastRenderPassDescriptor?.timestampWrites).toBeDefined();
  });

  it("does not mutate the caller's descriptor, which engines reuse", () => {
    const device = withTimestampSupport(new FakeDevice());
    const agrimensor = attach(asDevice(device));
    agrimensor.beginRenderFrame();

    const descriptor = { colorAttachments: [] };
    device.createCommandEncoder().beginRenderPass(descriptor as never);

    expect("timestampWrites" in descriptor).toBe(false);
  });

  it("yields when the application already claimed timestampWrites", () => {
    const device = withTimestampSupport(new FakeDevice());
    const agrimensor = attach(asDevice(device));
    agrimensor.beginRenderFrame();

    const theirs = { querySet: {}, beginningOfPassWriteIndex: 0 };
    const descriptor = { colorAttachments: [], timestampWrites: theirs };
    device.createCommandEncoder().beginRenderPass(descriptor as never);

    expect(encoderWrites(device)).toBe(theirs);
  });

  it("hands out a distinct slot pair to each pass", () => {
    const device = withTimestampSupport(new FakeDevice());
    const agrimensor = attach(asDevice(device));
    agrimensor.beginRenderFrame();

    const encoder = device.createCommandEncoder();
    const seen = new Set<number>();
    for (let i = 0; i < 8; i++) {
      encoder.beginComputePass({} as never);
      const writes = encoder.lastComputePassDescriptor?.timestampWrites;
      expect(writes).toBeDefined();
      const { beginningOfPassWriteIndex, endOfPassWriteIndex } =
        writes as Required<GPUComputePassTimestampWrites>;
      seen.add(beginningOfPassWriteIndex);
      seen.add(endOfPassWriteIndex);
    }

    // reusing an index is accepted silently by WebGPU, so this cannot rely on
    // validation catching a double booking
    expect(seen.size).toBe(16);
  });

  it("does not instrument passes before a frame boundary is declared", () => {
    const device = withTimestampSupport(new FakeDevice());
    attach(asDevice(device));

    device.createCommandEncoder().beginComputePass({} as never);

    expect(encoderComputeWrites(device)).toBeUndefined();
  });
});

describe("resolve submissions", () => {
  it("keeps its own resolve submission out of the frame's submission count", () => {
    const device = withTimestampSupport(new FakeDevice());
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    device.createCommandEncoder().beginComputePass({} as never);
    device.queue.submit([]);
    agrimensor.beginRenderFrame();

    expect(agrimensor.snapshot().frame?.gpuSubmissionCount).toBe(1);
  });

  it("submits nothing extra when the frame recorded no passes", () => {
    const device = withTimestampSupport(new FakeDevice());
    const agrimensor = attach(asDevice(device));

    agrimensor.beginRenderFrame();
    const before = device.queue.submitted.length;
    agrimensor.beginRenderFrame();

    expect(device.queue.submitted.length).toBe(before);
  });
});

const encoderWrites = (device: FakeDevice) =>
  device.encoders.at(-1)?.lastRenderPassDescriptor?.timestampWrites;

const encoderComputeWrites = (device: FakeDevice) =>
  device.encoders.at(-1)?.lastComputePassDescriptor?.timestampWrites;

describe("cross submission plausibility", () => {
  it("starts out assuming the timestamps are comparable", () => {
    expect(
      attach(supported()).capabilities.crossSubmissionTimestampsComparable,
    ).toBe(true);
  });

  it("survives frames that record no passes at all", () => {
    const agrimensor = attach(supported());

    for (let i = 0; i < 10; i++) agrimensor.beginRenderFrame();

    expect(agrimensor.capabilities.crossSubmissionTimestampsComparable).toBe(
      true,
    );
    expect(agrimensor.snapshot().gpu).toBeUndefined();
  });
});
