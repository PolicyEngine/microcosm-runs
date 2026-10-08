import { expect, test } from "bun:test";
import { syntheticPublication } from "../scripts/qualify";
test("qualification uses synthetic graph bytes exceeding the function body limit", () => {
  const { bytes, value } = syntheticPublication();
  expect(bytes.length).toBeGreaterThan(20 * 1024 * 1024);
  expect(value.files[0].bytes).toBe(bytes.length);
  expect(value.publication_id).toStartWith("qualification-");
  expect("run_id" in value).toBe(false);
});
