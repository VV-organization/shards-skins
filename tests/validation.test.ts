import {test} from "node:test";
import assert from "node:assert/strict";
import {validSteamId,validTradeUrl} from "../src/lib/validation.ts";
test("Steam ID rejects URLs, invalid lengths and non-individual ranges",()=>{
  assert.equal(validSteamId("76561198000000000"),true);
  for(const id of ["12345678901234567","76561190000000000","76561198000000000x",null,"https://steamcommunity.com"]){assert.equal(validSteamId(id),false);}
});
test("trade URL is fixed to Steam and requires partner and token",()=>{
  assert.equal(validTradeUrl("https://steamcommunity.com/tradeoffer/new/?partner=12345678&token=AbCd_-12"),true);
  for(const url of ["https://steamcommunity.com.evil.test/tradeoffer/new/?partner=123&token=AbCd_-12","javascript:alert(1)","https://steamcommunity.com/tradeoffer/new/?partner=123&token=x","https://steamcommunity.com/tradeoffer/new/?partner=123&token=AbCd_-12&token=other"]){assert.equal(validTradeUrl(url),false);}
});
