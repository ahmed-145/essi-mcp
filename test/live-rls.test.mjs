import assert from "node:assert/strict";
import { test } from "node:test";
import { backendConfig } from "../dist/config.js";
import { publicClient } from "../dist/backend.js";

test("a live learner cannot read another learner's profile", {
  skip: process.env.ESSI_TEST_LIVE_RLS !== "1",
}, async () => {
  const { url, key } = backendConfig();
  const tokenA = process.env.ESSI_TEST_TOKEN_A;
  const tokenB = process.env.ESSI_TEST_TOKEN_B;
  assert.ok(tokenA && tokenB, "Supply two test learner access tokens.");
  const anon = publicClient(url, key);

  async function identify(token) {
    const { data, error } = await anon.auth.getUser(token);
    assert.ok(!error && data.user?.id, "A test learner token could not be verified.");
    return data.user.id;
  }

  const [idA, idB] = await Promise.all([identify(tokenA), identify(tokenB)]);
  assert.notEqual(idA, idB);
  for (const [token, own, other] of [[tokenA, idA, idB], [tokenB, idB, idA]]) {
    const db = publicClient(url, key, token);
    const { data, error } = await db.from("user_profiles").select("user_id").in("user_id", [own, other]);
    assert.ok(!error, "The profile query failed.");
    assert.ok(data.length === 1 && data[0].user_id === own, "Expected only the caller's seeded profile.");
  }
});
