export type Restore = () => void;

type MethodKeys<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];

/**
 * Shadows a method with an own property on this one object. WebIDL methods live on the
 * prototype and are writable and configurable, so the shadow wins for calls made through
 * this instance and leaves every other instance of the same interface untouched.
 */
export const patchMethod = <
  T extends object,
  K extends MethodKeys<T> & keyof T,
>(
  target: T,
  key: K,
  createReplacement: (original: T[K]) => T[K],
): Restore => {
  const ownDescriptor = Object.getOwnPropertyDescriptor(target, key);
  target[key] = createReplacement(target[key]);

  return () => {
    // no own descriptor means the method came from the prototype, so deleting the
    // shadow restores it rather than writing a copy onto the instance
    if (!ownDescriptor) {
      Reflect.deleteProperty(target, key);
      return;
    }
    Object.defineProperty(target, key, ownDescriptor);
  };
};

export class RestoreRegistry {
  private restores: Restore[] = [];

  add(restore: Restore) {
    this.restores.push(restore);
  }

  runAll() {
    // reverse order so nested patches unwind the way they were applied
    for (let i = this.restores.length - 1; i >= 0; i--) {
      this.restores[i]?.();
    }
    this.restores.length = 0;
  }
}
