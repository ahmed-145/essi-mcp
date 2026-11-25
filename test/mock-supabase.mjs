import assert from "node:assert/strict";

const key = "sb_publishable_test";
const lexeme = {
  lexeme_id: "xnz_test", root: "essi", latin: "essi", arabic: "إسي", old_nubian: "ⲉⲥⲥⲓ",
  translation_en: "water", translation_ar: "ماء", source: "test fixture",
  media_assets: [{ id: "audio-test" }],
};
const rule = {
  id: "rule-test", family: "indefinite", suffix: "-test", example: "fixture", verified: true,
};
const exercise = {
  id: "L1_E1", kind: "mcq", data: {},
  exercise_morpheme_map: [{ morphology_rules: rule }, { morphology_rules: { verified: false } }],
};
function roleToken(authorization) {
  if (!authorization?.startsWith("Bearer ")) return "";
  return authorization.slice(7);
}

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  assert.equal(url.origin, "https://essi.example.test");
  const authorization = roleToken(request.headers.get("authorization"));
  const ownUser = authorization === process.env.ESSI_ACCESS_TOKEN ? process.env.TEST_LEARNER_ID : undefined;
  assert.equal(request.headers.get("apikey"), key);
  const reply = (data, status = 200) => Response.json(data, { status });

  switch (url.pathname) {
    case "/auth/v1/user":
      return ownUser ? reply({ id: ownUser }) : reply({ msg: "invalid token" }, 401);
    case "/rest/v1/lexicon_roots":
      assert.equal(authorization, key);
      assert.equal(url.searchParams.get("verified"), "eq.true");
      if (url.searchParams.has("or")) {
        assert.equal(url.searchParams.get("or"),
          '(old_nubian.ilike."%water%",translation_ar.ilike."%water%",translation_en.ilike."%water%")');
      }
      return reply([lexeme]);
    case "/rest/v1/lessons":
      assert.equal(authorization, key);
      return reply(url.searchParams.get("id") === "eq.missing" ? [] : [{ id: "L1", title: "Fixture", index: 1 }]);
    case "/rest/v1/exercises":
      assert.equal(authorization, key);
      return reply([exercise]);
    case "/rest/v1/morphology_rules":
      assert.equal(authorization, key);
      assert.equal(url.searchParams.get("verified"), "eq.true");
      return reply(url.searchParams.get("family") === "eq.copula" ? [] : [rule]);
    case "/rest/v1/user_profiles":
      assert.equal(url.searchParams.get("user_id"), `eq.${ownUser}`);
      return reply([{ xp: ownUser === "learner-a" ? 25 : 10 }]);
    case "/rest/v1/progress_events":
      assert.equal(request.method, "HEAD");
      assert.equal(url.searchParams.get("user_id"), `eq.${ownUser}`);
      return new Response(null, {
        headers: { "Content-Range": url.searchParams.has("is_correct") ? "0-2/3" : "0-3/4" },
      });
    case "/rest/v1/srs_morphology":
      assert.equal(url.searchParams.get("user_id"), `eq.${ownUser}`);
      return reply([{ rule_id: "rule-test", recall_prob: 0.4 }]);
    case "/rest/v1/rpc/generate_review_session":
      assert.ok(ownUser);
      assert.equal(request.method, "POST");
      assert.deepEqual(await request.json(), { p_session_length: 1 });
      return reply({ queue: [{ id: ownUser }, { id: "another exercise" }], session_focus: ["rule-test"] });
    default:
      throw new Error(`Unexpected mock request ${url.pathname}`);
  }
};
