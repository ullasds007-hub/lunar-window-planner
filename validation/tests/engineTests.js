
const test = require("node:test");
const assert = require("node:assert");

const { runValidation } = require("../validationEngine");

// Test 1: Accept valid complete data
test("Validation engine accepts valid complete data", () => {
    const data = {
        date: "2026-11-20",
        location: {
            latitude: 13,
            longitude: 75.5
        },
        goal: "moon_viewing",

        moon: {
            illumination: 75,
            phase: "Waxing Gibbous",
            age: 10
        },

        calculations: {
            illumination: 75,
            moonAge: 10,
            distance: 384400,
            altitude: 45
        },

        window: {
            goal: "moon_viewing",
            start: "2026-11-20T18:00:00Z",
            end: "2026-11-20T20:00:00Z",
            illumination: 75
        }
    };

    const result = runValidation(data);

    assert.strictEqual(result.status, "PASSED");
    assert.strictEqual(result.failed, 0);
});

// Test 2: Reject invalid input
test("Validation engine rejects invalid input", () => {
    const data = {
        date: "invalid-date",
        location: {
            latitude: 100,
            longitude: 200
        },
        goal: "unknown"
    };

    const result = runValidation(data);

    assert.strictEqual(result.status, "FAILED");
    assert.ok(result.failed > 0);
});

// Test 3: Generate validation report
test("Validation engine returns a report", () => {
    const data = {
        date: "2026-11-20",
        location: {
            latitude: 13,
            longitude: 75.5
        },
        goal: "stargazing"
    };

    const result = runValidation(data);

    assert.strictEqual(
        result.project,
        "Lunar Window Planner"
    );

    assert.ok(Array.isArray(result.results));
    assert.ok(result.totalChecks > 0);
});
