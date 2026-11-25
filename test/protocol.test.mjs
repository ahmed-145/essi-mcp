import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const token = (id) => `e30.${Buffer.from(JSON.stringify({ role: "authenticated", sub: id })).toString("base64url")}.test`;

async function connect(t, id) {
  const client = new Client({ name: "essi-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "./test/mock-supabase.mjs", "./dist/cli.js"],
    cwd: root,
    env: {
      ESSI_SUPABASE_URL: "https://essi.example.test",
      ESSI_SUPABASE_ANON_KEY: "sb_publishable_test",
      XDG_CONFIG_HOME: root + "test/no-session",
      ...(id ? { ESSI_ACCESS_TOKEN: token(id), TEST_LEARNER_ID: id } : {}),
    },
  });
  t.after(() => client.close());
  await client.connect(transport);
  return client;
}

test("stdio lists tools and resources and reads verified public data", async (t) => {
  const client = await connect(t);
  assert.deepEqual((await client.listTools()).tools.map(({ name }) => name), [
    "lookup_word", "list_lessons", "get_lesson", "explain_morphology", "my_progress", "review_queue",
  ]);
  assert.deepEqual((await client.listResources()).resources.map(({ uri }) => uri),
    ["essi://lexicon", "essi://morphology"]);
  const lexicon = await client.readResource({ uri: "essi://lexicon" });
  assert.equal(JSON.parse(lexicon.contents[0].text)[0].audio_id, "audio-test");
  const morphology = await client.readResource({ uri: "essi://morphology" });
  assert.equal(JSON.parse(morphology.contents[0].text)[0].id, "rule-test");

  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const word = await call("lookup_word", { query: " water ", script: "coptic" });
  assert.equal(word.structuredContent.roots[0].old_nubian, "ⲉⲥⲥⲓ");
  assert.equal((await call("list_lessons")).structuredContent.lessons[0].id, "L1");
  const lesson = (await call("get_lesson", { id: "L1" })).structuredContent;
  assert.deepEqual(lesson.exercises[0].rule_ids, ["rule-test"]);
  assert.equal(lesson.rules.length, 1);
  assert.equal((await call("get_lesson", { id: "missing" })).structuredContent.error.code, "NOT_FOUND");
  assert.equal((await call("explain_morphology", { rule: "indefinite" })).structuredContent.rules.length, 1);
  assert.deepEqual((await call("explain_morphology", { rule: "copula" })).structuredContent.rules, []);
  assert.equal((await call("lookup_word", { query: " " })).isError, true);
  assert.equal((await call("review_queue", { limit: 21 })).isError, true);
  assert.equal((await call("my_progress")).structuredContent.error.code, "AUTH_REQUIRED");
  assert.equal((await call("review_queue", { limit: 1 })).structuredContent.error.code, "AUTH_REQUIRED");
});

test("stdio keeps learner identity out of tool inputs and uses each session", async (t) => {
  const alice = await connect(t, "learner-a");
  const bob = await connect(t, "learner-b");
  const [a, b] = await Promise.all([
    alice.callTool({ name: "my_progress", arguments: {} }),
    bob.callTool({ name: "my_progress", arguments: { user_id: "learner-a" } }),
  ]);
  assert.deepEqual(a.structuredContent, {
    xp: 25, attempts: 4, accuracy: 0.75,
    weakest_rules: [{ rule_id: "rule-test", recall_prob: 0.4 }],
  });
  assert.equal(b.structuredContent.xp, 10);
  const queue = await bob.callTool({ name: "review_queue", arguments: { limit: 1 } });
  assert.deepEqual(queue.structuredContent.queue, [{ id: "learner-b" }]);
  const publicResult = await bob.callTool({ name: "list_lessons", arguments: {} });
  assert.equal(publicResult.structuredContent.lessons[0].id, "L1");
});
