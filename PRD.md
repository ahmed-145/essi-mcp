# PRD: essi-mcp, an MCP server for the Essi (Learn Nubian) backend

- **Owner:** Ahmed Mahmoud Abbas
- **Status:** Draft v1 (Nov 25, 2026)
- **Build time:** about 1 to 1.5 weeks at 10 to 15 h/week
- **Budget:** $0 (Supabase free tier, GitHub Actions free minutes, no paid APIs)
- **Build order:** Build this FIRST. It is small, ships fast, and teaches the MCP protocol you reuse in the second repo (oncall-triage-agent).

## 1. Why this exists

Essi already has a real backend: Supabase PostgreSQL with row level security, a server-side SM-2 spaced repetition engine (trigger `trg_update_srs_on_answer`, RPC `generate_review_session`), and a verified Mattokki lexicon and grammar data set. Nothing lets an AI agent use it. This repo exposes Essi as MCP tools so Codex (or any MCP client) can look up Nubian words, explain morphology and pull a learner's review queue.

What it proves to a recruiter: you can design a tool interface for agents, respect an auth boundary (RLS, no service key), test a protocol server, and ship it with CI and a container. It also gives Essi a second life as a tool people can actually install.

Honest limit: the lexicon is small (25 verified roots, 12 lessons per the Essi README). This is a focused, well-built wrapper, not a big system. Its value is in the quality of the engineering, not the size. Do not oversell it.

## 2. Goals

- A working MCP server (stdio first, streamable HTTP second) that Codex can call.
- Read-only public tools that work with the Supabase anon key and RLS.
- Per-user tools that act only as the signed-in learner, never with a service role key.
- Tests, CI, Docker image, and a README a stranger can follow in 5 minutes.
- A short demo clip: Codex asking "how do I say X in Mattokki and why does the suffix change" and getting a grounded answer from Essi data.

## 3. Non-goals

- No writes to the database in v1 (no recording answers). Add later as a separate milestone if wanted.
- No hosting a public server. Local stdio plus a Docker image is enough.
- No new linguistic content. Use what Essi already verified.
- No paid services.

## 4. Tools and resources (v1 contract)

Public (anon key, RLS enforced):
| Tool | Input | Output |
|---|---|---|
| `lookup_word` | `query`, optional `script` (latin, arabic, coptic) | matching roots with gloss, audio id, script forms |
| `list_lessons` | none | lesson ids, titles, order |
| `get_lesson` | `id` | exercises and the grammar rules it teaches |
| `explain_morphology` | `rule` (accusative, copula, indefinite) | rule text, examples from the lexicon |

Per learner (user session token):
| Tool | Input | Output |
|---|---|---|
| `my_progress` | none | XP, accuracy, weakest rules |
| `review_queue` | `limit` | words due now, from `generate_review_session` |

Resources: `essi://lexicon` and `essi://morphology` as read-only text for clients that prefer resources.

Rules: every tool has a typed schema, clear descriptions, bounded output size, and returns structured errors (not stack traces). Tool descriptions are written for an LLM reader.

## 5. Technical design

- Language: TypeScript (matches the Essi stack) with the official MCP TypeScript SDK and `zod` schemas. Verify the current SDK package name and version on its docs before starting.
- Backend access: `@supabase/supabase-js` with anon key from env. Per-learner tools read `ESSI_ACCESS_TOKEN`, obtained by a small `essi-mcp login` command that signs in with email and password and stores only the session token locally. Never store the password.
- Config: `.env.example`, no secrets in the repo, secret scanning enabled.
- Packaging: `npm` bin entry so `npx` can run it, plus a Dockerfile (multi-stage, non-root).
- Codex setup: README shows the MCP server entry for Codex's config. Check the current Codex MCP config format in its docs when you write it.

## 6. Milestones

| # | Milestone | Done when | Time |
|---|---|---|---|
| M0 | Repo skeleton, lint, TS strict, CI that runs on every push | green check badge | 2 h |
| M1 | stdio server with `lookup_word` and `list_lessons` against Supabase | MCP Inspector lists and calls both | 4 h |
| M2 | Rest of the public tools and resources, size limits, error shape | all four public tools pass contract tests | 5 h |
| M3 | Login command and per-learner tools, RLS verified by a test that a second user cannot read the first user's data | test passes | 6 h |
| M4 | Tests: unit with mocked Supabase, plus an integration test using the MCP client SDK against the real process | CI green, coverage reported (measured, not guessed) | 5 h |
| M5 | Dockerfile, npm bin, README, Codex setup, 60 s demo clip | a fresh machine runs it from the README | 4 h |
| M6 (optional) | Streamable HTTP transport behind a bearer token | works locally in Docker | 5 h |

## 7. Definition of done

- CI green on main. README has install, config, tool list, security notes, and a demo GIF or clip.
- A "Decisions" section in the README: why read-only, why no service key, why stdio first.
- You can explain every file in the repo out loud without notes. If you cannot, do not ship it yet. (You have said you worry about the "vibe coder" label. Writing the decisions section yourself is the cure.)

## 8. What it shows a recruiter

- You understand agent tooling at the protocol level, not just prompting.
- You think about auth boundaries and least privilege.
- You ship tested, containerized, documented software.
- It is attached to a product you care about (Nubian language), which makes a good interview story.

## 9. Risks

- Supabase free tier pauses inactive projects. Wake it before a demo and note this in the README.
- The Essi backend RPC contract may have drifted from the README. Check the real function signatures in the Supabase SQL editor first (M1).
- Scope creep into writes or hosting. Park it in a "later" list.
