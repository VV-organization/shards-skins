import { readFileSync } from "node:fs";

export function optionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function optionalStringFromFile(path: string | undefined): string | undefined {
  const normalizedPath = optionalString(path);
  if (normalizedPath === undefined) return undefined;
  return optionalString(readFileSync(normalizedPath, "utf8"));
}
