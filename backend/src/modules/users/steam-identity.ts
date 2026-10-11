const MAX_UINT64 = (1n << 64n) - 1n;
const ACCOUNT_ID_MASK = 0xffff_ffffn;

export type VerifiedSteamIdentity = {
  claimedIdentifier: string;
  providerEndpoint: string;
  responseNonce: string;
  steamId64: string;
};

export type SteamProfile = {
  avatarUrl: string | null;
  displayName: string | null;
};

export function canonicalSteamId64(value: string): string {
  if (!/^(?:0|[1-9][0-9]{0,19})$/.test(value)) throw new Error("SteamID64 is not canonical");
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > MAX_UINT64) throw new Error("SteamID64 is out of range");
  return parsed.toString(10);
}

export function steamAccountId(steamId64: string): string {
  return (BigInt(canonicalSteamId64(steamId64)) & ACCOUNT_ID_MASK).toString(10);
}
