
function validateCalculations(calculations) {
    const errors = [];

    if (
        !calculations ||
        typeof calculations !== "object" ||
        Array.isArray(calculations)
    ) {
        return {
            valid: false,
            errors: ["Calculation data must be a valid object."]
        };
    }

    const numericFields = [
        "illumination",
        "moonAge",
        "distance",
        "altitude"
    ];

    numericFields.forEach(field => {
        if (calculations[field] !== undefined) {
            if (
                typeof calculations[field] !== "number" ||
                !Number.isFinite(calculations[field])
            ) {
                errors.push(field + " must be a finite number.");
            }
        }
    });

    if (
        calculations.illumination !== undefined &&
        (
            calculations.illumination < 0 ||
            calculations.illumination > 100
        )
    ) {
        errors.push("Illumination must be between 0 and 100.");
    }

    if (
        calculations.moonAge !== undefined &&
        (
            calculations.moonAge < 0 ||
            calculations.moonAge >= 29.53059
        )
    ) {
        errors.push("Moon age is outside the valid lunar cycle.");
    }

    if (
        calculations.distance !== undefined &&
        calculations.distance <= 0
    ) {
        errors.push("Moon distance must be greater than zero.");
    }

    if (
        calculations.altitude !== undefined &&
        (
            calculations.altitude < -90 ||
            calculations.altitude > 90
        )
    ) {
        errors.push("Altitude must be between -90 and 90 degrees.");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = { validateCalculations };
