// WebGPU exposes these as browser globals. The library uses them the way real code
// does, so tests provide the spec values rather than the source avoiding them.
globalThis.GPUBufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
} as GPUBufferUsage;

globalThis.GPUMapMode = { READ: 0x0001, WRITE: 0x0002 } as GPUMapMode;
