import { createClient } from "@supabase/supabase-js";

export class ToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

type Result<T> = { data: T; error: { code?: string } | null };
interface MorphologyRule {
  id: string;
  suffix: string;
  family: string;
  phonological_condition: string;
  example: string | null;
  description_ar: string | null;
  description_en: string | null;
  source: string;
  verified: boolean;
}

type Script = "latin" | "arabic" | "coptic";

const lexiconFields =
  "lexeme_id,root,latin,arabic,old_nubian,translation_ar,translation_en,source,media_assets(id)";
const ruleFields =
  "id,suffix,family,phonological_condition,example,description_ar,description_en,source";

function unwrap<T>({ data, error }: Result<T>): NonNullable<T> {
  if (error?.code === "PGRST301" || error?.code === "PGRST303") {
    throw new ToolError("AUTH_REQUIRED", "Your session expired or is invalid. Run essi-mcp login.");
  }
  if (error || data == null) {
    throw new ToolError("BACKEND_ERROR", "Essi could not return this data.");
  }
  return data;
}

export function publicClient(url: string, key: string, accessToken?: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    ...(accessToken ? { accessToken: async () => accessToken } : {}),
    global: {
      fetch: (input, init) => {
        const timeout = AbortSignal.timeout(10_000);
        const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
        return fetch(input, { ...init, signal, redirect: "error" });
      },
    },
  });
}

export class EssiBackend {
  private readonly publicDb;
  private readonly learnerDb;
  private learnerId: Promise<string> | undefined;

  constructor(url: string, key: string, private readonly token?: string) {
    this.publicDb = publicClient(url, key);
    this.learnerDb = token ? publicClient(url, key, token) : undefined;
  }

  private async verifyLearner() {
    const { data, error } = await this.publicDb.auth.getUser(this.token);
    if (error && (!error.status || error.status >= 500 || error.status === 429)) {
      throw new ToolError("BACKEND_ERROR", "Essi could not verify your session.");
    }
    if (error || !data.user) {
      throw new ToolError("AUTH_REQUIRED", "Your session expired or is invalid. Run essi-mcp login.");
    }
    return data.user.id;
  }

  private async learner() {
    if (!this.learnerDb) {
      throw new ToolError("AUTH_REQUIRED", "Sign in with essi-mcp login to access learner data.");
    }
    // Verify each request so an expired or revoked token cannot yield a successful empty queue.
    // Concurrent calls share the in-flight identity lookup.
    this.learnerId ??= this.verifyLearner().finally(() => { this.learnerId = undefined; });
    return { db: this.learnerDb, id: await this.learnerId };
  }

  async lexicon(query?: string, script?: Script) {
    let request = this.publicDb.from("lexicon_roots").select(lexiconFields)
      .eq("verified", true).order("lexeme_id").limit(query ? 20 : 100)
      .order("id", { referencedTable: "media_assets" }).limit(1, { referencedTable: "media_assets" });
    if (query) {
      const columns = script
        ? [script === "coptic" ? "old_nubian" : script, "translation_ar", "translation_en"]
        : ["root", "latin", "arabic", "old_nubian", "translation_ar", "translation_en"];
      // Quote PostgREST filter values and treat SQL wildcard characters literally.
      const escaped = query.normalize("NFC").replace(/[\\%_]/g, "\\$&");
      const pattern = JSON.stringify(`%${escaped}%`);
      request = request.or(columns.map((column) => `${column}.ilike.${pattern}`).join(","));
    }
    return unwrap(await request).map(({ media_assets, ...root }) => ({
      ...root, audio_id: media_assets[0]?.id ?? null,
    }));
  }

  async lessons() {
    return unwrap(await this.publicDb.from("lessons").select("id,title,title_ar,phase,index")
      .order("phase").order("index").order("id").limit(100));
  }

  async lesson(id: string) {
    const result = await this.publicDb.from("lessons")
      .select("id,title,title_ar,phase,index,objectives,cultural_note,cultural_note_ar")
      .eq("id", id).maybeSingle();
    if (!result.error && !result.data) {
      throw new ToolError("NOT_FOUND", "Essi has no lesson with that ID.");
    }
    const lesson = unwrap(result);
    const exercises = unwrap(await this.publicDb.from("exercises")
      .select(`id,kind,data,exercise_morpheme_map(morphology_rules(${ruleFields},verified))`)
      .eq("lesson_id", id).order("id").limit(50)
      .order("id", { referencedTable: "exercise_morpheme_map" })
      .limit(20, { referencedTable: "exercise_morpheme_map" })
      .overrideTypes<Array<{
        id: string;
        kind: string;
        data: unknown;
        exercise_morpheme_map: Array<{ morphology_rules: MorphologyRule | null }>;
      }>, { merge: false }>());
    const rules = new Map<string, MorphologyRule>();
    return {
      lesson,
      exercises: exercises.map(({ exercise_morpheme_map, ...exercise }) => {
        const ruleIds = new Set<string>();
        for (const { morphology_rules: rule } of exercise_morpheme_map) {
          if (rule?.verified) {
            ruleIds.add(rule.id);
            rules.set(rule.id, rule);
          }
        }
        return { ...exercise, rule_ids: [...ruleIds] };
      }),
      rules: [...rules.values()],
    };
  }

  async morphology(family?: string) {
    let request = this.publicDb.from("morphology_rules").select(ruleFields)
      .eq("verified", true).order("id").limit(family ? 20 : 100);
    if (family) request = request.eq("family", family);
    return unwrap(await request);
  }

  async progress() {
    const { db, id } = await this.learner();
    const [profile, total, correct, weakest] = await Promise.all([
      db.from("user_profiles").select("xp").eq("user_id", id).maybeSingle(),
      db.from("progress_events").select("id", { head: true, count: "exact" }).eq("user_id", id),
      db.from("progress_events").select("id", { head: true, count: "exact" })
        .eq("user_id", id).eq("is_correct", true),
      db.from("srs_morphology").select("rule_id,recall_prob").eq("user_id", id)
        .order("recall_prob").order("rule_id").limit(5),
    ]);
    if (profile.error || total.error || correct.error || total.count == null || correct.count == null) {
      throw new ToolError("BACKEND_ERROR", "Essi could not load your progress.");
    }
    return {
      xp: profile.data?.xp ?? 0,
      attempts: total.count,
      accuracy: total.count ? correct.count / total.count : null,
      weakest_rules: unwrap(weakest),
    };
  }

  async review(limit: number) {
    const { db } = await this.learner();
    const data = unwrap(await db.rpc("generate_review_session", { p_session_length: limit }));
    if (!Array.isArray(data.queue) || !Array.isArray(data.session_focus)) {
      throw new ToolError("BACKEND_ERROR", "Essi returned an unexpected review session.");
    }
    return { queue: data.queue.slice(0, limit), session_focus: data.session_focus.slice(0, 20) };
  }
}
