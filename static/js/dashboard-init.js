/**
 * dashboard-init.js - Dashboard initialization and coordination
 * Initializes dashboard components, sets up communication mode, and handles manual refresh.
 * v1.0.1 - Added JSDoc comments and clarifications.
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard initialization script started.');

    /**
     * @typedef {object} DashboardConfig
     * @property {boolean} debugMode - Enable verbose logging in console.
     * @property {boolean} socketEnabled - Allow WebSocket usage if available.
     * @property {boolean} pollingEnabled - Allow HTTP polling as fallback or primary.
     * @property {number} autoRefreshInterval - Interval for polling updates (in ms).
     * @property {'socket'|'polling'|'auto'} preferredMode - Preferred communication mode. 'auto' uses socket if available, else polling.
     * @property {'socket'|'polling'} [activeMode] - The actual communication mode being used (set by setupCommunicationMode).
     */

    /** @type {DashboardConfig} */
    window.dashboardConfig = {
        debugMode: false,
        socketEnabled: true,
        pollingEnabled: true,
        autoRefreshInterval: 30000, // 30 seconds
        preferredMode: 'auto'
    };

    /**
     * Detects WebSocket support (native and Socket.IO library).
     * @returns {boolean} True if WebSocket and Socket.IO are available.
     */
    function detectWebSocketSupport() {
        const hasWebSocket = typeof WebSocket !== 'undefined';
        const hasSocketIO = typeof io !== 'undefined';
        if (window.dashboardConfig.debugMode) {
            console.log(`WebSocket Support: Native=${hasWebSocket}, Socket.IO=${hasSocketIO}`);
        }
        return hasWebSocket && hasSocketIO;
    }

    /**
     * Determines and sets the best communication mode based on config and capabilities.
     * Stores the result in window.dashboardConfig.activeMode.
     * @returns {'socket'|'polling'} The active communication mode.
     */
	// Dans static-charts.js ou dashboard-init.js
function addLoadingStates() {
    // Ajouter des états de chargement aux différentes sections
    document.querySelectorAll('.data-container').forEach(container => {
        if (!container.querySelector('.loading-overlay')) {
            const overlay = document.createElement('div');
            overlay.className = 'loading-overlay';
            overlay.innerHTML = `
                <div class="spinner-border spinner-border-sm text-primary" role="status">
                    <span class="visually-hidden">Chargement...</span>
                </div>
                <span class="ms-2 small">Chargement des données...</span>
            `;
            container.appendChild(overlay);
            container.style.position = 'relative';
        }
    });
}

