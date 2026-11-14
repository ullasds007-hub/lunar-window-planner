
function validateWindow(window) {
    const errors = [];

    if (
        !window ||
        typeof window !== "object" ||
        Array.isArray(window)
    ) {
        return {
            valid: false,
            errors: ["Window data must be a valid object."]
        };
    }

    const allowedGoals = [
        "moon_viewing",
        "stargazing",
        "milky_way"
    ];

    if (!allowedGoals.includes(window.goal)) {
        errors.push("Invalid observation goal.");
    }

    // Validate start time
    const start = new Date(window.start);
    const validStart =
        typeof window.start === "string" &&
        window.start.trim() !== "" &&
        Number.isFinite(start.getTime());

    if (!validStart) {
        errors.push("Invalid window start time.");
    }

    // Validate end time
    const end = new Date(window.end);
    const validEnd =
        typeof window.end === "string" &&
        window.end.trim() !== "" &&
        Number.isFinite(end.getTime());

    if (!validEnd) {
        errors.push("Invalid window end time.");
    }

    // Check chronological order
    if (
        validStart &&
        validEnd &&
        end <= start
    ) {
        errors.push("Window end must be after window start.");
    }

    // Validate illumination
    if (
        window.illumination !== undefined &&
        (
            typeof window.illumination !== "number" ||
            !Number.isFinite(window.illumination) ||
            window.illumination < 0 ||
            window.illumination > 100
        )
    ) {
        errors.push("Window illumination must be between 0 and 100.");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = { validateWindow };
