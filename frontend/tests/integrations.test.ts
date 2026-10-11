import {test} from "node:test";
import assert from "node:assert/strict";
import {unavailablePurchase,unavailableTopup} from "../src/lib/integrations.ts";
test("all money-moving operations remain unavailable without providers",()=>{for(const result of [unavailablePurchase(),unavailableTopup("steam"),unavailableTopup("balance")]){assert.equal(result.status,409);assert.equal(result.body.code,"INTEGRATION_UNAVAILABLE");assert.equal("paymentUrl" in result.body,false);assert.equal("orderId" in result.body,false);}});
