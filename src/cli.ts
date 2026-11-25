#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EssiBackend, publicClient } from "./backend.js";
import { backendConfig, readToken, saveToken } from "./config.js";
import { createServer } from "./server.js";

async function login(url: string, key: string) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error("Login requires an interactive terminal.");
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (hidden) callback();
      else process.stderr.write(chunk, encoding, callback);
    },
  });
  const terminal = createInterface({ input: process.stdin, output, terminal: true });
  const cancellation = new AbortController();
  terminal.once("SIGINT", () => cancellation.abort());
  const options = { signal: cancellation.signal };
  let email: string;
  let password: string;
  try {
    email = (await terminal.question("Email: ", options)).trim();
    process.stderr.write("Password: ");
    hidden = true;
    password = await terminal.question("", options);
  } finally {
    terminal.close();
    process.stderr.write("\n");
  }
  const { data, error } = await publicClient(url, key).auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error("Essi sign-in failed. Check your credentials and project.");
  await saveToken(url, data.session.access_token);
  process.stderr.write("Essi learner session saved. Restart your MCP client to use it.\n");
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "--help" && args.length === 1) {
    console.log("Usage: essi-mcp [login]\nWith no arguments, starts the MCP server over stdio.");
    return;
  }
  if (args.length > 1 || (command && command !== "login")) {
    throw new Error("Usage: essi-mcp [login]");
  }
  const { url, key } = backendConfig();
  if (command === "login") {
    await login(url, key);
    return;
  }
  const backend = new EssiBackend(url, key, await readToken(url));
  await createServer(backend).connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`essi-mcp: ${error instanceof Error ? error.message : "Startup failed."}\n`);
  process.exitCode = 1;
});
