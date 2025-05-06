// static/js/charts-enhanced.js
// Version 2.0.0 - Removed local fixThemesInTables, relies on global enhanceThemeBadgesGlobally

document.addEventListener('DOMContentLoaded', function() {
    const config = window.dashboardConfig || { debugMode: false };
    if (config.debugMode) console.log('Enhanced Charts (v2.0.0): Initialisation...');

    let themeChartInstance = null;
    let serviceChartInstance = null;

    const chartColors = {
        primary: '#0d6efd', success: '#198754', warning: '#ffc107', danger: '#dc3545',
        info: '#0dcaf0', secondary: '#6c757d',
        teams: 'var(--theme-teams, #0078d4)', planner: 'var(--theme-planner, #7719aa)',
        onedrive: 'var(--theme-onedrive, #0364b8)', sharepoint: 'var(--theme-sharepoint, #038387)'
    };

    function getResolvedColor(colorNameOrVar) {
        if (colorNameOrVar.startsWith('var(')) {
            const varName = colorNameOrVar.match(/--[a-zA-Z0-9-]+/);
            if (varName) {
                const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName[0]);
                return resolved ? resolved.trim() : '#6c757d'; // Fallback if var not found
            }
        }
        return chartColors[colorNameOrVar] || colorNameOrVar; // Return direct color or original if not in map
    }

    function createOrUpdateThemeChart(data) {
        const canvasElement = document.getElementById('themeChartCanvas');
        if (!canvasElement) {
            if (config.debugMode) console.warn('Enhanced Charts: Canvas #themeChartCanvas not found.');
            return;
        }
        const ctx = canvasElement.getContext('2d');
        if (!ctx) return;

        const labels = data.map(item => item.label);
        const values = data.map(item => item.value);
        const backgroundColors = data.map(item => getResolvedColor(item.color || chartColors.secondary));

        if (themeChartInstance) {
            themeChartInstance.data.labels = labels;
            themeChartInstance.data.datasets[0].data = values;
            themeChartInstance.data.datasets[0].backgroundColor = backgroundColors;
            themeChartInstance.update();
            if (config.debugMode) console.log('Enhanced Charts: Theme chart updated.');
        } else {
            themeChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Inscriptions par Thème',
                        data: values,
                        backgroundColor: backgroundColors,
                        borderColor: '#fff', borderWidth: 2, hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, cutout: '65%',
                    animation: { animateScale: true, animateRotate: true },
                    plugins: {
                        legend: { position: 'bottom', labels: { padding: 15, usePointStyle: true, font: { size: 11 } } },
                        tooltip: {
                            backgroundColor: 'rgba(0,0,0,0.8)', titleFont: { weight: 'bold' }, bodyFont: { size: 12 },
                            callbacks: {
                                label: ctx => `${ctx.label || ''}: ${ctx.parsed || 0} (${((ctx.parsed / values.reduce((a,b)=>a+b,0)) * 100).toFixed(1)}%)`
                            }
                        },
                        datalabels: { // Requires chartjs-plugin-datalabels
                            formatter: (value, ctx) => {
                                let sum = 0;
                                let dataArr = ctx.chart.data.datasets[0].data;
                                dataArr.map(data => { sum += data; });
                                let percentage = (value*100 / sum).toFixed(1)+"%";
                                return value > 0 ? percentage : ''; // Show percentage if value > 0
                            },
                            color: '#fff',
                            font: { weight: 'bold', size: '10' },
                            textShadowBlur: 2,
                            textShadowColor: 'rgba(0,0,0,0.5)'
                        }
                    }
                },
                // plugins: [ChartDataLabels] // Uncomment if using chartjs-plugin-datalabels
            });
            if (config.debugMode) console.log('Enhanced Charts: Theme chart created.');
        }
    }

    function createOrUpdateServiceChart(data) {
        const canvasElement = document.getElementById('serviceChartCanvas');
         if (!canvasElement) {
            if (config.debugMode) console.warn('Enhanced Charts: Canvas #serviceChartCanvas not found.');
            return;
        }
        const ctx = canvasElement.getContext('2d');
        if (!ctx) return;

        data.sort((a, b) => (b.value || 0) - (a.value || 0));
        const labels = data.map(item => item.label);
        const values = data.map(item => item.value);
        const backgroundColors = data.map(item => getResolvedColor(item.color || chartColors.secondary));

        if (serviceChartInstance) {
            serviceChartInstance.data.labels = labels;
            serviceChartInstance.data.datasets[0].data = values;
            serviceChartInstance.data.datasets[0].backgroundColor = backgroundColors;
            serviceChartInstance.data.datasets[0].borderColor = backgroundColors;
            serviceChartInstance.update();
            if (config.debugMode) console.log('Enhanced Charts: Service chart updated.');
        } else {
            serviceChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Participants par Service',
                        data: values,
                        backgroundColor: backgroundColors,
                        borderColor: backgroundColors, borderWidth: 1,
                        borderRadius: 4, barPercentage: 0.7, categoryPercentage: 0.8
                    }]
                },
                options: {
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                    scales: {
                        x: { beginAtZero: true, ticks: { precision: 0, font: {size: 10} }, grid: { display: false } },
                        y: { ticks: { font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)'} }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(0,0,0,0.8)', titleFont: { weight: 'bold' }, bodyFont: { size: 12 },
                            callbacks: { label: ctx => ` ${ctx.label || ''}: ${ctx.parsed.x || 0}` }
                        },
                        datalabels: { // Requires chartjs-plugin-datalabels
                            anchor: 'end',
                            align: 'end',
                            color: '#333',
                            font: { weight: 'normal', size: 9 },
                            formatter: (value) => value > 0 ? value : ''
                        }
                    }
                },
                // plugins: [ChartDataLabels] // Uncomment if using chartjs-plugin-datalabels
            });
            if (config.debugMode) console.log('Enhanced Charts: Service chart created.');
        }
    }

    function applyAllEnhancements(dashboardData) {
        if (!dashboardData) {
            if (config.debugMode) console.warn('Enhanced Charts: No dashboard data provided for enhancements.');
            return;
        }
        if (config.debugMode) console.log('Enhanced Charts: Applying enhancements with data:', dashboardData);

        const themeChartData = dashboardData.themeCounts 
            ? Object.entries(dashboardData.themeCounts).map(([label, data]) => ({ label, value: data.value, color: data.color || chartColors[label.toLowerCase().replace(/\s+/g, '')] }))
            : [];
            
        const serviceChartData = dashboardData.serviceCounts 
            ? Object.entries(dashboardData.serviceCounts).map(([label, data]) => ({ label, value: data.value, color: data.color || chartColors[label.toLowerCase().replace(/\s+/g, '')] }))
            : [];

        if (document.getElementById('themeChartCanvas')) createOrUpdateThemeChart(themeChartData);
        if (document.getElementById('serviceChartCanvas')) createOrUpdateServiceChart(serviceChartData);

        // Call the global badge enhancer from layout.html
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
             if (config.debugMode) console.log("Enhanced Charts: Calling global enhanceThemeBadgesGlobally.");
            window.enhanceThemeBadgesGlobally();
        } else {
             if (config.debugMode) console.warn('Enhanced Charts: window.enhanceThemeBadgesGlobally not found.');
        }
    }

    document.addEventListener('dashboardDataRefreshed', function(event) {
        if (event.detail && event.detail.data) {
            if (config.debugMode) console.log('Enhanced Charts: Received dashboardDataRefreshed event.');
            applyAllEnhancements(event.detail.data);
        }
    });

    if (window.dashboardData) { // Initial load if data is embedded
        if (config.debugMode) console.log('Enhanced Charts: Initializing with pre-loaded window.dashboardData.');
        applyAllEnhancements(window.dashboardData);
    } else {
         if (config.debugMode) console.log('Enhanced Charts: Waiting for dashboardDataRefreshed event or direct call.');
    }

    window.applyChartEnhancements = applyAllEnhancements; // Expose for polling script
    if (config.debugMode) console.log("Enhanced Charts (v2.0.0): Initialization complete.");
});