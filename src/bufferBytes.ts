const isTypedArray = (
  view: ArrayBufferView,
): view is ArrayBufferView & { readonly BYTES_PER_ELEMENT: number } =>
  "BYTES_PER_ELEMENT" in view;

/**
 * queue.writeBuffer measures dataOffset and size in *elements* when data is a typed array
 * and in *bytes* when it is a plain ArrayBuffer or a DataView. Treating them uniformly
 * would misreport uploads by a factor of the element size.
 */
export const calculateWrittenBufferBytes = (
  data: GPUAllowSharedBufferSource,
  dataOffset = 0,
  size?: number,
): number => {
  const elementSizeInBytes =
    ArrayBuffer.isView(data) && isTypedArray(data) ? data.BYTES_PER_ELEMENT : 1;

  if (size !== undefined) return size * elementSizeInBytes;

  return Math.max(0, data.byteLength - dataOffset * elementSizeInBytes);
};

const isBuffer = (value: unknown): value is GPUBuffer =>
  typeof value === "object" && value !== null && "size" in value;

/**
 * copyBufferToBuffer has a long form carrying offsets and a shorthand without them.
 * TypeScript resolves the overload to the long form, so the shorthand can only be told
 * apart at runtime by whether the second argument is a buffer or an offset.
 * When size is omitted the spec defaults it to the source buffer minus its offset.
 */
export const calculateBufferCopyBytes = (args: readonly unknown[]): number => {
  const [source, second, third] = args;
  if (!isBuffer(source)) return 0;

  if (isBuffer(second)) {
    return typeof third === "number" ? third : source.size;
  }

  const sourceOffset = typeof second === "number" ? second : 0;
  const size = args[4];
  if (typeof size === "number") return size;

  return Math.max(0, source.size - sourceOffset);
};
