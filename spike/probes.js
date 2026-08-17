// Follow-up probes for the four questions left open by the first spike run.

const RENDER_SIZE = 512;

const RENDER_SHADER = `
@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  var acc = 0.0;
  for (var i = 0u; i < 800u; i = i + 1u) {
    acc = acc + sin(pos.x * f32(i)) * cos(pos.y * f32(i));
  }
  return vec4f(acc, 0.0, 0.0, 1.0);
}
`;

export const createRenderContext = (device) => {
  const module = device.createShaderModule({ code: RENDER_SHADER });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: "rgba8unorm" }],
    },
  });

  const target = device.createTexture({
    size: [RENDER_SIZE, RENDER_SIZE],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  return { pipeline, view: target.createView(), target };
};

export const encodeRenderPass = (encoder, render, timestampWrites) => {
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: render.view,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    timestampWrites,
  });
  pass.setPipeline(render.pipeline);
  pass.draw(3);
  pass.end();
};

/**
 * Question 3: do render and compute passes report on the same timeline?
 * Interleaves both kinds in one command buffer and checks ordering holds across
 * the type boundary, not just within a type.
 */
export const probeMixedPassTimeline = async (ctx, helpers) => {
  const { device } = ctx;
  const { createQueryRing, writesFor, encodeComputePass, readTimestamps } =
    helpers;
  const render = createRenderContext(device);
  const ring = createQueryRing(device, 4);

  const encoder = device.createCommandEncoder();
  encodeComputePass(encoder, ctx, ring, 0);
  encodeRenderPass(encoder, render, writesFor(ring, 1));
  encodeComputePass(encoder, ctx, ring, 2);
  encodeRenderPass(encoder, render, writesFor(ring, 3));
  device.queue.submit([encoder.finish()]);

  const pairs = await readTimestamps(device, ring, 4);
  ring.querySet.destroy();
  render.target.destroy();

  const kinds = ["compute", "render", "compute", "render"];
  let violations = 0;
  for (let i = 1; i < pairs.length; i++) {
    if (pairs[i].begin < pairs[i - 1].end) violations++;
  }

  return {
    orderingViolationsAcrossPassTypes: violations,
    durationsMs: pairs.map((p) => +(Number(p.end - p.begin) / 1e6).toFixed(4)),
    kinds,
    allPositive: pairs.every((p) => p.end > p.begin),
  };
};

/**
 * Question 1a: how large can a single timestamp query set be?
 * WebGPU exposes no limit for this, so it has to be probed.
 */
export const probeQuerySetCapacity = async (device) => {
  const attempts = [8, 256, 2048, 4096, 4097, 8192, 65536];
  const results = [];

  for (const count of attempts) {
    device.pushErrorScope("validation");
    device.pushErrorScope("out-of-memory");
    let querySet = null;
    try {
      querySet = device.createQuerySet({ type: "timestamp", count });
    } catch (error) {
      results.push({ count, ok: false, threw: String(error.message) });
      await device.popErrorScope();
      await device.popErrorScope();
      continue;
    }
    const oom = await device.popErrorScope();
    const validation = await device.popErrorScope();
    querySet.destroy();

    results.push({
      count,
      ok: !oom && !validation,
      error: validation?.message ?? oom?.message ?? null,
    });
  }

  return results;
};

/**
 * Question 1b: how many resolved readbacks can be in flight at once?
 * Submits many frames without awaiting any mapAsync, then awaits them all.
 */
export const probeInFlightReadbacks = async (ctx, helpers, depth) => {
  const { device } = ctx;
  const { createQueryRing, encodeComputePass } = helpers;

  const rings = [];
  const pending = [];

  device.pushErrorScope("validation");

  for (let i = 0; i < depth; i++) {
    const ring = createQueryRing(device, 1);
    rings.push(ring);

    const encoder = device.createCommandEncoder();
    encodeComputePass(encoder, ctx, ring, 0);
    encoder.resolveQuerySet(ring.querySet, 0, 2, ring.resolve, 0);
    encoder.copyBufferToBuffer(ring.resolve, 0, ring.readback, 0, 16);
    device.queue.submit([encoder.finish()]);

    pending.push(ring.readback.mapAsync(GPUMapMode.READ, 0, 16));
  }

  await Promise.all(pending);

  let sane = 0;
  for (const ring of rings) {
    const raw = new BigUint64Array(
      ring.readback.getMappedRange(0, 16).slice(0),
    );
    if (raw[1] > raw[0]) sane++;
    ring.readback.unmap();
    ring.querySet.destroy();
    ring.resolve.destroy();
    ring.readback.destroy();
  }

  const validation = await device.popErrorScope();

  return {
    depth,
    resolvedSanely: sane,
    validationError: validation?.message ?? null,
  };
};

/**
 * Question 4: does a long run leak or exhaust anything?
 * Reuses one fixed ring the way the library will, rather than allocating per frame.
 */
