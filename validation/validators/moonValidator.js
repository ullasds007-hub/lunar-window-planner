
function validateMoonData(moon) {
    const errors = [];

    if (!moon || typeof moon !== "object" || Array.isArray(moon)) {
        return {
            valid: false,
            errors: ["Moon data must be a valid object."]
        };
    }

    if (
        typeof moon.illumination !== "number" ||
        !Number.isFinite(moon.illumination) ||
        moon.illumination < 0 ||
        moon.illumination > 100
    ) {
        errors.push("Moon illumination must be a finite number between 0 and 100.");
    }

    const allowedPhases = [
        "New Moon",
        "Waxing Crescent",
        "First Quarter",
        "Waxing Gibbous",
        "Full Moon",
        "Waning Gibbous",
        "Last Quarter",
        "Waning Crescent"
    ];

    if (!allowedPhases.includes(moon.phase)) {
        errors.push("Invalid Moon phase.");
    }

    if (
        moon.age !== undefined &&
        (
            typeof moon.age !== "number" ||
            !Number.isFinite(moon.age) ||
            moon.age < 0 ||
            moon.age >= 29.53059
        )
    ) {
        errors.push("Moon age must be between 0 and one synodic month.");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = { validateMoonData };
