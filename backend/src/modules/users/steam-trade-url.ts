import { BadRequestException } from "@nestjs/common";

import { steamAccountId } from "./steam-identity";

const MAX_UINT32 = 4_294_967_295n;
const TRADE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type SteamTradeCredential = {
  partner: string;
  token: string;
};

function invalidTradeUrl(): BadRequestException {
  return new BadRequestException("Invalid Steam Trade URL");
}

export function parseOwnedTradeUrl(raw: string, steamId64: string): SteamTradeCredential {
  if (raw.length === 0 || raw.length > 2_048 || raw !== raw.trim()) throw invalidTradeUrl();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalidTradeUrl();
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "steamcommunity.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/tradeoffer/new/" ||
    url.hash !== ""
  ) {
    throw invalidTradeUrl();
  }

  const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes("partner") || !keys.includes("token")) {
    throw invalidTradeUrl();
  }

  const partner = url.searchParams.get("partner");
  const token = url.searchParams.get("token");
  if (
    partner === null ||
    token === null ||
    !/^[1-9][0-9]{0,9}$/.test(partner) ||
    BigInt(partner) > MAX_UINT32 ||
    !TRADE_TOKEN_PATTERN.test(token) ||
    partner !== steamAccountId(steamId64)
  ) {
    throw invalidTradeUrl();
  }

  return { partner, token };
}
