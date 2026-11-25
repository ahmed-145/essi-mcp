import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { backendConfig, readToken, saveToken } from "../dist/config.js";

const jwt = (role) => `e30.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.test`;
const origin = "https://essi.example.test";

test("configuration accepts anon keys and rejects privileged keys or unsafe URLs", () => {
  const env = { ESSI_SUPABASE_URL: origin, ESSI_SUPABASE_ANON_KEY: jwt("anon") };
  assert.deepEqual(backendConfig(env), { url: origin, key: jwt("anon") });
  for (const key of ["sb_secret_test", jwt("service_role"), ""]) {
    assert.throws(() => backendConfig({ ...env, ESSI_SUPABASE_ANON_KEY: key }), /publishable or legacy anon/);
  }
  for (const url of ["http://essi.example.test", origin + "/rest/v1", origin + "?secret=1", "https://user@essi.example.test"]) {
    assert.throws(() => backendConfig({ ...env, ESSI_SUPABASE_URL: url }), /Supabase project origin/);
  }
});

test("saved sessions contain only the project origin and token, and are project bound", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "essi-test-"));
  const previousDirectory = process.env.XDG_CONFIG_HOME;
  const previousToken = process.env.ESSI_ACCESS_TOKEN;
  t.after(async () => {
    if (previousDirectory === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousDirectory;
    if (previousToken === undefined) delete process.env.ESSI_ACCESS_TOKEN;
    else process.env.ESSI_ACCESS_TOKEN = previousToken;
    await rm(directory, { recursive: true, force: true });
  });
  process.env.XDG_CONFIG_HOME = directory;
  delete process.env.ESSI_ACCESS_TOKEN;
  const token = jwt("authenticated");
  await saveToken(origin, token);
  assert.equal(await readToken(origin), token);
  assert.equal(await readToken("https://different.example.test"), undefined);
  const path = join(directory, "essi-mcp", "session.json");
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { url: origin, token });
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  process.env.ESSI_ACCESS_TOKEN = jwt("service_role");
  await assert.rejects(() => readToken(origin), /authenticated learner/);
});
