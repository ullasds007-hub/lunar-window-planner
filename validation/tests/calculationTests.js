
const test = require("node:test");
const assert = require("node:assert");

const { validateCalculations } = require("../validators/calculationValidator");

test("Accept valid calculation data", () => {
    const calculations = {
        illumination: 75,
        moonAge: 10,
        distance: 384400,
        altitude: 45
    };

    const result = validateCalculations(calculations);

    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
});

test("Reject invalid illumination", () => {
    const result = validateCalculations({
        illumination: 150
    });

    assert.strictEqual(result.valid, false);
});

test("Reject invalid Moon age", () => {
    const result = validateCalculations({
        moonAge: 35
    });

    assert.strictEqual(result.valid, false);
});

test("Reject invalid Moon distance", () => {
    const result = validateCalculations({
        distance: -100
    });

    assert.strictEqual(result.valid, false);
});

test("Reject invalid altitude", () => {
    const result = validateCalculations({
        altitude: 100
    });

    assert.strictEqual(result.valid, false);
});

test("Reject non-numeric calculation values", () => {
    const result = validateCalculations({
        illumination: "high"
    });

    assert.strictEqual(result.valid, false);
});

test("Reject missing calculation object", () => {
    const result = validateCalculations(null);

    assert.strictEqual(result.valid, false);
});

test("Reject NaN calculation values", () => {
    const result = validateCalculations({
        illumination: NaN
    });

    assert.strictEqual(result.valid, false);
});

test("Reject infinite calculation values", () => {
    const result = validateCalculations({
        distance: Infinity
    });

    assert.strictEqual(result.valid, false);
});

test("Reject array as calculation data", () => {
    const result = validateCalculations([]);

    assert.strictEqual(result.valid, false);
});

