console.log("--- charts-enhanced.js EXECUTING ---");
document.addEventListener('DOMContentLoaded', function() {
    const DASH_CONFIG = window.dashboardConfig || { debugMode: false };
    if (DASH_CONFIG.debugMode) console.log('Enhanced Charts (v2.1.1): Initializing...');

    if (typeof Chart === 'undefined') {
        console.error('Enhanced Charts: Chart.js library is not loaded. Charts will not render.');
        // Provide stubs for chartModule if Chart.js is missing, so dashboard-init doesn't break.
        window.chartModule = window.chartModule || {
            initialize: () => Promise.resolve({ success: false, message: "Chart.js missing" }),
            updateThemeChart: () => {},
            updateServiceChart: () => {}
        };
        return;
    }

    let themeChartInstance = null;
    let serviceChartInstance = null;

    // Global theme/service data with colors (can be expanded from Flask if needed)
    // Ensure these are consistent with layout.html or ui-fixers.js if colors are defined there.
    window.themesDataForChart = window.themesDataForChart || {
        'Communiquer avec Teams': { color: 'var(--theme-teams, #0078d4)', description: 'Communication via Teams' },
        'Gérer les tâches (Planner)': { color: 'var(--theme-planner, #7719aa)', description: 'Gestion des tâches avec Planner' },
        'Gérer mes fichiers (OneDrive/SharePoint)': { color: 'var(--theme-onedrive, #0364b8)', description: 'Gestion de fichiers OneDrive/SharePoint' },
        'Collaborer avec Teams': { color: 'var(--theme-sharepoint, #038387)', description: 'Collaboration documentaire via Teams' },
    };

    window.servicesDataForChart = window.servicesDataForChart || {
        'Commerce Anecoop-Solagora': { color: 'var(--service-commerce, #FFC107)' },
        'Comptabilité': { color: 'var(--service-comptabilite, #2196F3)' },
        'Florensud': { color: 'var(--service-florensud, #4CAF50)' },
        'Informatique': { color: 'var(--service-informatique, #607D8B)' },
        'Marketing': { color: 'var(--service-marketing, #9C27B0)' },
        'Qualité': { color: 'var(--service-qualite, #F44336)' },
        'RH': { color: 'var(--service-rh, #FF9800)' },
    };

    function getResolvedColor(colorNameOrVar, defaultColor = '#a0aec0') { // Default to a neutral gray
        if (typeof colorNameOrVar === 'string' && colorNameOrVar.startsWith('var(')) {
            const varNameMatch = colorNameOrVar.match(/--([a-zA-Z0-9-]+)/);
            if (varNameMatch && varNameMatch[0]) {
                const resolved = getComputedStyle(document.documentElement).getPropertyValue(varNameMatch[0].trim());
                return resolved ? resolved.trim() : defaultColor;
            }
        }
        return colorNameOrVar || defaultColor;
    }

    const commonChartOptions = {
        responsive: true,
        maintainAspectRatio: false, // Allows chart to fill container height/width based on CSS
        plugins: {
            legend: {
                position: 'bottom',
                labels: {
                    padding: 15,
                    boxWidth: 12,
                    font: { size: 11 }
                }
            },
            tooltip: {
                backgroundColor: 'rgba(0,0,0,0.7)',
                titleFont: { size: 13 },
                bodyFont: { size: 12 },
                padding: 10,
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed.y !== null && context.chart.config.type === 'bar') {
                            label += context.parsed.y;
                        }
                        if (context.parsed !== null && context.chart.config.type === 'doughnut') {
                             label += context.parsed;
                        }
                        return label;
                    }
                }
            }
        }
    };

    function createOrUpdateThemeChart(sessionsArray) {
        const canvasElement = document.getElementById('themeChartCanvas');
        if (!canvasElement) {
            if (DASH_CONFIG.debugMode) console.warn('Enhanced Charts: Canvas #themeChartCanvas not found.');
            return;
        }
        const ctx = canvasElement.getContext('2d');
        if (!ctx) {
            console.error('Enhanced Charts: Failed to get 2D context for #themeChartCanvas.');
            return;
        }

        const themeCounts = {};
        if (sessionsArray && Array.isArray(sessionsArray)) {
            sessionsArray.forEach(session => {
                if (session.theme && typeof session.inscrits === 'number') { // Ensure 'inscrits' is a number
                    themeCounts[session.theme] = (themeCounts[session.theme] || 0) + session.inscrits;
                }
            });
        } else {
             if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: No session data for theme chart.');
        }

        const chartData = Object.entries(themeCounts).map(([label, value]) => ({
            label,
            value,
            color: getResolvedColor(window.themesDataForChart[label]?.color, '#CCCCCC') // Fallback color
        }));

        const labels = chartData.map(item => item.label);
        const values = chartData.map(item => item.value);
        const backgroundColors = chartData.map(item => item.color);
        const totalInscrits = values.reduce((a, b) => a + b, 0);

        const donutTotalEl = document.getElementById('chart-theme-total');
        if (donutTotalEl) donutTotalEl.textContent = totalInscrits.toLocaleString();

        if (themeChartInstance) {
            themeChartInstance.data.labels = labels;
            themeChartInstance.data.datasets[0].data = values;
            themeChartInstance.data.datasets[0].backgroundColor = backgroundColors;
            themeChartInstance.update();
            if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Theme chart updated.');
        } else {
            themeChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Inscriptions par Thème',
                        data: values,
                        backgroundColor: backgroundColors,
                        borderColor: '#fff', // White border for segments
                        borderWidth: 2,
                        hoverOffset: 8
                    }]
                },
                options: {
                    ...commonChartOptions,
                    cutout: '65%', // Adjust for thicker or thinner doughnut
                    plugins: {
                        ...commonChartOptions.plugins,
                        legend: { ...commonChartOptions.plugins.legend, display: labels.length > 0 && labels.length < 10 }, // Hide legend if too many items
                    }
                }
            });
            if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Theme chart created.');
        }
    }

    function createOrUpdateServiceChart(participantsArray) {
        const canvasElement = document.getElementById('serviceChartCanvas');
        if (!canvasElement) {
            if (DASH_CONFIG.debugMode) console.warn('Enhanced Charts: Canvas #serviceChartCanvas not found.');
            return;
        }
        const ctx = canvasElement.getContext('2d');
        if (!ctx) {
             console.error('Enhanced Charts: Failed to get 2D context for #serviceChartCanvas.');
            return;
        }

        const serviceCounts = {};
        if (participantsArray && Array.isArray(participantsArray)) {
            participantsArray.forEach(participant => {
                if (participant.service) { // API returns service name
                    serviceCounts[participant.service] = (serviceCounts[participant.service] || 0) + 1;
                }
            });
        } else {
            if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: No participant data for service chart.');
        }

        let chartData = Object.entries(serviceCounts).map(([label, value]) => ({
            label,
            value,
            color: getResolvedColor(window.servicesDataForChart[label]?.color, '#CCCCCC')
        }));

        chartData.sort((a, b) => b.value - a.value); // Sort by value descending

        const labels = chartData.map(item => item.label);
        const values = chartData.map(item => item.value);
        const backgroundColors = chartData.map(item => item.color);

        if (serviceChartInstance) {
            serviceChartInstance.data.labels = labels;
            serviceChartInstance.data.datasets[0].data = values;
            serviceChartInstance.data.datasets[0].backgroundColor = backgroundColors;
            serviceChartInstance.data.datasets[0].borderColor = backgroundColors; // For bar charts, often same as bg
            serviceChartInstance.update();
            if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Service chart updated.');
        } else {
            serviceChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Participants par Service',
                        data: values,
                        backgroundColor: backgroundColors,
                        borderColor: backgroundColors,
                        borderWidth: 1,
                        borderRadius: 4, // Rounded bars
                        barPercentage: 0.7, // How much of the available width each bar takes
                        categoryPercentage: 0.8 // How much of the category width the group of bars takes
                    }]
                },
                options: {
                    ...commonChartOptions,
                    indexAxis: 'y', // Horizontal bar chart if many services
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: {
                                precision: 0 // No decimal points for participant counts
                            }
                        },
                        y: {
                            ticks: {
                                font: { size: 10 } // Smaller font for y-axis labels if many
                            }
                        }
                    },
                    plugins: {
                        ...commonChartOptions.plugins,
                        legend: { display: false }, // Legend often not needed for single dataset bar charts
                    }
                }
            });
            if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Service chart created.');
        }
    }

    function initializeCharts(payload) {
        if (!payload) {
            if (DASH_CONFIG.debugMode) console.warn('Enhanced Charts: No data payload provided for initialization.');
            // Attempt to create empty charts or show placeholder
            createOrUpdateThemeChart([]);
            createOrUpdateServiceChart([]);
            return Promise.resolve({ success: false, message: "No initial data for charts." });
        }
        if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Initializing/Updating charts with payload:', payload);

        if (payload.sessions) createOrUpdateThemeChart(payload.sessions);
        else createOrUpdateThemeChart([]); // Create empty chart if no session data

        if (payload.participants) createOrUpdateServiceChart(payload.participants);
        else createOrUpdateServiceChart([]); // Create empty chart if no participant data

        // Call global theme badge enhancer (from layout.html) if it exists
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally();
        }
        return Promise.resolve({ success: true, message: "Charts initialized/updated." });
    }

    // Listen for data refresh events from polling-updates.js
    document.addEventListener('dashboardDataRefreshed', function(event) {
        if (event.detail && event.detail.data) {
            if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: Received dashboardDataRefreshed event.');
            initializeCharts(event.detail.data); // Pass the full payload
        } else if (DASH_CONFIG.debugMode) {
            console.warn('Enhanced Charts: dashboardDataRefreshed event received without data.');
        }
    });

    // Expose an initialization function for dashboard-init.js
    window.chartModule = {
        initialize: function() {
            // This will be called by dashboard-init.js.
            // Actual chart rendering will happen when 'dashboardDataRefreshed' is fired.
            // Or, if initial data is available via a global var (less common with polling),
            // we could try to render here.
            if (DASH_CONFIG.debugMode) console.log('Enhanced Charts: chartModule.initialize() called. Waiting for data event or initial data.');
            // Create empty charts initially to set up the canvas elements.
            if (!themeChartInstance) createOrUpdateThemeChart([]);
            if (!serviceChartInstance) createOrUpdateServiceChart([]);
            return Promise.resolve({ success: true, message: "Chart module ready, awaiting data." });
        }
        // Individual update functions are not strictly needed if 'dashboardDataRefreshed' handles all.
    };

    if (DASH_CONFIG.debugMode) console.log("Enhanced Charts (v2.1.1): Setup complete.");
});
