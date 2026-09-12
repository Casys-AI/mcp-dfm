/**
 * Closed JSON kernel for the DFM viewer contract.
 *
 * Exact records, dense arrays, and the shared recorded-session fingerprint
 * hash. No domain vocabulary lives here.
 */

const DIGEST = /^[a-f0-9]{64}$/;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const ISO_MILLISECONDS =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

const FORBIDDEN_KEYS = new Set([
  "stagedPath",
  "source_path",
  "sourcePath",
  "step_path",
  "command",
  "commands",
]);

export function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): void {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${name} contains missing or unsupported fields.`);
  }
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${name} contains missing or unsupported fields.`);
    }
  }
  const actual = (ownKeys as string[]).toSorted();
  const expected = [...keys].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${name} contains missing or unsupported fields.`);
  }
}

export function exactRecord(
  value: unknown,
  keys: readonly string[],
  name: string,
): Record<string, unknown> {
  const root = record(value, name);
  exactKeys(root, keys, name);
  rejectForbiddenKeys(root, name);
  return root;
}

export function denseArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
  const allowed = new Set<string>(["length"]);
  for (let index = 0; index < value.length; index += 1) {
    allowed.add(String(index));
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== allowed.size ||
    ownKeys.some((key) => typeof key !== "string" || !allowed.has(key))
  ) {
    throw new TypeError(`${name} must be a dense, unadorned array.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${name} must be a dense, unadorned array.`);
    }
  }
  return value;
}

export function literal<T extends string>(
  value: unknown,
  expected: T,
  name: string,
): T {
  if (value !== expected) throw new TypeError(`${name} must be ${expected}.`);
  return expected;
}

export function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
}

export function pattern(value: unknown, expected: RegExp, name: string): string {
  if (typeof value !== "string" || !expected.test(value)) {
    throw new TypeError(`${name} has an invalid format.`);
  }
  return value;
}

export function digest(value: unknown, name: string): string {
  return pattern(value, DIGEST, name);
}

export function fingerprint(value: unknown, name: string): string {
  return pattern(value, FINGERPRINT, name);
}

export function canonicalTimestamp(value: unknown, name: string): string {
  const timestamp = pattern(value, ISO_MILLISECONDS, name);
  try {
    if (new Date(timestamp).toISOString() !== timestamp) {
      throw new TypeError(`${name} is not canonical UTC.`);
    }
  } catch {
    throw new TypeError(`${name} is not canonical UTC.`);
  }
  return timestamp;
}

export function integerAtLeast(
  value: unknown,
  minimum: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${name} must be an integer at least ${minimum}.`);
  }
  return value as number;
}

export function nonNegativeInteger(value: unknown, name: string): number {
  return integerAtLeast(value, 0, name);
}

export function positiveInteger(value: unknown, name: string): number {
  return integerAtLeast(value, 1, name);
}

export function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite.`);
  }
  return value;
}

export function nonNegativeNumber(value: unknown, name: string): number {
  const n = finiteNumber(value, name);
  if (n < 0) throw new TypeError(`${name} must be a non-negative number.`);
  return n;
}

export function positiveNumber(value: unknown, name: string): number {
  const n = finiteNumber(value, name);
  if (n <= 0) throw new TypeError(`${name} must be a positive number.`);
  return n;
}

export function vector3(value: unknown, name: string): [number, number, number] {
  const values = denseArray(value, name);
  if (values.length !== 3) {
    throw new TypeError(`${name} must contain three values.`);
  }
  return [
    finiteNumber(values[0], `${name}[0]`),
    finiteNumber(values[1], `${name}[1]`),
    finiteNumber(values[2], `${name}[2]`),
  ];
}

export function nonZeroVector3(
  value: unknown,
  name: string,
): [number, number, number] {
  const vector = vector3(value, name);
  if (vector[0] === 0 && vector[1] === 0 && vector[2] === 0) {
    throw new TypeError(`${name} must not be a zero vector.`);
  }
  return vector;
}

export function strings(value: unknown, name: string): readonly string[] {
  return denseArray(value, name).map((item, index) =>
    nonEmpty(item, `${name}[${index}]`)
  );
}

export function rejectForbiddenKeys(value: unknown, name: string): void {
  if (Array.isArray(value)) {
    const items = denseArray(value, name);
    for (let index = 0; index < items.length; index += 1) {
      rejectForbiddenKeys(items[index], `${name}[${index}]`);
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const root = record(value, name);
  for (const key of Object.keys(root)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new TypeError(
        `${name}.${key} is a private path or command field and must not appear in the viewer contract.`,
      );
    }
    rejectForbiddenKeys(root[key], `${name}.${key}`);
  }
}

export function canonicalJson(value: unknown, name: string): string {
  if (
    value === null || typeof value === "boolean" || typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${name} must contain only finite JSON numbers.`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = denseArray(value, name);
    return `[${
      items.map((item, index) => canonicalJson(item, `${name}[${index}]`))
        .join(",")
    }]`;
  }
  const root = record(value, name);
  const prototype = Object.getPrototypeOf(root);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must contain only plain JSON objects.`);
  }
  const ownKeys = Reflect.ownKeys(root);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${name} must contain only string-keyed JSON objects.`);
  }
  const keys = (ownKeys as string[]).toSorted();
  const fields = keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(root, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${name}.${key} must be an enumerable JSON value.`);
    }
    return `${JSON.stringify(key)}:${
      canonicalJson(descriptor.value, `${name}.${key}`)
    }`;
  });
  return `{${fields.join(",")}}`;
}

export async function sha256Fingerprint(
  value: unknown,
  name: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value, name));
  const digestBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes),
  );
  return `sha256:${
    Array.from(digestBytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    )
  }`;
}

export function assertDigestAddress(
  uri: string,
  artifactFingerprint: string,
  expected: RegExp,
  name: string,
): void {
  const match = expected.exec(uri);
  if (!match || artifactFingerprint !== `sha256:${match[1]}`) {
    throw new TypeError(
      `${name} URI and fingerprint must identify the same bytes.`,
    );
  }
}
