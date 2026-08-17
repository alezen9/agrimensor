// Overhead benchmark. Measures what agrimensor costs rather than asserting it is
// negligible. Imports the built artifact so the figures describe what ships.

import { attach } from "../dist/index.js";

const SHADER = `
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

@fragment
fn fs() -> @location(0) vec4f {
  return vec4f(1.0, 0.0, 0.0, 1.0);
}
`;

const COMPUTE = `
@group(0) @binding(0) var<storage, read_write> data: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  var acc = data[id.x];
  for (var i = 0u; i < 200u; i = i + 1u) { acc = acc * 1.0000001 + 0.000001; }
  data[id.x] = acc;
}
`;

const setup = async () => {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  const device = await adapter.requestDevice({
    requiredFeatures: adapter.features.has("timestamp-query")
      ? ["timestamp-query"]
      : [],
  });

  const renderModule = device.createShaderModule({ code: SHADER });
  const renderPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: renderModule, entryPoint: "vs" },
    fragment: {
      module: renderModule,
      entryPoint: "fs",
      targets: [{ format: "rgba8unorm" }],
    },
  });

  const computePipeline = device.createComputePipeline({
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
    layout: computePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: storage } }],
  });

  const target = device.createTexture({
    size: [256, 256],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  return {
    device,
    renderPipeline,
    computePipeline,
    bindGroup,
    view: target.createView(),
    hasTimestamps: device.features.has("timestamp-query"),
  };
};

const renderPassDescriptor = (view) => ({
  colorAttachments: [
    {
      view,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    },
  ],
});

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Reports the fastest of many repeats rather than the median. Scheduling noise and
 * driver contention only ever add time, so the minimum is the sample least polluted
 * by them. Using the median let driver variance swamp the signal badly enough to
 * report a patched path as faster than an unpatched one, which is impossible.
 */
const measure = (label, iterations, run, repeats = 15) => {
  const samples = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    const started = performance.now();
    run(iterations);
    samples.push(performance.now() - started);
  }
  const fastestMs = Math.min(...samples);
  return {
    label,
    iterations,
    fastestMs,
    spreadMs: +(Math.max(...samples) - fastestMs).toFixed(3),
    nsPerCall: (fastestMs * 1e6) / iterations,
  };
};

const compare = (baseline, attached) => ({
  baselineNsPerCall: +baseline.nsPerCall.toFixed(1),
  attachedNsPerCall: +attached.nsPerCall.toFixed(1),
  overheadNsPerCall: +(attached.nsPerCall - baseline.nsPerCall).toFixed(1),
  overheadPercent: +(
    ((attached.nsPerCall - baseline.nsPerCall) / baseline.nsPerCall) *
    100
  ).toFixed(1),
  baselineSpreadMs: baseline.spreadMs,
  attachedSpreadMs: attached.spreadMs,
});

const benchDraws = (ctx) => {
  const run = (iterations) => {
    const encoder = ctx.device.createCommandEncoder();
    const pass = encoder.beginRenderPass(renderPassDescriptor(ctx.view));
    pass.setPipeline(ctx.renderPipeline);
    for (let i = 0; i < iterations; i++) pass.draw(3);
    pass.end();
  };
  return { run, iterations: 200_000 };
};

const benchBufferCreation = (ctx) => {
  const run = (iterations) => {
    for (let i = 0; i < iterations; i++) {
      ctx.device
        .createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM })
        .destroy();
    }
  };
  return { run, iterations: 20_000 };
};

const benchPassCreation = (ctx) => {
  const run = (iterations) => {
    for (let i = 0; i < iterations; i++) {
      const encoder = ctx.device.createCommandEncoder();
      const pass = encoder.beginRenderPass(renderPassDescriptor(ctx.view));
      pass.end();
    }
  };
  return { run, iterations: 60_000 };
};

const benchSubmit = (ctx) => {
  const run = (iterations) => {
    for (let i = 0; i < iterations; i++) {
      ctx.device.queue.submit([ctx.device.createCommandEncoder().finish()]);
    }
  };
  return { run, iterations: 5_000 };
};

