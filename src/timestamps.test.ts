import { describe, expect, it } from "vitest";
import { mergeIntervals, PlausibilityGate } from "./timestamps";

describe("mergeIntervals", () => {
  it("reports nothing for no passes", () => {
    expect(mergeIntervals([])).toEqual({ executionNs: 0, spanNs: 0 });
  });

  it("treats a single pass as execution with no gap", () => {
    const { executionNs, spanNs } = mergeIntervals([{ begin: 10, end: 40 }]);

    expect(executionNs).toBe(30);
    expect(spanNs).toBe(30);
  });

  it("counts back-to-back passes once each", () => {
    const { executionNs, spanNs } = mergeIntervals([
      { begin: 0, end: 10 },
      { begin: 10, end: 25 },
    ]);

    expect(executionNs).toBe(25);
    expect(spanNs).toBe(25);
  });

  it("counts overlapping time once, so execution is below the duration sum", () => {
    // the sum of these two is 40, but they only occupy 25 of wall clock
    const { executionNs, spanNs } = mergeIntervals([
      { begin: 0, end: 20 },
      { begin: 5, end: 25 },
    ]);

    expect(executionNs).toBe(25);
    expect(spanNs).toBe(25);
  });

  it("counts a fully contained pass once", () => {
    const { executionNs } = mergeIntervals([
      { begin: 0, end: 100 },
      { begin: 20, end: 40 },
    ]);

    expect(executionNs).toBe(100);
  });

  it("excludes idle between passes from execution but not from span", () => {
    const { executionNs, spanNs } = mergeIntervals([
      { begin: 0, end: 20 },
      { begin: 50, end: 70 },
    ]);

    expect(executionNs).toBe(40);
    expect(spanNs).toBe(70);
    expect(spanNs - executionNs).toBe(30);
  });

  it("does not depend on the order passes were recorded in", () => {
    const ordered = mergeIntervals([
      { begin: 0, end: 20 },
      { begin: 50, end: 70 },
    ]);
    const shuffled = mergeIntervals([
      { begin: 50, end: 70 },
      { begin: 0, end: 20 },
    ]);

    expect(shuffled).toEqual(ordered);
  });

  it("spans from the earliest begin to the latest end, not to the last recorded", () => {
    // mirrors real measured data: the last encoded pass began early and ended last,
    // while a middle pass ended sooner, so positional first and last are wrong
    const { spanNs } = mergeIntervals([
      { begin: 0, end: 373_625 },
      { begin: 36_208, end: 2_676_500 },
      { begin: 374_000, end: 3_027_750 },
      { begin: 94_208, end: 5_286_333 },
    ]);

    expect(spanNs).toBe(5_286_333);
  });

  it("matches the overlap measured on real hardware", () => {
    const passes = [
      { begin: 0, end: 373_625 },
      { begin: 36_208, end: 2_676_500 },
      { begin: 374_000, end: 3_027_750 },
      { begin: 94_208, end: 5_286_333 },
    ];
    const durationSum = passes.reduce((a, p) => a + (p.end - p.begin), 0);
    const { executionNs } = mergeIntervals(passes);

    // the sum more than doubles the real time, which is why execution exists
    expect(durationSum).toBe(10_859_792);
    expect(executionNs).toBe(5_286_333);
    expect(durationSum / executionNs).toBeGreaterThan(2);
  });
});

describe("PlausibilityGate", () => {
  const implausible = 2_000_000_000;
  const plausible = 5_000_000;

  it("assumes the timestamps are comparable until shown otherwise", () => {
    expect(new PlausibilityGate().isComparable).toBe(true);
  });

  it("tolerates a single transient rather than giving up", () => {
    const gate = new PlausibilityGate();

    expect(gate.record(implausible)).toBe(false);
    expect(gate.isComparable).toBe(true);
  });

  it("gives up only after a sustained run of bad readings", () => {
    const gate = new PlausibilityGate();

    for (let i = 0; i < 5; i++) gate.record(implausible);

    expect(gate.isComparable).toBe(false);
  });

  it("recovers once readings look sane again", () => {
    const gate = new PlausibilityGate();
    for (let i = 0; i < 10; i++) gate.record(implausible);
    expect(gate.isComparable).toBe(false);

    gate.record(plausible);

    expect(gate.isComparable).toBe(true);
  });

  it("does not accumulate across a good reading", () => {
    const gate = new PlausibilityGate();

    for (let i = 0; i < 4; i++) gate.record(implausible);
    gate.record(plausible);
    for (let i = 0; i < 4; i++) gate.record(implausible);

    expect(gate.isComparable).toBe(true);
  });
});
