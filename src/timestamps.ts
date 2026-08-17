export type PassKind = "render" | "compute";

export type ResolvedTiming = {
  readonly frameNumber: number;
  readonly renderPassDurationSumInMs: number;
  readonly computePassDurationSumInMs: number;
  readonly executionInMs: number;
  readonly gapSumInMs: number;
  readonly uninstrumentedPassCount: number;
};

type PassRecord = { slot: number; kind: PassKind };

type Region = {
  readonly slotBase: number;
  readonly readback: GPUBuffer;
  passes: PassRecord[];
  frameNumber: number;
  uninstrumentedPassCount: number;
  isPending: boolean;
};

const REGION_COUNT = 4;
const PASSES_PER_REGION = 64;
const QUERIES_PER_REGION = PASSES_PER_REGION * 2;
const BYTES_PER_QUERY = 8;

// resolveQuerySet requires a 256-byte aligned destination offset, so each region
// gets its own aligned slice of the resolve buffer
const REGION_BYTES =
  Math.ceil((QUERIES_PER_REGION * BYTES_PER_QUERY) / 256) * 256;

// a frame span wider than this cannot be real, so the timestamps are not on a
// shared timeline. Ordering cannot be used for this check: the spike proved passes
// genuinely overlap, so out-of-order begins are normal rather than a fault.
const IMPLAUSIBLE_SPAN_NS = 1_000_000_000;

// one implausible reading is a transient: a descheduled submit, a stall, a device
// hiccup. Only a sustained run of them means the timestamps really are not
// comparable, and a later plausible reading clears the count.
const IMPLAUSIBLE_READINGS_BEFORE_GIVING_UP = 5;

export const mergeIntervals = (intervals: { begin: number; end: number }[]) => {
  if (intervals.length === 0) return { executionNs: 0, spanNs: 0 };

  const sorted = [...intervals].sort((a, b) => a.begin - b.begin);
  let executionNs = 0;
  let currentBegin = sorted[0]!.begin;
  let currentEnd = sorted[0]!.end;

  for (let i = 1; i < sorted.length; i++) {
    const { begin, end } = sorted[i]!;
    if (begin > currentEnd) {
      executionNs += currentEnd - currentBegin;
      currentBegin = begin;
      currentEnd = end;
      continue;
    }
    if (end > currentEnd) currentEnd = end;
  }
  executionNs += currentEnd - currentBegin;

  const spanNs = currentEnd - sorted[0]!.begin;
  return { executionNs, spanNs };
};

/**
 * Decides whether timestamps still look like they share a timeline. One implausible
 * reading is a transient, so it takes a sustained run to give up, and any plausible
 * reading clears the count. Never latching permanently matters: giving up is silent
 * and would disable the headline metric for the rest of the session.
 */
export class PlausibilityGate {
  isComparable = true;

  private consecutiveImplausibleReadings = 0;

  record(spanNs: number) {
    if (spanNs <= IMPLAUSIBLE_SPAN_NS) {
      this.consecutiveImplausibleReadings = 0;
      this.isComparable = true;
      return true;
    }

    this.consecutiveImplausibleReadings++;
    if (
      this.consecutiveImplausibleReadings >=
      IMPLAUSIBLE_READINGS_BEFORE_GIVING_UP
    ) {
      this.isComparable = false;
    }
    return false;
  }
}

export class TimestampRecorder {
  readonly isSupported: boolean;
  private readonly plausibility = new PlausibilityGate();

  private readonly device: GPUDevice;
  // captured before instrumentation so agrimensor's own resolve submissions never
  // land in frame.gpuSubmissionCount
  private readonly submitUncounted: (buffers: GPUCommandBuffer[]) => void;
  private readonly querySet: GPUQuerySet | undefined;
  private readonly resolveBuffer: GPUBuffer | undefined;
  private readonly regions: Region[] = [];

  private activeRegion: Region | undefined;
  private latest: ResolvedTiming | undefined;
  private isDestroyed = false;