// a frame shaped like a real one: several render passes, a compute pass, uploads
const encodeRealisticFrame = (ctx, uploadBuffer) => {
  const encoder = ctx.device.createCommandEncoder();

  for (let pass = 0; pass < 6; pass++) {
    const renderPass = encoder.beginRenderPass(renderPassDescriptor(ctx.view));
    renderPass.setPipeline(ctx.renderPipeline);
    for (let draw = 0; draw < 150; draw++) renderPass.draw(3);
    renderPass.end();
  }

  const computePass = encoder.beginComputePass();
  computePass.setPipeline(ctx.computePipeline);
  computePass.setBindGroup(0, ctx.bindGroup);
  computePass.dispatchWorkgroups(64);
  computePass.end();

  ctx.device.queue.writeBuffer(uploadBuffer, 0, new Float32Array(256));
  ctx.device.queue.submit([encoder.finish()]);
};

const benchFrame = async (ctx, agrimensor) => {
  const uploadBuffer = ctx.device.createBuffer({
    size: 4096,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // warm up first: pipeline compilation and GPU clock ramp both distort early frames
  for (let frame = 0; frame < 60; frame++) {
    agrimensor?.beginRenderFrame();
    encodeRealisticFrame(ctx, uploadBuffer);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  // the browser clamps performance.now() to 100us, which is the same order as one
  // frame's CPU cost, so per-frame samples would be pure quantisation. Timing the
  // whole run and dividing puts the measurement far above the clamp.
  const measuredFrames = 300;
  const started = performance.now();
  for (let frame = 0; frame < measuredFrames; frame++) {
    agrimensor?.beginRenderFrame();
    encodeRealisticFrame(ctx, uploadBuffer);
  }
  const totalMs = performance.now() - started;

  uploadBuffer.destroy();
  return { perFrameMs: totalMs / measuredFrames, totalMs, measuredFrames };
};

export const run = async () => {
  const ctx = await setup();
  const report = { hasTimestamps: ctx.hasTimestamps, cases: {} };

  const cases = {
    drawCall: benchDraws,
    bufferCreateDestroy: benchBufferCreation,
    renderPassCreation: benchPassCreation,
    queueSubmit: benchSubmit,
  };

  for (const [name, build] of Object.entries(cases)) {
    const { run: exercise, iterations } = build(ctx);

    exercise(1000); // warm up before the baseline is taken
    const baseline = measure(name, iterations, exercise);

    const agrimensor = attach(ctx.device);
    agrimensor.beginRenderFrame();
    const attached = measure(name, iterations, exercise);
    agrimensor.destroy();

    report.cases[name] = compare(baseline, attached);
  }

  const baselineFrame = await benchFrame(ctx, undefined);
  const attachedInstance = attach(ctx.device);
  const attachedFrame = await benchFrame(ctx, attachedInstance);
  const snapshot = attachedInstance.snapshot();
  attachedInstance.destroy();

  report.frame = {
    baselineCpuMs: +baselineFrame.perFrameMs.toFixed(4),
    attachedCpuMs: +attachedFrame.perFrameMs.toFixed(4),
    overheadCpuMs: +(
      attachedFrame.perFrameMs - baselineFrame.perFrameMs
    ).toFixed(4),
    overheadPercent: +(
      ((attachedFrame.perFrameMs - baselineFrame.perFrameMs) /
        baselineFrame.perFrameMs) *
      100
    ).toFixed(1),
    measuredOverTotalMs: {
      baseline: +baselineFrame.totalMs.toFixed(1),
      attached: +attachedFrame.totalMs.toFixed(1),
      frames: baselineFrame.measuredFrames,
    },
    drawCallsPerFrame: 900,
    renderPassesPerFrame: 6,
    observedByAgrimensor: snapshot.frame?.drawCallCount ?? null,
    gpuResolved: snapshot.gpu !== undefined,
  };

  ctx.device.destroy();
  return report;
};
