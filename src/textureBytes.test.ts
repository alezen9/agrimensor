import { describe, expect, it } from "vitest";
import {
  calculateCopyRegionBytes,
  calculateTextureAllocationBytes,
} from "./textureBytes";

const texture = (
  descriptor: Partial<GPUTextureDescriptor> &
    Pick<GPUTextureDescriptor, "size">,
): GPUTextureDescriptor => ({
  format: "rgba8unorm",
  usage: 0,
  ...descriptor,
});

describe("calculateTextureAllocationBytes", () => {
  it("multiplies width, height and bytes per texel", () => {
    expect(
      calculateTextureAllocationBytes(texture({ size: [1024, 1024] })),
    ).toBe(1024 * 1024 * 4);
  });

  it("accepts the dictionary form of the extent", () => {
    expect(
      calculateTextureAllocationBytes(
        texture({ size: { width: 1024, height: 1024 } }),
      ),
    ).toBe(1024 * 1024 * 4);
  });

  it("defaults a missing height and depth to 1", () => {
    expect(
      calculateTextureAllocationBytes(
        texture({ size: { width: 8 }, format: "r8unorm" }),
      ),
    ).toBe(8);
  });

  it("uses bytes per texel from the format, not a fixed 4", () => {
    const size: number[] = [64, 64];
    expect(
      calculateTextureAllocationBytes(texture({ size, format: "r8unorm" })),
    ).toBe(64 * 64);
    expect(
      calculateTextureAllocationBytes(texture({ size, format: "rgba16float" })),
    ).toBe(64 * 64 * 8);
    expect(
      calculateTextureAllocationBytes(texture({ size, format: "rgba32float" })),
    ).toBe(64 * 64 * 16);
  });

  it("sums the whole mip chain", () => {
    const bytes = calculateTextureAllocationBytes(
      texture({ size: [4, 4], mipLevelCount: 3 }),
    );

    // 4x4 + 2x2 + 1x1 texels at 4 bytes each
    expect(bytes).toBe((16 + 4 + 1) * 4);
  });

  it("does not mip array layers, but multiplies by them", () => {
    const bytes = calculateTextureAllocationBytes(
      texture({ size: [4, 4, 6], mipLevelCount: 3 }),
    );

    expect(bytes).toBe((16 + 4 + 1) * 4 * 6);
  });

  it("mips the depth of a 3d texture", () => {
    const bytes = calculateTextureAllocationBytes(
      texture({ size: [4, 4, 4], dimension: "3d", mipLevelCount: 3 }),
    );

    // 4x4x4 + 2x2x2 + 1x1x1 texels at 4 bytes each
    expect(bytes).toBe((64 + 8 + 1) * 4);
  });

  it("multiplies by sample count", () => {
    expect(
      calculateTextureAllocationBytes(
        texture({ size: [64, 64], sampleCount: 4 }),
      ),
    ).toBe(64 * 64 * 4 * 4);
  });

  it("rounds compressed formats up to whole blocks", () => {
    // bc1 is 8 bytes per 4x4 block, so a 5x5 texture still costs 2x2 blocks
    expect(
      calculateTextureAllocationBytes(
        texture({ size: [5, 5], format: "bc1-rgba-unorm" }),
      ),
    ).toBe(4 * 8);

    expect(
      calculateTextureAllocationBytes(
        texture({ size: [4, 4], format: "bc1-rgba-unorm" }),
      ),
    ).toBe(8);
  });

  it("handles a non-square astc block", () => {
    // astc-8x5 is 16 bytes per 8x5 block, so 16x10 is exactly 2x2 blocks
    expect(
      calculateTextureAllocationBytes(
        texture({ size: [16, 10], format: "astc-8x5-unorm" }),
      ),
    ).toBe(4 * 16);
  });

  it("uses the documented model for implementation-defined depth formats", () => {
    const size: number[] = [32, 32];
    expect(
      calculateTextureAllocationBytes(texture({ size, format: "depth24plus" })),
    ).toBe(32 * 32 * 4);
    expect(
      calculateTextureAllocationBytes(
        texture({ size, format: "depth32float-stencil8" }),
      ),
    ).toBe(32 * 32 * 8);
    expect(
      calculateTextureAllocationBytes(texture({ size, format: "stencil8" })),
    ).toBe(32 * 32);
  });
});

describe("calculateCopyRegionBytes", () => {
  it("ignores mips and samples, counting only the region", () => {
    expect(calculateCopyRegionBytes("rgba8unorm", [16, 16])).toBe(16 * 16 * 4);
  });

  it("counts every layer of the region", () => {
    expect(calculateCopyRegionBytes("rgba8unorm", [16, 16, 3])).toBe(
      16 * 16 * 3 * 4,
    );
  });

  it("rounds compressed regions up to whole blocks", () => {
    expect(calculateCopyRegionBytes("bc1-rgba-unorm", [5, 5])).toBe(4 * 8);
  });
});
