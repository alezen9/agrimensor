import {
  probeAlreadyInstrumented,
  probeInFlightReadbacks,
  probeMixedPassTimeline,
  probePassOverlap,
  probeQuerySetCapacity,
  probeSustainedRun,
} from "./probes.js";

// Phase 4 timestamp spike. Raw WebGPU, no dependency on the library.
// Answers what the spec refuses to promise, on this machine's actual backend.
// Not shipped: `files` in package.json is dist only.

const WORKGROUPS = 256;
const ELEMENTS = WORKGROUPS * 64;

const SHADER = `
@group(0) @binding(0) var<storage, read_write> data: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  var acc = data[id.x];
  for (var i = 0u; i < 4000u; i = i + 1u) {
    acc = acc * 1.0000001 + 0.000001;
  }
  data[id.x] = acc;
}
`;

const setup = async () => {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("no adapter");
  if (!adapter.features.has("timestamp-query")) {
    throw new Error("adapter lacks timestamp-query");
  }

  const device = await adapter.requestDevice({
    requiredFeatures: ["timestamp-query"],
  });

  const module = device.createShaderModule({ code: SHADER });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module, entryPoint: "main" },
  });

  const storage = device.createBuffer({
    size: ELEMENTS * 4,
    usage: GPUBufferUsage.STORAGE,
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: storage } }],
  });

  return { adapter, device, pipeline, bindGroup };
};

