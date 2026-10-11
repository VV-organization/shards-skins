import { describe, expect, it } from "vitest";

import { createProblemDetails } from "./problem-details";

describe("createProblemDetails", () => {
  it("creates a stable problem-details envelope with request id and optional field errors", () => {
    expect(createProblemDetails({
      status: 422,
      code: "VALIDATION_FAILED",
      title: "Validation failed",
      detail: "Request body is invalid.",
      requestId: "req_123",
      fieldErrors: { amount: ["Must be positive."] },
    })).toEqual({
      type: "https://shards.local/problems/validation-failed",
      title: "Validation failed",
      status: 422,
      code: "VALIDATION_FAILED",
      detail: "Request body is invalid.",
      requestId: "req_123",
      fieldErrors: { amount: ["Must be positive."] },
    });
  });
});
