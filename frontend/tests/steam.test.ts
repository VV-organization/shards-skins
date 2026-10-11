import {test} from "node:test";
import assert from "node:assert/strict";
import {lookupSteamProfile,SteamError} from "../src/lib/steam.ts";
const id="76561198000000000";
const mock=(xml:string):typeof fetch=>async()=>new Response(xml);
test("Steam profile is verified against returned ID and uses fixed official origin",async()=>{
  const fetcher:typeof fetch=async(url,options)=>{assert.equal(String(url),`https://steamcommunity.com/profiles/${id}/?xml=1`);assert.equal(options?.redirect,"error");return new Response(`<steamID64>${id}</steamID64><steamID><![CDATA[Player <3]]></steamID>`);};
  assert.equal((await lookupSteamProfile(id,fetcher)).name,"Player <3");
});
test("invalid ID never makes a network request",async()=>{await assert.rejects(lookupSteamProfile("https://example.com",async()=>{throw new Error("must not fetch");}),e=>e instanceof SteamError&&e.status===400);});
test("not found, mismatched profiles and oversized responses never report success",async()=>{
  await assert.rejects(lookupSteamProfile(id,mock("<error>Profile could not be found</error>")),e=>e instanceof SteamError&&e.status===404);
  await assert.rejects(lookupSteamProfile(id,mock("<steamID64>76561198000000001</steamID64>")),e=>e instanceof SteamError&&e.status===502);
  await assert.rejects(lookupSteamProfile(id,mock("x".repeat(262145))),e=>e instanceof SteamError&&e.status===502);
});
