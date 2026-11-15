
"use strict";

// LUNAR WINDOW PLANNER - DATA INTEGRATION

// Expected input:
// {
//   launchWindows: [
//     {
//       date: "2026-11-20",
//       suitabilityScore: 85,
//       earthMoonDistanceKm: 384000,
//       missionDurationDays: 4.5,
//       energyIndex: 72
//     }
//   ]
// }

window.updateLunarCharts = function (data) {
    const status = document.getElementById("data-status");

    try {
        if (!data || !Array.isArray(data.launchWindows) ||
            data.launchWindows.length === 0) {
            throw new Error("No launch window data received.");
        }

        const rows = data.launchWindows;

        const fields = [
            "suitabilityScore",
            "earthMoonDistanceKm",
            "missionDurationDays",
            "energyIndex"
        ];

        rows.forEach(row => {
            if (!row || typeof row.date !== "string" ||
                Number.isNaN(Date.parse(row.date))) {
                throw new Error("Invalid date in launch window data.");
            }

            fields.forEach(field => {
                if (typeof row[field] !== "number" ||
                    !Number.isFinite(row[field])) {
                    throw new Error("Invalid value: " + field);
                }
            });

            if (row.suitabilityScore < 0 ||
                row.suitabilityScore > 100 ||
                row.earthMoonDistanceKm <= 0 ||
                row.missionDurationDays <= 0 ||
                row.energyIndex < 0) {
                throw new Error("A value is outside its allowed range.");
            }
        });

        const labels = rows.map(row => row.date);

        const updates = [
            ["suitabilityChart", "suitabilityScore"],
            ["distanceChart", "earthMoonDistanceKm"],
            ["durationChart", "missionDurationDays"],
            ["energyChart", "energyIndex"]
        ];

        updates.forEach(([chartId, field]) => {
            const chart = Chart.getChart(chartId);

            if (!chart) {
                throw new Error("Chart not found: " + chartId);
            }

            chart.data.labels = labels;
            chart.data.datasets[0].data =
                rows.map(row => row[field]);

            chart.update();
        });

        status.textContent =
            "Calculation data successfully received and displayed.";

        return true;

    } catch (error) {
        console.error("Integration error:", error);
        status.textContent = "Integration error: " + error.message;
        return false;
    }
};
