import { TEXTURE_FORMATS } from "./formats";

type NormalizedExtent = {
  width: number;
  height: number;
  depthOrArrayLayers: number;
};

const normalizeExtent = (size: GPUExtent3DStrict): NormalizedExtent => {
  if (!(Symbol.iterator in size)) {
    const { width, height = 1, depthOrArrayLayers = 1 } = size;
    return { width, height, depthOrArrayLayers };
  }

  const [width = 1, height = 1, depthOrArrayLayers = 1] = [...size];
  return { width, height, depthOrArrayLayers };
};

const blockCount = (extent: number, blockSize: number) =>
  Math.ceil(extent / blockSize);

/**
 * Logical allocation of a texture: the bytes its declared shape and format occupy,
 * summed over its full mip chain, array layers and samples.
 *
 * This is a calculation, not a reading. Drivers pad, align, compress multisampled
 * surfaces and may allocate lazily, so real footprint will differ.
 */
export const calculateTextureAllocationBytes = (
  descriptor: GPUTextureDescriptor,
): number => {
  const { format, size, dimension = "2d" } = descriptor;
  const { mipLevelCount = 1, sampleCount = 1 } = descriptor;
  const { blockWidth, blockHeight, bytesPerBlock } = TEXTURE_FORMATS[format];
  const { width, height, depthOrArrayLayers } = normalizeExtent(size);

  // depth mips down on a 3d texture; array layers do not
  const isVolume = dimension === "3d";
  const layerCount = isVolume ? 1 : depthOrArrayLayers;

  let bytesPerLayer = 0;
  for (let level = 0; level < mipLevelCount; level++) {
    const levelWidth = Math.max(1, width >> level);
    const levelHeight = Math.max(1, height >> level);
    const levelDepth = isVolume ? Math.max(1, depthOrArrayLayers >> level) : 1;

    bytesPerLayer +=
      blockCount(levelWidth, blockWidth) *
      blockCount(levelHeight, blockHeight) *
      levelDepth *
      bytesPerBlock;
  }

  return bytesPerLayer * layerCount * sampleCount;
};

/** Logical size of a single texel copy region. No mip chain, no samples. */
export const calculateCopyRegionBytes = (
  format: GPUTextureFormat,
  size: GPUExtent3DStrict,
): number => {
  const { blockWidth, blockHeight, bytesPerBlock } = TEXTURE_FORMATS[format];
  const { width, height, depthOrArrayLayers } = normalizeExtent(size);

  return (
    blockCount(width, blockWidth) *
    blockCount(height, blockHeight) *
    depthOrArrayLayers *
    bytesPerBlock
  );
};
