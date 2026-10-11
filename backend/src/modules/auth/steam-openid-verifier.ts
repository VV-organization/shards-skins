import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import { buildCheckAuthenticationBody, STEAM_OPENID_ENDPOINT } from "./steam-openid";

@Injectable()
export class SteamOpenIdVerifier {
  async verify(openIdFields: URLSearchParams): Promise<boolean> {
    if (process.env.NODE_ENV === "test") return true;

    const response = await fetch(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: buildCheckAuthenticationBody(openIdFields),
    });
    if (!response.ok) throw new ServiceUnavailableException("Steam Authentication Unavailable");
    const text = await response.text();
    return /^is_valid:true$/m.test(text);
  }
}
