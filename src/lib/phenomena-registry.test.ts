import test from "node:test";
import assert from "node:assert/strict";
import { PHENOMENA } from "../phenomena/registry.ts";

test("every landing-page module includes a current evidence summary", () => {
  const ids = PHENOMENA.map((item) => item.id);
  assert.deepEqual(ids, ["wetland", "agriculture", "forest", "volcano"]);
  for (const item of PHENOMENA) {
    assert.ok(item.evidenceSummary.trim().length >= 40, `${item.id} needs a meaningful evidence summary`);
  }
});

test("module summaries preserve the project's current evidence states and limitations", () => {
  const byId = Object.fromEntries(PHENOMENA.map((item) => [item.id, item.evidenceSummary]));
  assert.match(byId.wetland, /not confirmed floods|candidates remain unverified/i);
  assert.match(byId.wetland, /inconclusive/i);
  assert.match(byId.wetland, /seven-date NISAR PROVISIONAL series/i);
  assert.match(byId.wetland, /two-scene BETA event study/i);
  assert.match(byId.agriculture, /published Naogaon SME2 study/i);
  assert.match(byId.agriculture, /EXPLORATORY/i);
  assert.match(byId.agriculture, /PROVISIONAL/i);
  assert.match(byId.agriculture, /not a crop-stress or drought classifier/i);
  assert.match(byId.forest, /no labelled forest-loss reference or accuracy score/i);
  assert.match(byId.volcano, /not causally attributed to the eruption/i);
});