// one query set reused across every fixture: index pairs are what identify a pass
const createQueryRing = (device, pairCount) => {
  const querySet = device.createQuerySet({
    type: "timestamp",
    count: pairCount * 2,
  });
  const resolve = device.createBuffer({
    size: pairCount * 2 * 8,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: pairCount * 2 * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  return { querySet, resolve, readback, pairCount };
};

const writesFor = (ring, pairIndex) => ({
  querySet: ring.querySet,
  beginningOfPassWriteIndex: pairIndex * 2,
  endOfPassWriteIndex: pairIndex * 2 + 1,
});

const encodeComputePass = (encoder, ctx, ring, pairIndex) => {
  const pass = encoder.beginComputePass({
    timestampWrites: writesFor(ring, pairIndex),
  });
  pass.setPipeline(ctx.pipeline);
  pass.setBindGroup(0, ctx.bindGroup);
  pass.dispatchWorkgroups(WORKGROUPS);
  pass.end();
};

const readTimestamps = async (device, ring, usedPairs) => {
  const bytes = usedPairs * 2 * 8;
  const encoder = device.createCommandEncoder();
  encoder.resolveQuerySet(ring.querySet, 0, usedPairs * 2, ring.resolve, 0);
  encoder.copyBufferToBuffer(ring.resolve, 0, ring.readback, 0, bytes);
  device.queue.submit([encoder.finish()]);

  await ring.readback.mapAsync(GPUMapMode.READ, 0, bytes);
  const raw = new BigUint64Array(
    ring.readback.getMappedRange(0, bytes).slice(0),
  );
  ring.readback.unmap();

  const pairs = [];
  for (let i = 0; i < usedPairs; i++) {
    pairs.push({ begin: raw[i * 2], end: raw[i * 2 + 1] });
  }
  return pairs;
};

// Fixture D: several passes inside ONE command buffer, one submit.
// Spec calls these "generally comparable", so this is the safest possible ground.
const fixtureSingleCommandBuffer = async (ctx, passCount) => {
  const { device } = ctx;
  const ring = createQueryRing(device, passCount);

  const encoder = device.createCommandEncoder();
  for (let i = 0; i < passCount; i++) encodeComputePass(encoder, ctx, ring, i);
  device.queue.submit([encoder.finish()]);

  const pairs = await readTimestamps(device, ring, passCount);
  ring.querySet.destroy();

  return pairs;
};

// Fixture E: several passes spread across SEPARATE submits, the question the
// spec explicitly declines to answer (gpuweb#4361).
const fixtureAcrossSubmissions = async (ctx, submitCount) => {
  const { device } = ctx;
  const ring = createQueryRing(device, submitCount);

  for (let i = 0; i < submitCount; i++) {
    const encoder = device.createCommandEncoder();
    encodeComputePass(encoder, ctx, ring, i);
    device.queue.submit([encoder.finish()]);
  }

  const pairs = await readTimestamps(device, ring, submitCount);
  ring.querySet.destroy();

  return pairs;
};

const toNumbers = (pairs) =>
  pairs.map(({ begin, end }) => ({
    begin: Number(begin),
    end: Number(end),
    durationNs: Number(end - begin),
  }));

const analyseOrdering = (pairs) => {
  const values = toNumbers(pairs);
  let orderingViolations = 0;
  let zeroOrNegative = 0;

  for (let i = 0; i < values.length; i++) {
    if (values[i].durationNs <= 0) zeroOrNegative++;
    if (i > 0 && values[i].begin < values[i - 1].end) orderingViolations++;
  }

  const durations = values.map((v) => v.durationNs);
  const sumNs = durations.reduce((a, b) => a + b, 0);
  const spanNs = values.at(-1).end - values[0].begin;

  return {
    passCount: values.length,
    orderingViolations,
    zeroOrNegative,
    sumMs: sumNs / 1e6,
    spanMs: spanNs / 1e6,
    gapMs: (spanNs - sumNs) / 1e6,
    durationsMs: durations.map((d) => +(d / 1e6).toFixed(4)),
  };
};

// If Chrome is quantizing, every raw value is a multiple of the quantum.
const detectQuantum = (allPairs) => {
  const values = allPairs.flatMap(({ begin, end }) => [begin, end]);
  const gcd = (a, b) => (b === 0n ? a : gcd(b, a % b));
  let g = 0n;
  for (const v of values) g = gcd(g, v);
  return { rawGcdNs: g.toString(), impliedQuantumUs: Number(g) / 1000 };
};

export const run = async () => {
  const ctx = await setup();
  const report = { runs: [] };

  report.adapter = {
    timestampQuery: ctx.adapter.features.has("timestamp-query"),
    featureCount: [...ctx.adapter.features].length,
  };

  // warm up so first-run compilation does not pollute the numbers
  await fixtureSingleCommandBuffer(ctx, 2);

  const singles = [];
  const crosses = [];

  for (let round = 0; round < 20; round++) {
    const single = await fixtureSingleCommandBuffer(ctx, 4);
    const cross = await fixtureAcrossSubmissions(ctx, 4);
    singles.push(...single);
    crosses.push(...cross);

    report.runs.push({
      round,
      singleCommandBuffer: analyseOrdering(single),
      acrossSubmissions: analyseOrdering(cross),
    });
  }

  const totals = (key) =>
    report.runs.reduce((acc, r) => acc + r[key].orderingViolations, 0);

  report.summary = {
    rounds: report.runs.length,
    singleCommandBufferViolations: totals("singleCommandBuffer"),
    acrossSubmissionsViolations: totals("acrossSubmissions"),
    zeroDurationsSingle: report.runs.reduce(
      (a, r) => a + r.singleCommandBuffer.zeroOrNegative,
      0,
    ),
    zeroDurationsCross: report.runs.reduce(
      (a, r) => a + r.acrossSubmissions.zeroOrNegative,
      0,
    ),
    quantum: detectQuantum([...singles, ...crosses]),
  };

  const helpers = {
    createQueryRing,
    writesFor,
    encodeComputePass,
    readTimestamps,
  };

  report.followUps = {
    mixedPassTimeline: await probeMixedPassTimeline(ctx, helpers),
    passOverlap: await probePassOverlap(ctx, helpers),
    querySetCapacity: await probeQuerySetCapacity(ctx.device),
    inFlightReadbacks: [],
    alreadyInstrumented: await probeAlreadyInstrumented(ctx, helpers),
    sustainedRun: await probeSustainedRun(ctx, helpers, 2000),
  };

  for (const depth of [8, 16, 24, 32, 40, 64]) {
    report.followUps.inFlightReadbacks.push(
      await probeInFlightReadbacks(ctx, helpers, depth),
    );
  }

  ctx.device.destroy();
  return report;
};