export const probeSustainedRun = async (ctx, helpers, frames) => {
  const { device } = ctx;
  const { createQueryRing, encodeComputePass } = helpers;
  const ring = createQueryRing(device, 2);

  device.pushErrorScope("validation");

  let nonMonotonic = 0;
  let zeroOrNegative = 0;
  let previousEnd = 0n;
  const durations = [];

  for (let frame = 0; frame < frames; frame++) {
    const encoder = device.createCommandEncoder();
    encodeComputePass(encoder, ctx, ring, 0);
    encodeComputePass(encoder, ctx, ring, 1);
    encoder.resolveQuerySet(ring.querySet, 0, 4, ring.resolve, 0);
    encoder.copyBufferToBuffer(ring.resolve, 0, ring.readback, 0, 32);
    device.queue.submit([encoder.finish()]);

    await ring.readback.mapAsync(GPUMapMode.READ, 0, 32);
    const raw = new BigUint64Array(
      ring.readback.getMappedRange(0, 32).slice(0),
    );
    ring.readback.unmap();

    for (let pair = 0; pair < 2; pair++) {
      const begin = raw[pair * 2];
      const end = raw[pair * 2 + 1];
      if (end <= begin) zeroOrNegative++;
      if (previousEnd > 0n && begin < previousEnd) nonMonotonic++;
      previousEnd = end;
    }
    durations.push(Number(raw[1] - raw[0]) / 1e6);
  }

  const validation = await device.popErrorScope();
  ring.querySet.destroy();
  ring.resolve.destroy();
  ring.readback.destroy();

  const half = Math.floor(durations.length / 2);
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;

  return {
    frames,
    zeroOrNegative,
    nonMonotonicAcrossFrames: nonMonotonic,
    validationError: validation?.message ?? null,
    firstHalfMeanMs: +mean(durations.slice(0, half)).toFixed(4),
    secondHalfMeanMs: +mean(durations.slice(half)).toFixed(4),
  };
};

/**
 * Question 2: what happens when the application already claimed timestampWrites?
 * Confirms the descriptor carries exactly one, so an observer has to yield rather
 * than co-instrument, and confirms reusing an index for two passes in one command
 * buffer is a validation error.
 */
export const probeAlreadyInstrumented = async (ctx, helpers) => {
  const { device } = ctx;
  const { createQueryRing, writesFor, encodeComputePass } = helpers;
  const ring = createQueryRing(device, 2);

  // a second timestampWrites cannot be attached: the descriptor has one field, so
  // an object literal simply overwrites it
  const descriptor = {
    timestampWrites: writesFor(ring, 0),
    ...{ timestampWrites: writesFor(ring, 1) },
  };
  const singleFieldWins =
    descriptor.timestampWrites.beginningOfPassWriteIndex === 2;

  device.pushErrorScope("validation");
  const encoder = device.createCommandEncoder();
  encodeComputePass(encoder, ctx, ring, 0);
  encodeComputePass(encoder, ctx, ring, 0);
  device.queue.submit([encoder.finish()]);
  const reuseError = await device.popErrorScope();

  ring.querySet.destroy();
  ring.resolve.destroy();
  ring.readback.destroy();

  return {
    descriptorHoldsOneWritesObject: singleFieldWins,
    reusingAnIndexInOneCommandBuffer: reuseError
      ? `rejected: ${reuseError.message.split("\n")[0]}`
      : "accepted silently",
  };
};

/**
 * Ordering violations between render and compute passes have two very different
 * causes: separate clock domains, which would make the values incomparable, or
 * genuine concurrent execution, which is legitimate and merely means a span is
 * not a sum. This returns raw offsets so the two can be told apart, and compares
 * against same-type sequences as a control.
 */
export const probePassOverlap = async (ctx, helpers) => {
  const { device } = ctx;
  const { createQueryRing, writesFor, encodeComputePass, readTimestamps } =
    helpers;
  const render = createRenderContext(device);

  const collect = async (kinds) => {
    const ring = createQueryRing(device, kinds.length);
    const encoder = device.createCommandEncoder();
    kinds.forEach((kind, i) => {
      if (kind === "compute") encodeComputePass(encoder, ctx, ring, i);
      else encodeRenderPass(encoder, render, writesFor(ring, i));
    });
    device.queue.submit([encoder.finish()]);

    const pairs = await readTimestamps(device, ring, kinds.length);
    ring.querySet.destroy();

    const base = pairs[0].begin;
    return pairs.map((p, i) => ({
      kind: kinds[i],
      beginOffsetNs: Number(p.begin - base),
      endOffsetNs: Number(p.end - base),
    }));
  };

  const violations = (rows) => {
    let n = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].beginOffsetNs < rows[i - 1].endOffsetNs) n++;
    }
    return n;
  };

  const mixed = await collect(["compute", "render", "compute", "render"]);
  const computeOnly = await collect(["compute", "compute", "compute"]);
  const renderOnly = await collect(["render", "render", "render"]);

  render.target.destroy();

  // if the two kinds used different clocks, offsets between them would be
  // wildly out of scale rather than interleaved within the same few ms
  const spanNs = Math.max(...mixed.map((r) => r.endOffsetNs));
  const maxDurationNs = Math.max(
    ...mixed.map((r) => r.endOffsetNs - r.beginOffsetNs),
  );

  return {
    mixed,
    mixedViolations: violations(mixed),
    computeOnlyViolations: violations(computeOnly),
    renderOnlyViolations: violations(renderOnly),
    mixedSpanMs: +(spanNs / 1e6).toFixed(4),
    mixedLongestPassMs: +(maxDurationNs / 1e6).toFixed(4),
    verdict:
      spanNs > 0 && spanNs < maxDurationNs * 20
        ? "same timeline, passes overlap"
        : "offsets out of scale, suspect separate clocks",
  };
};
