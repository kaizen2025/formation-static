// static/js/static-charts.js
// Version: 2.0.0 - Removed local restoreThemeBadges, relies on global enhanceThemeBadgesGlobally

document.addEventListener('DOMContentLoaded', function() {
    if (window.dashboardConfig && window.dashboardConfig.debugMode) {
        console.log("Static charts loader initialized (v2.0.0)");
    }
    
    let cachedThemeData = null;
    let cachedParticipantData = null;
    let initialRenderComplete = false;
    
    window.staticChartsModule = {
        initialize: initStaticCharts,
        updateThemeChart: function(data) {
            if (data && data.length) {
                cachedThemeData = data;
                renderThemeChart(data);
            }
        },
        updateServiceChart: function(data) {
            if (data && data.length) {
                cachedParticipantData = data;
                renderServiceChart(data);
            }
        }
    };
    
    initStaticCharts();
    
    async function initStaticCharts() {
        if (window.dashboardConfig && window.dashboardConfig.debugMode) {
            console.log("StaticCharts: Initializing...");
        }
        try {
            document.querySelectorAll('.chart-container').forEach(container => {
                const overlay = container.querySelector('.chart-overlay') || document.createElement('div');
                overlay.className = 'chart-overlay';
                overlay.innerHTML = '<div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div> Chargement...';
                overlay.style.display = 'flex';
                if (!container.querySelector('.chart-overlay')) container.appendChild(overlay);
            });
            
            let themeDataError = false;
            try {
                const themeData = await fetch('/api/sessions').then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)));
                if (themeData && themeData.length) {
                    cachedThemeData = themeData;
                    renderThemeChart(themeData);
                } else if (themeData === null) { // Explicitly null if API returned error handled by fetchWithRetry
                     themeDataError = true; markChartError('themeChart');
                }
            } catch (err) {
                console.error("StaticCharts: Error fetching/processing theme data:", err);
                themeDataError = true; markChartError('themeChart');
            }
            
            let serviceDataError = false;
            try {
                const participantData = await fetch('/api/participants').then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)));
                if (participantData && participantData.length) {
                    cachedParticipantData = participantData;
                    renderServiceChart(participantData);
                } else if (participantData === null) {
                    serviceDataError = true; markChartError('serviceChart');
                }
            } catch (err) {
                console.error("StaticCharts: Error fetching/processing service data:", err);
                serviceDataError = true; markChartError('serviceChart');
            }
            
            document.querySelectorAll('.chart-overlay').forEach(overlay => {
                overlay.style.display = 'none';
            });
            
            initialRenderComplete = true;

            // Call the global badge enhancer from layout.html
            if (typeof window.enhanceThemeBadgesGlobally === 'function') {
                if (window.dashboardConfig && window.dashboardConfig.debugMode) console.log("StaticCharts: Calling global enhanceThemeBadgesGlobally.");
                window.enhanceThemeBadgesGlobally();
            }
            
            return { success: !themeDataError && !serviceDataError };
        } catch (err) {
            console.error("StaticCharts: General error in initStaticCharts:", err);
            document.querySelectorAll('.chart-container').forEach(container => markChartError(container.firstElementChild?.id));
            return { success: false, error: err.message };
        }
    }
    
    function markChartError(chartId) {
        const chartElement = document.getElementById(chartId);
        if (!chartElement) return;
        const container = chartElement.parentElement; // Assuming chartId is the ID of the chart div itself
        if (!container) return;
        
        container.querySelector('.chart-overlay')?.remove();
        container.innerHTML = `
            <div class="alert alert-warning text-center small p-2">
                <i class="fas fa-exclamation-triangle me-1"></i> Graphique indisponible
            </div>
        `;
    }
    
    function renderThemeChart(sessions) {
        const container = document.getElementById('themeChart');
        if (!container) return;
        
        const themeCounts = {};
        const themeColors = {
            'Communiquer avec Teams': 'var(--theme-teams, #0078d4)',
            'Gérer les tâches (Planner)': 'var(--theme-planner, #7719aa)',
            'Gérer mes fichiers (OneDrive/SharePoint)': 'var(--theme-onedrive, #0364b8)',
            'Collaborer avec Teams': 'var(--theme-sharepoint, #038387)'
        };
        
        sessions.forEach(session => {
            if (!session.theme) return;
            themeCounts[session.theme] = themeCounts[session.theme] || { count: 0, color: themeColors[session.theme] || '#6c757d' };
            themeCounts[session.theme].count += (session.inscrits || 0);
        });
        
        const total = Object.values(themeCounts).reduce((sum, t) => sum + t.count, 0);
        let startAngle = 0;
        
        const donutSegmentsHTML = Object.entries(themeCounts).map(([theme, data], index) => {
            const percentage = total > 0 ? (data.count / total) * 360 : 0;
            const angle = startAngle;
            startAngle += percentage;
            return `
                <div class="donut-segment" style="
                    --fill: ${data.color};
                    --rotation: ${angle}deg; 
                    --percentage: ${percentage}deg;
                    --index: ${index};
                "></div>
            `;
        }).join('');

        const legendItemsHTML = Object.entries(themeCounts).map(([theme, data]) => `
            <div class="legend-item" title="${theme}: ${data.count} participant(s)">
                <span class="legend-color" style="background-color: ${data.color};"></span>
                <span class="legend-label">${theme.length > 25 ? theme.substring(0, 22) + '...' : theme}</span>
                <span class="legend-value badge bg-light text-dark ms-1">${data.count}</span>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="static-chart-donut ${!initialRenderComplete || (window.dashboardConfig && window.dashboardConfig.debugMode && Math.random() > 0.5) ? 'animate-segments' : ''}">
                ${donutSegmentsHTML}
                <div class="donut-center">
                    <div class="donut-total">${total}</div>
                    <div class="donut-label">Total Inscrits</div>
                </div>
            </div>
            <div class="static-chart-legend mt-3">
                ${legendItemsHTML}
            </div>
        `;
        if (window.dashboardConfig && window.dashboardConfig.debugMode) console.log("StaticCharts: Theme chart rendered.");
    }
    
    function renderServiceChart(participants) {
        const container = document.getElementById('serviceChart');
        if (!container) return;
        
        const serviceCounts = {};
        // Assuming service colors are defined in CSS variables or use a default
        
        participants.forEach(participant => {
            if (!participant.service) return;
            serviceCounts[participant.service] = (serviceCounts[participant.service] || 0) + 1;
        });
        
        const sortedServices = Object.entries(serviceCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 7); // Limit to top 7 services for clarity
        
        const maxCount = Math.max(...sortedServices.map(s => s[1]), 1);
        
        const serviceColorsFallback = ['#0d6efd', '#6c757d', '#198754', '#ffc107', '#dc3545', '#0dcaf0', '#6f42c1'];

        container.innerHTML = `
            <div class="static-chart-bars ${!initialRenderComplete || (window.dashboardConfig && window.dashboardConfig.debugMode && Math.random() > 0.5) ? 'animate-bars' : ''}">
                ${sortedServices.map(([service, count], index) => {
                    const percent = Math.max(1, Math.round((count / maxCount) * 100)); // Ensure bar is slightly visible
                    const colorVar = `--service-${service.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                    const color = getComputedStyle(document.documentElement).getPropertyValue(colorVar.trim()) || serviceColorsFallback[index % serviceColorsFallback.length];
                    return `
                        <div class="bar-item" title="${service}: ${count} participant(s)">
                            <div class="bar-label">${service.length > 20 ? service.substring(0, 18) + '...' : service}</div>
                            <div class="bar-container">
                                <div class="bar-value" style="width: ${percent}%; background-color: ${color}; --index: ${index};">
                                    <span class="bar-count-label">${count}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
         if (window.dashboardConfig && window.dashboardConfig.debugMode) console.log("StaticCharts: Service chart rendered.");
    }
});