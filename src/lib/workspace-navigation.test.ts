import test from "node:test";
import assert from "node:assert/strict";
import { findDrawerTabForAnchor } from "./workspace-navigation.ts";

const tabs = [
  { id: "EXPLORE", anchorIds: ["nisar-run-controls"] },
  { id: "CHECK", anchorIds: ["nisar-reference-evidence"] },
  { id: "LEARN", anchorIds: ["nisar-case-story-title", "mozambique-case-title"] },
];

test("deep links resolve to the drawer tab that owns the target section", () => {
  assert.equal(findDrawerTabForAnchor(tabs, "mozambique-case-title")?.id, "LEARN");
  assert.equal(findDrawerTabForAnchor(tabs, "nisar-reference-evidence")?.id, "CHECK");
});

test("unknown or missing deep links do not select an unrelated drawer tab", () => {
  assert.equal(findDrawerTabForAnchor(tabs, "missing-section"), undefined);
  assert.equal(findDrawerTabForAnchor(tabs, null), undefined);
  assert.equal(findDrawerTabForAnchor(undefined, "mozambique-case-title"), undefined);
});
