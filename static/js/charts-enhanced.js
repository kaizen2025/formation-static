// static/js/charts-enhanced.js
// Version 2.1.0 - Traite les données brutes de l'API (tableaux)

document.addEventListener('DOMContentLoaded', function() {
    const config = window.dashboardConfig || { debugMode: false };
    if (config.debugMode) console.log('Enhanced Charts (v2.1.0): Initialisation...');

    let themeChartInstance = null;
    let serviceChartInstance = null;

    // Définir les couleurs des thèmes et services globalement pour y accéder depuis polling-updates.js
    window.themesDataForChart = { // Renommé pour éviter conflit avec themesData de layout.html
        'Communiquer avec Teams': { color: 'var(--theme-teams, #0078d4)', description: '...' },
        'Gérer les tâches (Planner)': { color: 'var(--theme-planner, #7719aa)', description: '...' },
        'Gérer mes fichiers (OneDrive/SharePoint)': { color: 'var(--theme-onedrive, #0364b8)', description: '...' },
        'Collaborer avec Teams': { color: 'var(--theme-sharepoint, #038387)', description: '...' },
        // Ajoutez d'autres thèmes si nécessaire
    };

    window.servicesDataForChart = { // Renommé
        'Commerce Anecoop-Solagora': { color: 'var(--service-commerce, #FFC107)', description: '...' },
        'Comptabilité': { color: 'var(--service-comptabilite, #2196F3)', description: '...' },
        'Florensud': { color: 'var(--service-florensud, #4CAF50)', description: '...' },
        'Informatique': { color: 'var(--service-informatique, #607D8B)', description: '...' },
        'Marketing': { color: 'var(--service-marketing, #9C27B0)', description: '...' },
        'Qualité': { color: 'var(--service-qualite, #F44336)', description: '...' },
        'RH': { color: 'var(--service-rh, #FF9800)', description: '...' },
        // Ajoutez d'autres services si nécessaire
    };
    
    function getResolvedColor(colorNameOrVar, defaultColor = '#6c757d') {
        if (typeof colorNameOrVar === 'string' && colorNameOrVar.startsWith('var(')) {
            const varName = colorNameOrVar.match(/--[a-zA-Z0-9-]+/);
            if (varName) {
                const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName[0]);
                return resolved ? resolved.trim() : defaultColor;
            }
        }
        return colorNameOrVar || defaultColor;
    }

    function createOrUpdateThemeChart(sessionsArray) { // Attend un tableau de sessions
        const canvasElement = document.getElementById('themeChartCanvas');
        if (!canvasElement) {
            if (config.debugMode) console.warn('Enhanced Charts: Canvas #themeChartCanvas not found. Assurez-vous que votre HTML contient <canvas id="themeChartCanvas">.</canvas>');
            return;
        }
        const ctx = canvasElement.getContext('2d');
        if (!ctx) return;

        const themeCounts = {};
        if (sessionsArray && Array.isArray(sessionsArray)) {
            sessionsArray.forEach(session => {
                if (session.theme) {
                    themeCounts[session.theme] = (themeCounts[session.theme] || 0) + (session.inscrits || 0);
                }
            });
        }

        const chartData = Object.entries(themeCounts).map(([label, value]) => ({
            label,
            value,
            color: window.themesDataForChart[label] ? getResolvedColor(window.themesDataForChart[label].color) : getResolvedColor(null)
        }));

        const labels = chartData.map(item => item.label);
        const values = chartData.map(item => item.value);
        const backgroundColors = chartData.map(item => item.color);
        const totalInscrits = values.reduce((a, b) => a + b, 0);

        // Mettre à jour le total dans le HTML si l'élément existe (pour le centre du donut statique)
        const donutTotalEl = document.getElementById('chart-theme-total');
        if (donutTotalEl) donutTotalEl.textContent = totalInscrits;


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
                options: { /* ... vos options Chart.js ... */ }
            });
            if (config.debugMode) console.log('Enhanced Charts: Theme chart created.');
        }
    }

    function createOrUpdateServiceChart(participantsArray) { // Attend un tableau de participants
        const canvasElement = document.getElementById('serviceChartCanvas');
         if (!canvasElement) {
            if (config.debugMode) console.warn('Enhanced Charts: Canvas #serviceChartCanvas not found. Assurez-vous que votre HTML contient <canvas id="serviceChartCanvas">.</canvas>');
            return;
        }
        const ctx = canvasElement.getContext('2d');
        if (!ctx) return;

        const serviceCounts = {};
        if (participantsArray && Array.isArray(participantsArray)) {
            participantsArray.forEach(participant => {
                if (participant.service) {
                    serviceCounts[participant.service] = (serviceCounts[participant.service] || 0) + 1;
                }
            });
        }
        
        let chartData = Object.entries(serviceCounts).map(([label, value]) => ({
            label,
            value,
            color: window.servicesDataForChart[label] ? getResolvedColor(window.servicesDataForChart[label].color) : getResolvedColor(null)
        }));

        chartData.sort((a, b) => b.value - a.value); // Trier

        const labels = chartData.map(item => item.label);
        const values = chartData.map(item => item.value);
        const backgroundColors = chartData.map(item => item.color);

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
                options: { /* ... vos options Chart.js ... */ }
            });
            if (config.debugMode) console.log('Enhanced Charts: Service chart created.');
        }
    }

    function applyAllEnhancements(payload) { // Reçoit le payload complet de polling-updates
        if (!payload) {
            if (config.debugMode) console.warn('Enhanced Charts: No data payload provided.');
            return;
        }
        if (config.debugMode) console.log('Enhanced Charts: Applying enhancements with payload:', payload);

        // Utiliser les données brutes des sessions et participants
        if (payload.sessions) createOrUpdateThemeChart(payload.sessions);
        if (payload.participants) createOrUpdateServiceChart(payload.participants);

        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally();
        }
    }

    document.addEventListener('dashboardDataRefreshed', function(event) {
        if (event.detail && event.detail.data) {
            if (config.debugMode) console.log('Enhanced Charts: Received dashboardDataRefreshed event.');
            applyAllEnhancements(event.detail.data); // Passer le payload complet
        }
    });

    // Tentative d'initialisation si les données sont déjà là (peu probable avec le polling)
    if (window.dashboardData && (window.dashboardData.sessions || window.dashboardData.participants)) {
        if (config.debugMode) console.log('Enhanced Charts: Initializing with pre-loaded window.dashboardData.');
        applyAllEnhancements(window.dashboardData);
    } else {
         if (config.debugMode) console.log('Enhanced Charts: Waiting for dashboardDataRefreshed event.');
    }

    window.applyChartEnhancements = applyAllEnhancements;
    if (config.debugMode) console.log("Enhanced Charts (v2.1.0): Initialization complete.");
});
