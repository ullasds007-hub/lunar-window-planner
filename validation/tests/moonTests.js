const test = require("node:test");
const assert = require("node:assert");

const { validateMoonData } = require("../validators/moonValidator");

test("Accept valid Moon data", () => {
    const moon = {
        illumination: 75,
        phase: "Waxing Gibbous",
        age: 10
    };

    const result = validateMoonData(moon);

    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
});

test("Reject invalid Moon illumination", () => {
    const moon = {
        illumination: 150,
        phase: "Full Moon",
        age: 14
    };

    const result = validateMoonData(moon);

    assert.strictEqual(result.valid, false);
});

test("Reject invalid Moon phase", () => {
    const moon = {
        illumination: 50,
        phase: "Unknown Phase",
        age: 10
    };

    const result = validateMoonData(moon);

    assert.strictEqual(result.valid, false);
});

test("Reject invalid Moon age", () => {
    const moon = {
        illumination: 50,
        phase: "Full Moon",
        age: 35
    };

    const result = validateMoonData(moon);

    assert.strictEqual(result.valid, false);
});

test("Reject missing Moon data", () => {
    const result = validateMoonData(null);

    assert.strictEqual(result.valid, false);
});

test("Reject NaN Moon illumination", () => {
    const result = validateMoonData({
        illumination: NaN,
        phase: "Full Moon",
        age: 14
    });

    assert.strictEqual(result.valid, false);
});

test("Reject infinite Moon illumination", () => {
    const result = validateMoonData({
        illumination: Infinity,
        phase: "Full Moon",
        age: 14
    });

    assert.strictEqual(result.valid, false);
});

test("Reject negative Moon age", () => {
    const result = validateMoonData({
        illumination: 50,
        phase: "Full Moon",
        age: -1
    });

    assert.strictEqual(result.valid, false);
});
