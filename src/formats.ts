export type TextureFormatInfo = {
  readonly bytesPerBlock: number;
  readonly blockWidth: number;
  readonly blockHeight: number;
  /**
   * WebGPU leaves the storage of some depth and stencil formats up to the implementation.
   * Their byte figures here are a documented model of what Dawn on Metal, D3D12 and Vulkan
   * typically do, not something the API reports.
   */
  readonly isImplementationDefined?: true;
};

const uncompressed = (bytesPerBlock: number): TextureFormatInfo => ({
  bytesPerBlock,
  blockWidth: 1,
  blockHeight: 1,
});

const implementationDefined = (bytesPerBlock: number): TextureFormatInfo => ({
  bytesPerBlock,
  blockWidth: 1,
  blockHeight: 1,
  isImplementationDefined: true,
});

const compressed = (
  bytesPerBlock: number,
  blockWidth: number,
  blockHeight: number,
): TextureFormatInfo => ({ bytesPerBlock, blockWidth, blockHeight });

// typed as a total Record so the compiler fails the build if @webgpu/types adds a format
// this table has not accounted for
export const TEXTURE_FORMATS: Readonly<
  Record<GPUTextureFormat, TextureFormatInfo>
> = {
  r8unorm: uncompressed(1),
  r8snorm: uncompressed(1),
  r8uint: uncompressed(1),
  r8sint: uncompressed(1),

  r16unorm: uncompressed(2),
  r16snorm: uncompressed(2),
  r16uint: uncompressed(2),
  r16sint: uncompressed(2),
  r16float: uncompressed(2),
  rg8unorm: uncompressed(2),
  rg8snorm: uncompressed(2),
  rg8uint: uncompressed(2),
  rg8sint: uncompressed(2),

  r32uint: uncompressed(4),
  r32sint: uncompressed(4),
  r32float: uncompressed(4),
  rg16unorm: uncompressed(4),
  rg16snorm: uncompressed(4),
  rg16uint: uncompressed(4),
  rg16sint: uncompressed(4),
  rg16float: uncompressed(4),
  rgba8unorm: uncompressed(4),
  "rgba8unorm-srgb": uncompressed(4),
  rgba8snorm: uncompressed(4),
  rgba8uint: uncompressed(4),
  rgba8sint: uncompressed(4),
  bgra8unorm: uncompressed(4),
  "bgra8unorm-srgb": uncompressed(4),
  rgb9e5ufloat: uncompressed(4),
  rgb10a2uint: uncompressed(4),
  rgb10a2unorm: uncompressed(4),
  rg11b10ufloat: uncompressed(4),

  rg32uint: uncompressed(8),
  rg32sint: uncompressed(8),
  rg32float: uncompressed(8),
  rgba16unorm: uncompressed(8),
  rgba16snorm: uncompressed(8),
  rgba16uint: uncompressed(8),
  rgba16sint: uncompressed(8),
  rgba16float: uncompressed(8),

  rgba32uint: uncompressed(16),
  rgba32sint: uncompressed(16),
  rgba32float: uncompressed(16),

  stencil8: uncompressed(1),
  depth16unorm: uncompressed(2),
  depth32float: uncompressed(4),
  depth24plus: implementationDefined(4),
  "depth24plus-stencil8": implementationDefined(4),
  "depth32float-stencil8": implementationDefined(8),

  "bc1-rgba-unorm": compressed(8, 4, 4),
  "bc1-rgba-unorm-srgb": compressed(8, 4, 4),
  "bc2-rgba-unorm": compressed(16, 4, 4),
  "bc2-rgba-unorm-srgb": compressed(16, 4, 4),
  "bc3-rgba-unorm": compressed(16, 4, 4),
  "bc3-rgba-unorm-srgb": compressed(16, 4, 4),
  "bc4-r-unorm": compressed(8, 4, 4),
  "bc4-r-snorm": compressed(8, 4, 4),
  "bc5-rg-unorm": compressed(16, 4, 4),
  "bc5-rg-snorm": compressed(16, 4, 4),
  "bc6h-rgb-ufloat": compressed(16, 4, 4),
  "bc6h-rgb-float": compressed(16, 4, 4),
  "bc7-rgba-unorm": compressed(16, 4, 4),
  "bc7-rgba-unorm-srgb": compressed(16, 4, 4),

  "etc2-rgb8unorm": compressed(8, 4, 4),
  "etc2-rgb8unorm-srgb": compressed(8, 4, 4),
  "etc2-rgb8a1unorm": compressed(8, 4, 4),
  "etc2-rgb8a1unorm-srgb": compressed(8, 4, 4),
  "etc2-rgba8unorm": compressed(16, 4, 4),
  "etc2-rgba8unorm-srgb": compressed(16, 4, 4),
  "eac-r11unorm": compressed(8, 4, 4),
  "eac-r11snorm": compressed(8, 4, 4),
  "eac-rg11unorm": compressed(16, 4, 4),
  "eac-rg11snorm": compressed(16, 4, 4),

  "astc-4x4-unorm": compressed(16, 4, 4),
  "astc-4x4-unorm-srgb": compressed(16, 4, 4),
  "astc-5x4-unorm": compressed(16, 5, 4),
  "astc-5x4-unorm-srgb": compressed(16, 5, 4),
  "astc-5x5-unorm": compressed(16, 5, 5),
  "astc-5x5-unorm-srgb": compressed(16, 5, 5),
  "astc-6x5-unorm": compressed(16, 6, 5),
  "astc-6x5-unorm-srgb": compressed(16, 6, 5),
  "astc-6x6-unorm": compressed(16, 6, 6),
  "astc-6x6-unorm-srgb": compressed(16, 6, 6),
  "astc-8x5-unorm": compressed(16, 8, 5),
  "astc-8x5-unorm-srgb": compressed(16, 8, 5),
  "astc-8x6-unorm": compressed(16, 8, 6),
  "astc-8x6-unorm-srgb": compressed(16, 8, 6),
  "astc-8x8-unorm": compressed(16, 8, 8),
  "astc-8x8-unorm-srgb": compressed(16, 8, 8),
  "astc-10x5-unorm": compressed(16, 10, 5),
  "astc-10x5-unorm-srgb": compressed(16, 10, 5),
  "astc-10x6-unorm": compressed(16, 10, 6),
  "astc-10x6-unorm-srgb": compressed(16, 10, 6),
  "astc-10x8-unorm": compressed(16, 10, 8),
  "astc-10x8-unorm-srgb": compressed(16, 10, 8),
  "astc-10x10-unorm": compressed(16, 10, 10),
  "astc-10x10-unorm-srgb": compressed(16, 10, 10),
  "astc-12x10-unorm": compressed(16, 12, 10),
  "astc-12x10-unorm-srgb": compressed(16, 12, 10),
  "astc-12x12-unorm": compressed(16, 12, 12),
  "astc-12x12-unorm-srgb": compressed(16, 12, 12),
};