function showLoadingState(elementId, isLoading) {
    const container = document.getElementById(elementId);
    if (!container) return;
    
    let overlay = container.querySelector('.loading-overlay');
    if (!overlay && isLoading) {
        // Créer l'overlay s'il n'existe pas
        overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div class="spinner-border spinner-border-sm text-primary" role="status">
                <span class="visually-hidden">Chargement...</span>
            </div>
            <span class="ms-2 small">Chargement des données...</span>
        `;
        container.appendChild(overlay);
    }
    
    if (overlay) {
        overlay.style.display = isLoading ? 'flex' : 'none';
    }
}
 
    function setupCommunicationMode() {
        const hasWebSocket = detectWebSocketSupport();
        const config = window.dashboardConfig;
        let mode = 'polling'; // Default to polling

        if (config.preferredMode === 'auto') {
            if (hasWebSocket && config.socketEnabled) {
                mode = 'socket';
                console.log('Communication Mode: Auto -> WebSocket selected.');
            } else {
                mode = 'polling'; // Explicitly set polling if socket not viable
                console.log('Communication Mode: Auto -> Polling selected (WebSocket unavailable or disabled).');
            }
        } else if (config.preferredMode === 'socket') {
            if (hasWebSocket && config.socketEnabled) {
                mode = 'socket';
                console.log('Communication Mode: Preferred -> WebSocket selected.');
            } else {
                mode = 'polling'; // Fallback to polling
                console.warn('Communication Mode: WebSocket preferred but unavailable/disabled. Falling back to polling.');
            }
        } else if (config.preferredMode === 'polling') {
             if (config.pollingEnabled) {
                mode = 'polling';
                console.log('Communication Mode: Preferred -> Polling selected.');
             } else {
                 // This case should ideally not happen if polling is the ultimate fallback
                 console.error('Communication Mode: Polling preferred but also disabled! Check configuration.');
                 // Still default to 'polling' as the mode variable, but log error.
             }
        } else {
            console.warn(`Communication Mode: Unknown preferredMode '${config.preferredMode}'. Defaulting to polling.`);
            mode = 'polling';
        }

        // Ensure polling is enabled if it's the chosen mode
        if (mode === 'polling' && !config.pollingEnabled) {
             console.error('Communication Mode: Polling selected but polling is disabled! Check configuration.');
             // Decide on behavior: maybe force polling anyway or throw error? For now, log error.
        }


        window.dashboardConfig.activeMode = mode;
        console.log(`Active communication mode set to: ${mode}`);
        return mode;
    }

    /**
     * Initializes various dashboard components like charts, activity feed, and stats.
     * Relies on functions/modules potentially defined in other scripts (e.g., charts.js, polling-updates.js).
     * Uses setTimeout to allow other scripts/DOM rendering to complete. Consider replacing
     * with Promises or custom events for more robust dependency management if possible.
     */
    function initializeDashboardComponents() {
        const config = window.dashboardConfig;
        console.log('Initializing dashboard components...');

        try {
            // Initialize charts (assuming defined in charts.js or similar)
            // Delay allows DOM elements (like canvas) to be fully ready.
            if (typeof window.chartModule !== 'undefined' && typeof window.chartModule.initialize === 'function') {
                setTimeout(() => {
                    if (config.debugMode) console.log('Initializing charts...');
                    window.chartModule.initialize().catch(err => {
                        console.error('Chart initialization failed:', err);
                        if (typeof showToast === 'function') showToast('Failed to load charts', 'danger');
                    });
                }, 200); // Delay (ms) - adjust if needed
            } else {
                console.warn('Chart module (window.chartModule.initialize) not found. Skipping chart initialization.');
            }

            // Initialize activity feed (assuming defined elsewhere)
            // Delay allows initial data fetching or rendering.
            if (typeof window.refreshRecentActivity === 'function') {
                 setTimeout(() => {
                    if (config.debugMode) console.log('Initializing activity feed...');
                    window.refreshRecentActivity(); // Assuming this handles its own errors
                 }, 500); // Delay (ms) - adjust if needed
            } else {
                 console.warn('Activity feed function (window.refreshRecentActivity) not found. Skipping.');
            }

            // Initialize stats counters (assuming defined elsewhere)
            // Delay allows DOM elements for counters to be ready.
            if (typeof window.updateStatsCounters === 'function') {
                 setTimeout(() => {
                    if (config.debugMode) console.log('Initializing stats counters...');
                    window.updateStatsCounters(); // Assuming this handles its own errors
                 }, 300); // Delay (ms) - adjust if needed
            } else {
                 console.warn('Stats counter function (window.updateStatsCounters) not found. Skipping.');
            }

        } catch (error) {
            console.error('Error during component initialization phase:', error);
            if (typeof showToast === 'function') {
                showToast('Error initializing dashboard components', 'danger');
            }
        }
    }

    /**
     * Sets up the event listener for the manual refresh button.
     */
    function setupRefreshButton() {
        const refreshButton = document.getElementById('refresh-dashboard');
        if (!refreshButton) {
            if (window.dashboardConfig.debugMode) {
                console.log('Refresh button (#refresh-dashboard) not found. Skipping setup.');
            }
            return; // No button found
        }

        refreshButton.addEventListener('click', function() {
            console.log('Manual refresh triggered.');
            this.disabled = true;
            this.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Refreshing...';

            // Create promises for each refreshable component
            const refreshPromises = [];

            if (typeof window.updateStatsCounters === 'function') {
                // Assuming updateStatsCounters returns a Promise or is synchronous
                refreshPromises.push(Promise.resolve().then(() => window.updateStatsCounters()));
            }
            if (typeof window.refreshRecentActivity === 'function') {
                // Assuming refreshRecentActivity returns a Promise or is synchronous
                refreshPromises.push(Promise.resolve().then(() => window.refreshRecentActivity()));
            }
            if (typeof window.chartModule !== 'undefined' && typeof window.chartModule.initialize === 'function') {
                // Assuming chartModule.initialize returns a Promise
                refreshPromises.push(window.chartModule.initialize());
            }

            // Wait for all refresh operations to complete
            Promise.all(refreshPromises)
                .then(() => {
                    console.log('Manual refresh completed successfully.');
                    if (typeof showToast === 'function') {
                        showToast('Dashboard data refreshed', 'success');
                    }
                })
                .catch(err => {
                    console.error("Error during manual refresh:", err);
                    if (typeof showToast === 'function') {
                        // Provide a slightly more specific error if possible, otherwise generic
                        const message = err.message ? `Refresh error: ${err.message}` : 'Error refreshing dashboard data';
                        showToast(message, 'danger');
                    }
                })
                .finally(() => {
                    // Ensure button is re-enabled and text reset even if errors occurred
                    this.disabled = false;
                    this.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Refresh';
                });
        });
         console.log('Refresh button event listener attached.');
    }

    /**
     * Main initialization sequence.
     */
    function initializeDashboard() {
        console.log('Starting main dashboard initialization sequence...');
        try {
            // 1. Determine communication mode (must happen first)
            setupCommunicationMode();

            // 2. Initialize components (charts, stats, activity)
            initializeDashboardComponents();

            // 3. Setup interactive elements like the refresh button
            setupRefreshButton();

            console.log('Dashboard initialization sequence complete.');

        } catch (error) {
            console.error('Critical error during dashboard initialization sequence:', error);
            if (typeof showToast === 'function') {
                showToast('Fatal error initializing dashboard', 'danger');
            }
            // Depending on severity, might want to display a more prominent error message on the page
        }
    }

    // Run the main initialization function after a brief delay.
    // This ensures the DOM is fully parsed and potentially allows other critical scripts
    // to execute first. Adjust delay if necessary, or replace with a more robust
    // mechanism like waiting for a specific event if possible.
    setTimeout(initializeDashboard, 100); // 100ms delay

});