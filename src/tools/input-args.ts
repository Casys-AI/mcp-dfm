/**
 * Direct-handler argument guards.
 *
 * MCP schema validation is bypassed when a handler is invoked in-process, so
 * these checks close the same contract before any STEP snapshot or native
 * subprocess starts.
 */

const BUILD_VOLUME_AXES = new Set(["x", "y", "z"]);

export function rejectUnknownArgs(
  args: Record<string, unknown>,
  allowed: readonly string[],
  toolName: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(args)) {
    if (!allowedSet.has(key)) {
      throw new TypeError(`[${toolName}] unknown argument '${key}'.`);
    }
  }
}

export function requireFinitePositive(
  value: unknown,
  name: string,
  toolName: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(
      `[${toolName}] ${name} must be a finite positive number.`,
    );
  }
  return value;
}

export function requireOptionalFinitePositive(
  value: unknown,
  name: string,
  toolName: string,
): number | undefined {
  if (value === undefined) return undefined;
  return requireFinitePositive(value, name, toolName);
}

export function requireFinitePositiveInteger(
  value: unknown,
  name: string,
  toolName: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new TypeError(
      `[${toolName}] ${name} must be a finite positive integer.`,
    );
  }
  return value;
}

export function requireOptionalFinitePositiveInteger(
  value: unknown,
  name: string,
  toolName: string,
): number | undefined {
  if (value === undefined) return undefined;
  return requireFinitePositiveInteger(value, name, toolName);
}

export function requireFiniteInRange(
  value: unknown,
  name: string,
  toolName: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `[${toolName}] ${name} must be a finite number between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

export function requireFiniteVector3(
  value: unknown,
  name: string,
  toolName: string,
): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(
      `[${toolName}] ${name} must be an array of three finite numbers.`,
    );
  }
  const x = value[0];
  const y = value[1];
  const z = value[2];
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    throw new TypeError(
      `[${toolName}] ${name} must be an array of three finite numbers.`,
    );
  }
  return [x, y, z];
}

export function requireNonEmptyString(
  value: unknown,
  name: string,
  toolName: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      `[${toolName}] ${name} must be a non-empty string.`,
    );
  }
  return value;
}

export function requireOptionalSha256Hex(
  value: unknown,
  name: string,
  toolName: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new TypeError(
      `[${toolName}] ${name} must be a 64-character hexadecimal SHA-256 digest.`,
    );
  }
  return value;
}

export function requireBuildVolume(
  value: unknown,
  toolName: string,
): { x: number; y: number; z: number } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `[${toolName}] build_volume_mm must be an object with finite positive x, y, and z.`,
    );
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!BUILD_VOLUME_AXES.has(key)) {
      throw new TypeError(
        `[${toolName}] build_volume_mm has unknown property '${key}'.`,
      );
    }
  }
  return {
    x: requireFinitePositive(record.x, "build_volume_mm.x", toolName),
    y: requireFinitePositive(record.y, "build_volume_mm.y", toolName),
    z: requireFinitePositive(record.z, "build_volume_mm.z", toolName),
  };
}
