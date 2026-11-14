
const test = require("node:test");
const assert = require("node:assert");

const { validateWindow } = require("../validators/windowValidator");

test("Accept valid observation window", () => {
    const window = {
        goal: "moon_viewing",
        start: "2026-11-14T18:00:00Z",
        end: "2026-11-14T20:00:00Z",
        illumination: 75
    };

    const result = validateWindow(window);

    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
});

test("Reject invalid observation goal", () => {
    const result = validateWindow({
        goal: "photography",
        start: "2026-11-14T18:00:00Z",
        end: "2026-11-14T20:00:00Z"
    });

    assert.strictEqual(result.valid, false);
});

test("Reject invalid start time", () => {
    const result = validateWindow({
        goal: "moon_viewing",
        start: "invalid-date",
        end: "2026-11-14T20:00:00Z"
    });

    assert.strictEqual(result.valid, false);
});

test("Reject invalid end time", () => {
    const result = validateWindow({
        goal: "moon_viewing",
        start: "2026-11-14T18:00:00Z",
        end: "invalid-date"
    });

    assert.strictEqual(result.valid, false);
});

test("Reject end time before start time", () => {
    const result = validateWindow({
        goal: "stargazing",
        start: "2026-11-14T20:00:00Z",
        end: "2026-11-14T18:00:00Z"
    });

    assert.strictEqual(result.valid, false);
});

test("Reject invalid illumination", () => {
    const result = validateWindow({
        goal: "moon_viewing",
        start: "2026-11-14T18:00:00Z",
        end: "2026-11-14T20:00:00Z",
        illumination: 150
    });

    assert.strictEqual(result.valid, false);
});

test("Reject missing window data", () => {
    const result = validateWindow(null);

    assert.strictEqual(result.valid, false);
});

test("Reject empty start time", () => {
    const result = validateWindow({
        goal: "moon_viewing",
        start: "",
        end: "2026-11-14T20:00:00Z"
    });

    assert.strictEqual(result.valid, false);
});

test("Reject NaN illumination", () => {
    const result = validateWindow({
        goal: "moon_viewing",
        start: "2026-11-14T18:00:00Z",
        end: "2026-11-14T20:00:00Z",
        illumination: NaN
    });

    assert.strictEqual(result.valid, false);
});

test("Reject array as window data", () => {
    const result = validateWindow([]);

    assert.strictEqual(result.valid, false);
});

