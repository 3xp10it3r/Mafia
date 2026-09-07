import assert from "node:assert/strict";
import test from "node:test";
import { requestHasValidOrigin } from "./security";

test("origin validation accepts same-origin and configured origins", () => {
  const original = process.env.ALLOWED_ORIGIN;
  try {
    delete process.env.ALLOWED_ORIGIN;
    assert.equal(requestHasValidOrigin(new Request("http://localhost:3000/api/game", { headers: { origin: "http://localhost:3000" } })), true);
    process.env.ALLOWED_ORIGIN = "https://mafia.example.com,http://localhost:3000";
    assert.equal(requestHasValidOrigin(new Request("https://mafia.example.com/api/game", { headers: { origin: "https://mafia.example.com" } })), true);
    assert.equal(requestHasValidOrigin(new Request("https://mafia.example.com/api/game", { headers: { origin: "https://evil.example.com" } })), false);
  } finally {
    if (original === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = original;
  }
});

test("origin validation permits requests without an Origin header", () => {
  assert.equal(requestHasValidOrigin(new Request("http://localhost:3000/api/game")), true);
});
