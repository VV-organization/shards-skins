export function validSteamId(value: unknown): value is string {
  if (typeof value !== "string" || !/^7656119\d{10}$/.test(value)) return false;
  const id = BigInt(value);
  return id >= 76561197960265728n && id <= 76561202255233023n;
}
export function validTradeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "steamcommunity.com" && !url.port &&
      !url.username && !url.password && url.pathname === "/tradeoffer/new/" &&
      /^[1-9]\d{0,9}$/.test(url.searchParams.get("partner") ?? "") &&
      /^[A-Za-z0-9_-]{8}$/.test(url.searchParams.get("token") ?? "") &&
      [...url.searchParams.keys()].length === 2 && !url.hash;
  } catch { return false; }
}
