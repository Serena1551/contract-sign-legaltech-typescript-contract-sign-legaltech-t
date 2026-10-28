import { strict as assert } from "node:assert";
import { needsDeadlineFollowUp } from "./contract-sign-service.ts";

const now = new Date("2026-10-28T00:00:00.000Z");
assert.equal(needsDeadlineFollowUp("2026-10-29T12:00:00.000Z", false, now), true);
assert.equal(needsDeadlineFollowUp("2026-11-05T12:00:00.000Z", false, now), false);
assert.equal(needsDeadlineFollowUp("2026-10-29T12:00:00.000Z", true, now), false);
console.log("deadline follow-up decision passed");
