import { describe, expect, it } from "vitest";
import { patchMethod, RestoreRegistry } from "./patch";

class Subject {
  greet(name: string) {
    return `hello ${name}`;
  }
}

describe("patchMethod", () => {
  it("removes the shadow on restore so the prototype method is reachable again", () => {
    const subject = new Subject();
    const restore = patchMethod(
      subject,
      "greet",
      (original) =>
        function (this: Subject, name: string) {
          return original.call(this, name).toUpperCase();
        },
    );

    expect(subject.greet("ada")).toBe("HELLO ADA");
    expect(Object.hasOwn(subject, "greet")).toBe(true);

    restore();

    expect(subject.greet("ada")).toBe("hello ada");
    expect(Object.hasOwn(subject, "greet")).toBe(false);
  });

  it("puts back a pre-existing own property instead of deleting it", () => {
    const subject = new Subject();
    subject.greet = (name: string) => `own ${name}`;

    const restore = patchMethod(
      subject,
      "greet",
      () => (name: string) => `patched ${name}`,
    );
    expect(subject.greet("ada")).toBe("patched ada");

    restore();

    expect(subject.greet("ada")).toBe("own ada");
    expect(Object.hasOwn(subject, "greet")).toBe(true);
  });

  it("forwards arguments, return value and receiver unchanged", () => {
    const subject = new Subject();
    let seenReceiver: unknown;

    patchMethod(
      subject,
      "greet",
      (original) =>
        function (this: Subject, name: string) {
          seenReceiver = this;
          return original.call(this, name);
        },
    );

    expect(subject.greet("ada")).toBe("hello ada");
    expect(seenReceiver).toBe(subject);
  });

  it("lets exceptions from the original propagate untouched", () => {
    const failure = new Error("original exploded");
    const subject = {
      run() {
        throw failure;
      },
    };

    patchMethod(
      subject,
      "run",
      (original) =>
        function (this: typeof subject) {
          return original.call(this);
        },
    );

    expect(() => subject.run()).toThrow(failure);
  });
});

describe("RestoreRegistry", () => {
  it("unwinds in reverse order and only once", () => {
    const order: number[] = [];
    const registry = new RestoreRegistry();
    registry.add(() => order.push(1));
    registry.add(() => order.push(2));

    registry.runAll();
    registry.runAll();

    expect(order).toEqual([2, 1]);
  });
});