  constructor(device: GPUDevice) {
    this.device = device;
    this.submitUncounted = device.queue.submit.bind(device.queue);
    this.isSupported = device.features.has("timestamp-query");
    if (!this.isSupported) return;

    this.querySet = device.createQuerySet({
      type: "timestamp",
      count: QUERIES_PER_REGION * REGION_COUNT,
    });
    this.resolveBuffer = device.createBuffer({
      size: REGION_BYTES * REGION_COUNT,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });

    for (let i = 0; i < REGION_COUNT; i++) {
      this.regions.push({
        slotBase: i * PASSES_PER_REGION,
        readback: device.createBuffer({
          size: QUERIES_PER_REGION * BYTES_PER_QUERY,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
        passes: [],
        frameNumber: 0,
        uninstrumentedPassCount: 0,
        isPending: false,
      });
    }
  }

  /** Closes the previous frame's region and opens a fresh one. */
  rotate(frameNumber: number) {
    if (!this.isSupported || this.isDestroyed) return;

    this.closeActiveRegion();

    const candidate = this.regions.find((region) => !region.isPending);
    if (!candidate) return;

    candidate.passes = [];
    candidate.uninstrumentedPassCount = 0;
    candidate.frameNumber = frameNumber;
    this.activeRegion = candidate;
  }

  /**
   * Returns writes to inject into a pass descriptor, or undefined when this pass
   * cannot be instrumented, which the caller reports as an uninstrumented pass.
   */
  countUninstrumentedPass() {
    // with no active region there is no frame to attribute this to, so it is
    // dropped rather than charged to whichever region happens to close next
    if (this.activeRegion) this.activeRegion.uninstrumentedPassCount++;
  }

  claimPass(kind: PassKind): GPURenderPassTimestampWrites | undefined {
    const region = this.activeRegion;
    if (!region || this.isDestroyed) return undefined;
    if (region.passes.length >= PASSES_PER_REGION) return undefined;

    const slot = region.slotBase + region.passes.length;
    region.passes.push({ slot, kind });

    return {
      querySet: this.querySet!,
      beginningOfPassWriteIndex: slot * 2,
      endOfPassWriteIndex: slot * 2 + 1,
    };
  }

  get isCrossSubmissionComparable() {
    return this.plausibility.isComparable;
  }

  getLatest() {
    return this.latest;
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    for (const region of this.regions) region.readback.destroy();
  }

  private closeActiveRegion() {
    const region = this.activeRegion;
    this.activeRegion = undefined;
    if (!region || region.passes.length === 0) return;

    try {
      this.resolveRegion(region);
    } catch {
      // a lost device, or anything else going wrong inside our own bookkeeping,
      // must never propagate into the caller's render loop. Timing simply stops
      // producing figures, which shows up as gpu going undefined, and later frames
      // keep trying in case the fault was transient.
      region.isPending = false;
    }
  }

  private resolveRegion(region: Region) {
    const queryCount = region.passes.length * 2;
    const bytes = queryCount * BYTES_PER_QUERY;
    const regionIndex = region.slotBase / PASSES_PER_REGION;

    const encoder = this.device.createCommandEncoder();
    encoder.resolveQuerySet(
      this.querySet!,
      region.slotBase * 2,
      queryCount,
      this.resolveBuffer!,
      regionIndex * REGION_BYTES,
    );
    encoder.copyBufferToBuffer(
      this.resolveBuffer!,
      regionIndex * REGION_BYTES,
      region.readback,
      0,
      bytes,
    );
    this.submitUncounted([encoder.finish()]);

    region.isPending = true;
    void this.readBack(region, bytes);
  }

  private async readBack(region: Region, bytes: number) {
    try {
      await region.readback.mapAsync(GPUMapMode.READ, 0, bytes);
      if (this.isDestroyed) return;

      const raw = new BigUint64Array(
        region.readback.getMappedRange(0, bytes).slice(0),
      );
      region.readback.unmap();
      this.publish(region, raw);
    } catch {
      // a lost device or a destroyed buffer resolves nothing; the region is
      // released below so instrumentation continues rather than stalling
    } finally {
      region.isPending = false;
    }
  }

  private publish(region: Region, raw: BigUint64Array) {
    const intervals: { begin: number; end: number }[] = [];
    let renderNs = 0;
    let computeNs = 0;

    for (let i = 0; i < region.passes.length; i++) {
      const begin = Number(raw[i * 2]!);
      const end = Number(raw[i * 2 + 1]!);
      if (end <= begin) continue;

      intervals.push({ begin, end });
      if (region.passes[i]!.kind === "render") renderNs += end - begin;
      else computeNs += end - begin;
    }

    if (intervals.length === 0) return;

    const { executionNs, spanNs } = mergeIntervals(intervals);

    if (!this.plausibility.record(spanNs)) return;

    this.latest = {
      frameNumber: region.frameNumber,
      renderPassDurationSumInMs: renderNs / 1e6,
      computePassDurationSumInMs: computeNs / 1e6,
      executionInMs: executionNs / 1e6,
      gapSumInMs: (spanNs - executionNs) / 1e6,
      uninstrumentedPassCount: region.uninstrumentedPassCount,
    };
  }
}
