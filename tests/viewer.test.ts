import { expect, test } from "bun:test";
import { encodeLocation, decodeLocation } from "@axiom-foundation/orrery";
test("Orrery deep links preserve selections and filters", () => {
  const location = {
    selectedId: "node/1",
    query: "calibration",
    focusId: "one",
    direction: "upstream" as const,
  };
  expect(decodeLocation(encodeLocation(location))).toMatchObject(location);
});
