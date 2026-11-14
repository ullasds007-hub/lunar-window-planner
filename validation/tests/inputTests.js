
const test = require("node:test");
const assert = require("node:assert");

const { validateInput } = require("../validators/inputValidator");

test("Accept valid observation input", () => {
    const data = {
        date: "2026-11-20",
        location: {
            latitude: 13.0,
            longitude: 75.5
        },
        goal: "moon_viewing"
    };

    const result = validateInput(data);

    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
});

test("Reject invalid latitude", () => {
    const data = {
        date: "2026-11-20",
        location: {
            latitude: 100,
            longitude: 75.5
        },
        goal: "moon_viewing"
    };

    const result = validateInput(data);

    assert.strictEqual(result.valid, false);
});

test("Reject invalid longitude", () => {
    const data = {
        date: "2026-11-20",
        location: {
            latitude: 13,
            longitude: 200
        },
        goal: "stargazing"
    };

    const result = validateInput(data);

    assert.strictEqual(result.valid, false);
});

test("Reject unsupported observation goal", () => {
    const data = {
        date: "2026-11-20",
        location: {
            latitude: 13,
            longitude: 75.5
        },
        goal: "photography"
    };

    const result = validateInput(data);

    assert.strictEqual(result.valid, false);
});

test("Reject missing observation date", () => {
    const data = {
        location: {
            latitude: 13,
            longitude: 75.5
        },
        goal: "moon_viewing"
    };

    const result = validateInput(data);

    assert.strictEqual(result.valid, false);
});

test("Reject impossible observation date", () => {
    const result = validateInput({
        date: "2026-02-30",
        location: {
            latitude: 13,
            longitude: 75.5
        },
        goal: "moon_viewing"
    });

    assert.strictEqual(result.valid, false);
});

test("Reject NaN latitude", () => {
    const result = validateInput({
        date: "2026-11-20",
        location: {
            latitude: NaN,
            longitude: 75.5
        },
        goal: "moon_viewing"
    });

    assert.strictEqual(result.valid, false);
});

test("Reject infinite longitude", () => {
    const result = validateInput({
        date: "2026-11-20",
        location: {
            latitude: 13,
            longitude: Infinity
        },
        goal: "moon_viewing"
    });

    assert.strictEqual(result.valid, false);
});

test("Reject array as input data", () => {
    const result = validateInput([]);

    assert.strictEqual(result.valid, false);
});
