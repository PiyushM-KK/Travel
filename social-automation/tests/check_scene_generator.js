/**
 * check_scene_generator.js — the AI Scene Generator (owner's travel-photography workflow).
 * Offline (injected Claude client): proves the generator (1) uses the master prompt as SYSTEM + adds
 * the honesty/grounding constraints + the "avoid recent" history, (2) returns a structured concept
 * with a render-ready imagePrompt + an id, (3) throws (→ caller falls back to the static pool) when
 * the model returns nothing usable, and (4) recentScenesFromStore reads concepts back for the loop.
 *
 *   node tests/check_scene_generator.js
 */

const path = require("path");
const assert = require("assert");
const { generateSceneSpec, resolveScenePrompt, recentScenesFromStore, sceneSummary } = require(path.join(__dirname, "..", "automation", "scene-generator.js"));
const { InMemoryStore } = require(path.join(__dirname, "..", "automation", "store.js"));

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ok -", m); pass++; };

// A Claude stub that records the request and returns a fixed emit_scene tool call.
function stub(sceneInput) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (req) => {
        calls.push(req);
        return { content: [{ type: "tool_use", name: "emit_scene", input: sceneInput }], usage: { input_tokens: 10, output_tokens: 5 } };
      },
    },
  };
}

(async () => {
  const concept = {
    location: "Sonamarg, Kashmir", scene: "Sind River alpine valley",
    moment: "Family preparing breakfast outside a campervan", travellerType: "Campervan Family",
    season: "Late Spring", time: "Morning", weather: "Morning mist", imageType: "Travel Lifestyle",
    camera: "Nikon Z8", lens: "35mm", aperture: "f/5.6", iso: 100, shutter: "1/320",
    composition: "Environmental wide",
    imagePrompt: "Ultra-photorealistic morning-mist scene of an alpine river valley near Sonamarg, a family having breakfast by a campervan, vertical 4:5, clean sky negative space, no text or logos.",
  };

  // ---- 1. happy path: master used as system + constraints + returns a structured spec ----
  {
    const client = stub(concept);
    const spec = await generateSceneSpec({
      pkg: { item: "Kashmir Valley", route: "Srinagar · Gulmarg · Pahalgam · Sonamarg" },
      slug: "kashmir-valley", master: "MASTER-PROMPT-BODY",
      recent: [{ location: "Gulmarg", scene: "meadow", moment: "couple walking" }],
      client,
    });
    const req = client.calls[0];
    ok(req.system.startsWith("MASTER-PROMPT-BODY"), "the master prompt is used as the SYSTEM prompt");
    ok(/ILLUSTRATIVE/.test(req.system) && /do NOT depict a specific identifiable/i.test(req.system), "the honesty/illustrative constraint is appended to system");
    ok(/Srinagar · Gulmarg · Pahalgam · Sonamarg/.test(req.system), "the LOCATION is constrained to the package's route region");
    ok(/Do NOT repeat/i.test(req.messages[0].content) && /Gulmarg/.test(req.messages[0].content), "recent history is passed as an 'avoid repeats' list");
    ok(req.tool_choice && req.tool_choice.name === "emit_scene", "structured output is forced via the emit_scene tool");
    ok(spec.imagePrompt.startsWith(concept.imagePrompt) && /NO text|logos/i.test(spec.imagePrompt), "returns the render-ready imagePrompt with the fixed no-text/no-landmark guard appended");
    ok(/^SKY-KASHMIRVAL/.test(spec.id) && spec.status === "generated", "stamps a scannable id + status=generated");
    ok(spec.location === "Sonamarg, Kashmir" && spec.iso === 100, "carries the full structured metadata (location … camera settings)");
  }

  // ---- 2. no usable scene → throws (caller falls back to the static SCENES pool) ----
  {
    const client = stub({ location: "x", scene: "y", moment: "z", travellerType: "Solo", season: "Summer", time: "Noon", weather: "Clear", imageType: "Pure Landscape", imagePrompt: "   " });
    let threw = false;
    try { await generateSceneSpec({ pkg: { item: "Goa" }, slug: "goa", master: "M", client }); } catch (e) { threw = true; }
    ok(threw, "an empty imagePrompt throws → the card flow falls back to the static pool (never a blank image prompt)");
  }

  // ---- 3. sceneSummary is a compact, comparable record ----
  {
    const s = sceneSummary({ id: "SKY-1", location: "L", scene: "S", moment: "M", season: "Winter", time: "Sunset", weather: "Snow", extra: "dropme" });
    ok(s.location === "L" && s.scene === "S" && s.moment === "M" && s.season === "Winter" && !("extra" in s), "sceneSummary keeps only the comparable fields");
  }

  // ---- 4. recentScenesFromStore reads concepts back from the store (the history feedback loop) ----
  {
    const store = new InMemoryStore();
    const a = await store.create({ status: "published", client: "skyline", imageSource: { kind: "url", url: "u1", sceneMeta: { id: "S1", location: "Kausani", scene: "tea slopes", moment: "sunrise chai" } } });
    await store.create({ status: "drafting", client: "skyline", imageSource: { kind: "url", url: "u2", sceneMeta: { id: "S2", location: "Goa", scene: "beach", moment: "family walk" } } });
    await store.create({ status: "published", client: "other", imageSource: { kind: "url", url: "u3", sceneMeta: { id: "S3", location: "X", scene: "y", moment: "z" } } });
    await store.create({ status: "published", imageSource: { kind: "url", url: "u4", sceneMeta: { id: "S4", location: "LEAK", scene: "y", moment: "z" } } }); // NO client → must NOT leak
    await store.create({ status: "planned", client: "skyline" }); // no sceneMeta → ignored
    const recent = await recentScenesFromStore(store, { client: "skyline" });
    const locs = recent.map((r) => r.location);
    ok(locs.includes("Kausani"), "returns this client's published concepts");
    ok(locs.includes("Goa"), "counts an IN-FLIGHT ('drafting') concept against repetition");
    ok(!locs.includes("X"), "excludes other clients' concepts");
    ok(!locs.includes("LEAK"), "a row with NO client is NOT leaked into this client's history (tenant isolation)");
    ok(recent.every((r) => "scene" in r && "moment" in r && !("imagePrompt" in r)), "returns compact summaries only");
    void a;
  }

  // ---- 5. resolveScenePrompt — the ONE resolver every intake uses (dynamic → static fallback) ----
  {
    // dynamic: a scene client is injected → returns the model's imagePrompt + sceneMeta
    const client = stub(concept);
    const r = await resolveScenePrompt({ pkg: { item: "Kashmir Valley", route: "Srinagar · Sonamarg" }, slug: "kashmir-valley", sceneGenClient: client });
    ok(r.dynamic === true && r.prompt.startsWith(concept.imagePrompt) && r.sceneMeta && r.sceneMeta.location === "Sonamarg, Kashmir",
      "resolveScenePrompt returns the DYNAMIC prompt + sceneMeta when a scene client is available");

    // fallback: generator off → the static SCENES-pool prompt, no sceneMeta
    const prev = process.env.SOCIAL_SCENE_GEN;
    process.env.SOCIAL_SCENE_GEN = "off";
    const f = await resolveScenePrompt({ pkg: { item: "Goa", route: "North Goa" }, slug: "goa", sceneGenClient: client });
    if (prev === undefined) delete process.env.SOCIAL_SCENE_GEN; else process.env.SOCIAL_SCENE_GEN = prev;
    ok(f.dynamic === false && f.sceneMeta === null && /photorealistic/i.test(f.prompt), "resolveScenePrompt falls back to the static pool when SOCIAL_SCENE_GEN=off (never throws)");

    // resilient: a scene client that throws → still returns a usable static prompt (never throws to caller)
    const bad = { messages: { create: async () => { throw new Error("boom"); } } };
    const g = await resolveScenePrompt({ pkg: { item: "Goa", route: "North Goa" }, slug: "goa", sceneGenClient: bad });
    ok(g.dynamic === false && typeof g.prompt === "string" && g.prompt.length > 0, "a scene-gen error falls back to the static pool (the card never loses its image)");
  }

  console.log(`\nSCENE-GENERATOR PASS: master-as-system + honesty + history-aware; structured concept + render-ready prompt; throws→fallback; history read; shared resolver. (${pass} checks)`);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
