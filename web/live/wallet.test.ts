import assert from "node:assert/strict";
import test from "node:test";
import { classifyInteractionError } from "./wallet";

test("wallet rejection remains distinct from transaction and application failures", () => {
  const rejected = Object.assign(new Error("User rejected the request.\nRequest Arguments: secret-noise"), { code: 4001 });
  assert.deepEqual(classifyInteractionError(rejected, "transaction"), {
    kind: "WALLET_REJECTION",
    message: "User rejected the request.",
  });

  assert.equal(classifyInteractionError(new Error("execution reverted: Slippage"), "transaction").kind, "TRANSACTION_REVERT");
  assert.equal(classifyInteractionError(new Error("HTTP request failed with status 429"), "transaction").kind, "RPC_ERROR");
  assert.equal(classifyInteractionError(new Error("Unexpected result shape"), "transaction").kind, "APPLICATION_ERROR");
});

test("nested provider rejection codes are detected", () => {
  const cause = Object.assign(new Error("Denied"), { code: "ACTION_REJECTED" });
  const error = Object.assign(new Error("Contract write failed"), { cause });
  assert.equal(classifyInteractionError(error, "transaction").kind, "WALLET_REJECTION");
});

test("wrapped RPC transaction reverts retain revert precedence", () => {
  const error = Object.assign(new Error("RPC Request failed"), {
    cause: new Error("execution reverted: policy guard"),
  });
  assert.equal(classifyInteractionError(error, "transaction").kind, "TRANSACTION_REVERT");
});
