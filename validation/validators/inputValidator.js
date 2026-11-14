
function validateInput(data) {
    const errors = [];

    if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data)
    ) {
        return {
            valid: false,
            errors: ["Input data must be a valid object."]
        };
    }

    // Validate observation date
    if (!data.date) {
        errors.push("Observation date is required.");
    } else {
        const date = new Date(data.date);

        if (
            typeof data.date !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
            isNaN(date.getTime()) ||
            date.toISOString().slice(0, 10) !== data.date
        ) {
            errors.push("Invalid observation date. Use YYYY-MM-DD format.");
        }
    }

    // Validate location
    if (
        !data.location ||
        typeof data.location !== "object" ||
        Array.isArray(data.location)
    ) {
        errors.push("Valid location data is required.");
    } else {
        const { latitude, longitude } = data.location;

        if (
            typeof latitude !== "number" ||
            !Number.isFinite(latitude) ||
            latitude < -90 ||
            latitude > 90
        ) {
            errors.push("Latitude must be between -90 and 90.");
        }

        if (
            typeof longitude !== "number" ||
            !Number.isFinite(longitude) ||
            longitude < -180 ||
            longitude > 180
        ) {
            errors.push("Longitude must be between -180 and 180.");
        }
    }

    // Validate observation goal
    const allowedGoals = [
        "moon_viewing",
        "stargazing",
        "milky_way"
    ];

    if (!allowedGoals.includes(data.goal)) {
        errors.push("Invalid observation goal.");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = { validateInput };
