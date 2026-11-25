import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const session = z.object({ url: z.string(), token: z.string() });

function roleOf(key: string): unknown {
  try {
    const parts = key.split(".");
    if (parts.length !== 3) return undefined;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()).role;
  } catch {
    return undefined;
  }
}

export function backendConfig(env: NodeJS.ProcessEnv = process.env) {
  const rawUrl = env.ESSI_SUPABASE_URL;
  const key = env.ESSI_SUPABASE_ANON_KEY?.trim();
  const url = URL.parse(rawUrl ?? "");
  const isLocalHttp = url?.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!url || (url.protocol !== "https:" && !isLocalHttp) || url.username || url.password ||
    url.search || url.hash || url.pathname !== "/") {
    throw new Error("Set ESSI_SUPABASE_URL to your Supabase project origin.");
  }
  if (!key || (!/^sb_publishable_[\w-]+$/.test(key) && roleOf(key) !== "anon")) {
    throw new Error("Set ESSI_SUPABASE_ANON_KEY to a publishable or legacy anon key.");
  }
  return { url: url.origin, key };
}

function sessionDirectory() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "essi-mcp");
}

export async function readToken(url: string) {
  let token = process.env.ESSI_ACCESS_TOKEN?.trim();
  if (!token) {
    try {
      const stored = session.parse(JSON.parse(await readFile(join(sessionDirectory(), "session.json"), "utf8")));
      if (stored.url === url) token = stored.token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Could not read the saved session. Run essi-mcp login.");
      }
    }
  }
  if (token && roleOf(token) !== "authenticated") {
    throw new Error("ESSI_ACCESS_TOKEN must be an authenticated learner access token.");
  }
  return token;
}

export async function saveToken(url: string, token: string) {
  if (roleOf(token) !== "authenticated") throw new Error("Essi did not return a learner access token.");
  const directory = sessionDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `session-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ url, token }), { mode: 0o600, flag: "wx" });
    await rename(temporary, join(directory, "session.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}
