// Sustained-run soak. The library's own region recycling, readback pressure and slot
// exhaustion have only ever been exercised against a fake. This runs the built
// artifact against a real GPU for thousands of frames.

import { attach } from "../dist/index.js";

const COMPUTE = `
@group(0) @binding(0) var<storage, read_write> data: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  var acc = data[id.x];
  for (var i = 0u; i < 100u; i = i + 1u) { acc = acc * 1.0000001 + 0.000001; }
  data[id.x] = acc;
}
`;

const setup = async () => {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  const device = await adapter.requestDevice({
    requiredFeatures: ["timestamp-query"],
  });

  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: device.createShaderModule({ code: COMPUTE }),
      entryPoint: "main",
    },
  });

  const storage = device.createBuffer({
    size: 64 * 64 * 4,
    usage: GPUBufferUsage.STORAGE,
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: storage } }],
  });

  return { device, pipeline, bindGroup };
};

const encodeFrame = (ctx, passCount) => {
  const encoder = ctx.device.createCommandEncoder();
  for (let i = 0; i < passCount; i++) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(ctx.pipeline);
    pass.setBindGroup(0, ctx.bindGroup);
    pass.dispatchWorkgroups(16);
    pass.end();
  }
  ctx.device.queue.submit([encoder.finish()]);
};

const soak = async (ctx, { frames, passCount }) => {
  const agrimensor = attach(ctx.device);
  const result = {
    frames,
    passCount,
    framesWithGpu: 0,
    maxResultLagFrameCount: 0,
    maxUninstrumentedPassCount: 0,
    nonPositiveExecution: 0,
    firstQuarterMeanExecutionMs: 0,
    lastQuarterMeanExecutionMs: 0,
    lostComparability: false,
    error: null,
  };

  const executions = [];

  try {
    for (let frame = 0; frame < frames; frame++) {
      agrimensor.beginRenderFrame();
      encodeFrame(ctx, passCount);

      const snapshot = agrimensor.snapshot();
      const gpu = snapshot.gpu;
      if (gpu) {
        result.framesWithGpu++;
        executions.push(gpu.submittedRenderAndComputePassExecutionInMs);

        if (gpu.resultLagFrameCount > result.maxResultLagFrameCount) {
          result.maxResultLagFrameCount = gpu.resultLagFrameCount;
        }
        if (gpu.uninstrumentedPassCount > result.maxUninstrumentedPassCount) {
          result.maxUninstrumentedPassCount = gpu.uninstrumentedPassCount;
        }
        if (gpu.submittedRenderAndComputePassExecutionInMs <= 0) {
          result.nonPositiveExecution++;
        }
      }

      if (!agrimensor.capabilities.crossSubmissionTimestampsComparable) {
        result.lostComparability = true;
      }

      // yield so readbacks can land, the way a real render loop would
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  } catch (error) {
    result.error = String(error && error.message);
  }

  const mean = (list) =>
    list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  const quarter = Math.floor(executions.length / 4);
  result.firstQuarterMeanExecutionMs = +mean(
    executions.slice(0, quarter),
  ).toFixed(4);
  result.lastQuarterMeanExecutionMs = +mean(executions.slice(-quarter)).toFixed(
    4,
  );
  result.resolvedRatio = +(result.framesWithGpu / frames).toFixed(3);

  agrimensor.destroy();
  return result;
};

export const run = async () => {
  const ctx = await setup();
  const report = {};

  // a normal frame, well inside the 64 pass budget per region
  report.normal = await soak(ctx, { frames: 2000, passCount: 3 });

  // deliberately past the per-region slot budget, so the tail of every frame
  // cannot be instrumented and must be reported rather than silently dropped
  report.slotExhaustion = await soak(ctx, { frames: 200, passCount: 80 });

  // no yielding between frames starves the readback path, which is the case
  // most likely to exhaust all four regions
  const agrimensor = attach(ctx.device);
  let framesWithoutRegion = 0;
  for (let frame = 0; frame < 500; frame++) {
    agrimensor.beginRenderFrame();
    encodeFrame(ctx, 3);
    if (!agrimensor.snapshot().gpu) framesWithoutRegion++;
  }
  report.readbackStarvation = {
    frames: 500,
    framesWithoutGpuEntry: framesWithoutRegion,
    stillComparable:
      agrimensor.capabilities.crossSubmissionTimestampsComparable,
  };
  agrimensor.destroy();

  ctx.device.destroy();
  return report;
};
