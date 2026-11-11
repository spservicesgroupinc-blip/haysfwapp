import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contractAmounts,
  moneyCents,
  formatCents,
} from "../src/services/contract";

test("contract totals use exact cents and include previous changes and credits", () => {
  assert.deepEqual(
    contractAmounts({
      originalContract: "167045.81",
      previousChanges: "1250.19",
    }),
    {
      original: "$167,045.81",
      previous: "$1,250.19",
      total: "$168,296.00",
    },
  );
  assert.equal(
    contractAmounts({ originalContract: "0.10", previousChanges: "0.20" })
      .total,
    "$0.30",
  );
  assert.equal(
    contractAmounts({ originalContract: "100", previousChanges: "-25.01" })
      .total,
    "$74.99",
  );
  assert.equal(
    contractAmounts({ originalContract: "0", previousChanges: "" }).total,
    "$0.00",
  );
  assert.equal(
    formatCents(moneyCents("999999999999999999.99")!),
    "$999,999,999,999,999,999.99",
  );
});

test("missing and invalid prices never imply a zero contract", () => {
  assert.equal(
    contractAmounts({ originalContract: "", previousChanges: "" }).total,
    "Not provided",
  );
  assert.equal(
    contractAmounts({ originalContract: "junk", previousChanges: "0" }).total,
    "Unavailable",
  );
  assert.equal(
    contractAmounts({ originalContract: "100", previousChanges: "junk" }).total,
    "Unavailable",
  );
  for (const text of [
    "1e3",
    "Infinity",
    "NaN",
    "1.001",
    "$1,000",
    "1,0",
    "--1",
  ]) {
    assert.equal(moneyCents(text), null, text);
  }
});
