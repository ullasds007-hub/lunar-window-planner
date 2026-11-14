
const { validateInput } = require("./validators/inputValidator");
const { validateMoonData } = require("./validators/moonValidator");
const { validateCalculations } = require("./validators/calculationValidator");
const { validateWindow } = require("./validators/windowValidator");

function runValidation(data) {
    const results = [];

    results.push({
        module: "Input Validation",
        ...validateInput(data)
    });

    if (data && data.moon) {
        results.push({
            module: "Moon Data Validation",
            ...validateMoonData(data.moon)
        });
    }

    if (data && data.calculations) {
        results.push({
            module: "Calculation Validation",
            ...validateCalculations(data.calculations)
        });
    }

    if (data && data.window) {
        results.push({
            module: "Window Validation",
            ...validateWindow(data.window)
        });
    }

    const passed = results.filter(result => result.valid).length;
    const failed = results.length - passed;

    return {
        project: "Lunar Window Planner",
        totalChecks: results.length,
        passed,
        failed,
        status: failed === 0 ? "PASSED" : "FAILED",
        results
    };
}

module.exports = { runValidation };
