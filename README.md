# Essi MCP

[![CI](https://github.com/ahmed-145/essi-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmed-145/essi-mcp/actions/workflows/ci.yml)

Essi MCP gives coding assistants read-only access to the Mattokki (Kenzi Nubian)
lexicon, lessons, and learner review data stored in Essi's Supabase backend.


## Live demo

[Watch the 60-second MP4](essi-codex-demo.mp4) or [view the terminal recording](essi-codex-demo.cast).
Codex looks up “water” in live Essi data, retrieves two verified indefinite
morphology rules, and cites the recorded source and examples.

## Quick start

With Node.js 22 or later, clone this repository and run these commands from its root.

```sh
npm install
npm run build
cp .env.example .env
```

Set `ESSI_SUPABASE_URL` and `ESSI_SUPABASE_ANON_KEY` in `.env` using the project's
origin and publishable or legacy anon key. Public tools work with those two values.
If the Supabase free-tier project is paused, resume it before connecting.

Add this entry to your Codex `config.toml`, with absolute paths to your checkout.

```toml
[mcp_servers.essi]
command = "node"
args = ["--env-file=/path/to/essi-mcp/.env", "/path/to/essi-mcp/dist/cli.js"]
```

Restart Codex and ask it to use `lookup_word` for “water” and report the Mattokki
form and source. Ask `explain_morphology` for the indefinite family and have it
cite the rule and examples it finds. [Codex MCP configuration](https://developers.openai.com/codex/mcp)

For learner tools, run the following command in an interactive terminal and
restart the MCP client.

```sh
node --env-file=.env dist/cli.js login
```

Login uses an existing Supabase email/password account. It saves the access token
in `$XDG_CONFIG_HOME/essi-mcp/session.json` or `~/.config/essi-mcp/session.json`
with file mode `0600` on Unix. Run login again after expiration. You can also
supply `ESSI_ACCESS_TOKEN` through the environment.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `lookup_word` | `query`, optional `script` | Verified roots, glosses, script forms, source, and an audio asset ID when available |
| `list_lessons` | None | Lesson IDs and titles in curriculum order |
| `get_lesson` | `id` | Exercises and associated verified grammar rules |
| `explain_morphology` | `rule` | Verified rules and recorded examples for a family |
| `my_progress` | None, learner session required | XP, recorded-answer accuracy, and up to five weakest rules |
| `review_queue` | Optional `limit` from 1 to 20, learner session required | Due review exercises with linked lexeme and rule IDs |

The `essi://lexicon` and `essi://morphology` resources provide bounded snapshots
of verified content. An empty morphology result means the database has no
verified rules for that family. The checked-in Essi app migration has no
`copula` family. The review queue follows the existing
`generate_review_session(p_session_length)` RPC, which returns exercises linked
to review items. Accuracy is `null` before the first recorded answer.

## Security

Use a publishable or anon key. User operations verify the session through
Supabase Auth and run with that learner's token so RLS applies. Public tools use
the public client even when a learner is signed in. The server never stores the
password or refresh token. Keep tokens and local configuration out of version
control. Tool payloads have row limits and a 64 KiB JSON size limit.

## Decisions

- **Read-only tools.** Learners and assistants can look up verified content and
  review progress without recording answers or changing study state.
- **Keep row-level security in force.** Public requests use a publishable or
  anon key. Learner requests use the learner's own access token, so Supabase
  can enforce access to that learner's rows. Service-role keys bypass those
  policies and are rejected by the server configuration.
- **Stdio first.** Codex starts the server as a local child process. This keeps
  installation simple and avoids running a network listener for a local tool.

## Tests and packaging

```sh
npm run lint
npm test
npm pack
docker build -t essi-mcp .
docker run --rm -i --env-file .env essi-mcp
```

The test suite launches the compiled server via the MCP client SDK with mocked
Supabase responses and reports coverage. To verify live RLS, load the Essi
project settings, set `ESSI_TEST_LIVE_RLS=1`, and supply
`ESSI_TEST_TOKEN_A` and `ESSI_TEST_TOKEN_B` for two distinct test accounts with
existing profiles. Then run `npm test`. The live test makes read-only requests.

The npm tarball exposes the `essi-mcp` binary. To install it locally, run
`npm install -g ./essi-mcp-0.1.0.tgz`. For learner tools in Docker, pass the
access token via Docker's environment.
