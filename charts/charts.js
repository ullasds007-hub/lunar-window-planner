
"use strict";

// =====================================
// LUNAR WINDOW PLANNER - CHARTS MODULE
// =====================================

// Demo data only.
// Actual mission calculations will be
// connected through the Calculations Module.

const lunarChartData = {
    labels: [
        "Nov 15",
        "Nov 16",
        "Nov 17",
        "Nov 18",
        "Nov 19",
        "Nov 20"
    ],

    suitability: [55, 72, 91, 82, 65, 76],

    distance: [380000, 378000, 376000, 374000, 373000, 375000],

    duration: [5.2, 4.8, 4.3, 4.7, 5.1, 4.9],

    energy: [85, 72, 61, 68, 80, 75]
};

// Common chart configuration

const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,

    plugins: {
        legend: {
            labels: {
                color: "#dce6ff"
            }
        }
    },

    scales: {
        x: {
            ticks: {
                color: "#aab9d8"
            },
            grid: {
                color: "rgba(255,255,255,0.06)"
            }
        },

        y: {
            ticks: {
                color: "#aab9d8"
            },
            grid: {
                color: "rgba(255,255,255,0.08)"
            }
        }
    }
};

// Reusable chart creator

function createLunarChart(canvasId, type, label, values, color, unit) {

    const canvas = document.getElementById(canvasId);

    if (!canvas) {
        console.error("Canvas not found:", canvasId);
        return null;
    }

    return new Chart(canvas, {
        type: type,

        data: {
            labels: lunarChartData.labels,

            datasets: [{
                label: label,
                data: values,

                borderColor: color,
                backgroundColor: color + "33",

                borderWidth: 2,
                tension: 0.35,
                fill: type === "line",

                pointRadius: 4,
                pointHoverRadius: 7
            }]
        },

        options: {
            ...commonOptions,

            plugins: {
                ...commonOptions.plugins,

                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return label + ": " +
                                context.parsed.y + " " + unit;
                        }
                    }
                }
            },

            scales: {
                ...commonOptions.scales,

                y: {
                    ...commonOptions.scales.y,

                    beginAtZero: false,

                    ...(canvasId === "suitabilityChart"
                        ? { min: 0, max: 100 }
                        : {})
                }
            }
        }
    });
}

// =====================================
// CREATE FOUR CHARTS
// =====================================

function initializeLunarCharts() {

    if (typeof Chart === "undefined") {
        document.getElementById("data-status").textContent =
            "Chart library could not load. Check your internet connection.";
        return;
    }

    createLunarChart(
        "suitabilityChart",
        "line",
        "Suitability Score",
        lunarChartData.suitability,
        "#69a7ff",
        "%"
    );

    createLunarChart(
        "distanceChart",
        "line",
        "Earth-Moon Distance",
        lunarChartData.distance,
        "#b99cff",
        "km"
    );

    createLunarChart(
        "durationChart",
        "bar",
        "Mission Duration",
        lunarChartData.duration,
        "#54d6bc",
        "days"
    );

    createLunarChart(
        "energyChart",
        "bar",
        "Relative Energy Index",
        lunarChartData.energy,
        "#ffbb70",
        "index"
    );

    document.getElementById("data-status").textContent =
        "Demo data displayed. These are illustrative values, not actual lunar predictions.";
}

// Start charts after HTML loads

document.addEventListener("DOMContentLoaded", initializeLunarCharts);
