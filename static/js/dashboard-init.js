/**
 * dashboard-init.js - Dashboard initialization and coordination
 * Initializes dashboard components, sets up communication mode, and handles manual refresh.
 * v1.0.2 - Clarified loading state usage, ensured config is used.
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard initialization script started (v1.0.2).');

    /**
     * @typedef {object} DashboardConfig
     * @property {boolean} debugMode - Enable verbose logging in console.
     * @property {boolean} socketEnabled - Allow WebSocket usage if available.
     * @property {boolean} pollingEnabled - Allow HTTP polling as fallback or primary.
     * @property {number} autoRefreshInterval - Interval for polling updates (in ms).
     * @property {'socket'|'polling'|'auto'} preferredMode - Preferred communication mode. 'auto' uses socket if available, else polling.
     * @property {'socket'|'polling'} [activeMode] - The actual communication mode being used (set by setupCommunicationMode).
     */

    // Use global config if available, otherwise provide defaults
    /** @type {DashboardConfig} */
    window.dashboardConfig = window.dashboardConfig || {
        debugMode: false,
        socketEnabled: true,
        pollingEnabled: true,
        autoRefreshInterval: 30000, // 30 seconds
        preferredMode: 'auto'
    };
    const DASH_CONFIG = window.dashboardConfig; // Local alias

    /**
     * Detects WebSocket support (native and Socket.IO library).
     * @returns {boolean} True if WebSocket and Socket.IO are available.
     */
    function detectWebSocketSupport() {
        const hasWebSocket = typeof WebSocket !== 'undefined';
        const hasSocketIO = typeof io !== 'undefined';
        if (DASH_CONFIG.debugMode) {
            console.log(`DashboardInit: WebSocket Support: Native=${hasWebSocket}, Socket.IO=${hasSocketIO}`);
        }
        return hasWebSocket && hasSocketIO;
    }

    /**
     * Shows or hides a global loading overlay.
     * @param {boolean} isLoading - True to show, false to hide.
     */
    function showGlobalLoadingOverlay(isLoading) {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = isLoading ? 'flex' : 'none';
        } else if (DASH_CONFIG.debugMode) {
            console.warn('DashboardInit: Global loading overlay (#loading-overlay) not found.');
        }
    }
    
    // Note: addLoadingStates and showLoadingState for individual containers are less used if polling-updates.js
    // and other modules handle their own specific loading indicators (e.g., spinner in recent-activity).
    // Keeping them here for potential future use or if a more granular loading display is needed.

    function setupCommunicationMode() {
        const hasWebSocket = detectWebSocketSupport();
        let mode = 'polling'; // Default to polling

        if (DASH_CONFIG.preferredMode === 'auto') {
            if (hasWebSocket && DASH_CONFIG.socketEnabled) {
                mode = 'socket';
                console.log('DashboardInit: Communication Mode: Auto -> WebSocket selected.');
            } else {
                mode = 'polling';
                console.log('DashboardInit: Communication Mode: Auto -> Polling selected (WebSocket unavailable or disabled).');
            }
        } else if (DASH_CONFIG.preferredMode === 'socket') {
            if (hasWebSocket && DASH_CONFIG.socketEnabled) {
                mode = 'socket';
                console.log('DashboardInit: Communication Mode: Preferred -> WebSocket selected.');
            } else {
                mode = 'polling';
                console.warn('DashboardInit: Communication Mode: WebSocket preferred but unavailable/disabled. Falling back to polling.');
            }
        } else if (DASH_CONFIG.preferredMode === 'polling') {
             if (DASH_CONFIG.pollingEnabled) {
                mode = 'polling';
                console.log('DashboardInit: Communication Mode: Preferred -> Polling selected.');
             } else {
                 console.error('DashboardInit: Communication Mode: Polling preferred but also disabled! Check configuration.');
             }
        } else {
            console.warn(`DashboardInit: Communication Mode: Unknown preferredMode '${DASH_CONFIG.preferredMode}'. Defaulting to polling.`);
            mode = 'polling';
        }

        if (mode === 'polling' && !DASH_CONFIG.pollingEnabled) {
             console.error('DashboardInit: Communication Mode: Polling selected but polling is disabled! Check configuration.');
        }

        DASH_CONFIG.activeMode = mode;
        console.log(`DashboardInit: Active communication mode set to: ${mode}`);
        return mode;
    }

    function initializeDashboardComponents() {
        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Initializing dashboard components...');
        showGlobalLoadingOverlay(true); // Show global loader before starting component init

        const componentPromises = [];

        try {
            if (typeof window.chartModule !== 'undefined' && typeof window.chartModule.initialize === 'function') {
                if (DASH_CONFIG.debugMode) console.log('DashboardInit: Scheduling chart initialization...');
                componentPromises.push(
                    new Promise((resolve, reject) => {
                        setTimeout(() => {
                            window.chartModule.initialize()
                                .then(resolve)
                                .catch(err => {
                                    console.error('DashboardInit: Chart initialization failed:', err);
                                    if (typeof showToast === 'function') showToast('Failed to load charts', 'danger');
                                    reject(err);
                                });
                        }, 200);
                    })
                );
            } else {
                console.warn('DashboardInit: Chart module (window.chartModule.initialize) not found. Skipping chart initialization.');
            }

            if (typeof window.refreshRecentActivity === 'function') {
                if (DASH_CONFIG.debugMode) console.log('DashboardInit: Scheduling activity feed initialization...');
                 componentPromises.push(
                    new Promise((resolve) => {
                        setTimeout(() => {
                            // Assuming refreshRecentActivity is synchronous or handles its own async
                            // If it returns a promise, chain it: .then(resolve).catch(resolve)
                            window.refreshRecentActivity();
                            resolve();
                        }, 500);
                    })
                 );
            } else {
                 console.warn('DashboardInit: Activity feed function (window.refreshRecentActivity) not found. Skipping.');
            }

            if (typeof window.updateStatsCounters === 'function') {
                 if (DASH_CONFIG.debugMode) console.log('DashboardInit: Scheduling stats counters initialization...');
                 componentPromises.push(
                    new Promise((resolve) => {
                        setTimeout(() => {
                            window.updateStatsCounters();
                            resolve();
                        }, 300);
                    })
                 );
            } else {
                 console.warn('DashboardInit: Stats counter function (window.updateStatsCounters) not found. Skipping.');
            }

            Promise.all(componentPromises)
                .then(() => {
                    if (DASH_CONFIG.debugMode) console.log('DashboardInit: All scheduled components initialized.');
                })
                .catch(error => {
                    console.error('DashboardInit: Error during one or more component initializations:', error);
                    if (typeof showToast === 'function') showToast('Error initializing some dashboard parts', 'warning');
                })
                .finally(() => {
                    showGlobalLoadingOverlay(false); // Hide global loader after all attempts
                });

        } catch (error) {
            console.error('DashboardInit: Error during component initialization scheduling phase:', error);
            if (typeof showToast === 'function') {
                showToast('Error initializing dashboard components', 'danger');
            }
            showGlobalLoadingOverlay(false);
        }
    }

    function setupRefreshButton() {
        const refreshButton = document.getElementById('refresh-dashboard');
        if (!refreshButton) {
            if (DASH_CONFIG.debugMode) {
                console.log('DashboardInit: Refresh button (#refresh-dashboard) not found. Skipping setup.');
            }
            return;
        }

        refreshButton.addEventListener('click', function() {
            if (DASH_CONFIG.debugMode) console.log('DashboardInit: Manual refresh triggered.');
            this.disabled = true;
            this.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Refreshing...';
            showGlobalLoadingOverlay(true);

            // Use forcePollingUpdate if available, as it's more comprehensive
            if (typeof window.forcePollingUpdate === 'function') {
                window.forcePollingUpdate(true) // true for importantChange, forces all data
                    .then(() => {
                        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Manual refresh via forcePollingUpdate completed.');
                        if (typeof showToast === 'function') showToast('Dashboard data refreshed', 'success');
                    })
                    .catch(err => {
                        console.error("DashboardInit: Error during manual refresh (forcePollingUpdate):", err);
                        if (typeof showToast === 'function') {
                            const message = err.message ? `Refresh error: ${err.message}` : 'Error refreshing dashboard data';
                            showToast(message, 'danger');
                        }
                    })
                    .finally(() => {
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Refresh';
                        showGlobalLoadingOverlay(false);
                    });
            } else {
                // Fallback to individual component refresh (less ideal if polling-updates is the main source)
                console.warn("DashboardInit: forcePollingUpdate not found, attempting individual component refresh.");
                const refreshPromises = [];
                if (typeof window.updateStatsCounters === 'function') {
                    refreshPromises.push(Promise.resolve().then(() => window.updateStatsCounters()));
                }
                if (typeof window.refreshRecentActivity === 'function') {
                    refreshPromises.push(Promise.resolve().then(() => window.refreshRecentActivity()));
                }
                if (typeof window.chartModule !== 'undefined' && typeof window.chartModule.initialize === 'function') {
                    refreshPromises.push(window.chartModule.initialize());
                }

                Promise.all(refreshPromises)
                    .then(() => {
                        if (DASH_CONFIG.debugMode) console.log('DashboardInit: Manual refresh (individual components) completed successfully.');
                        if (typeof showToast === 'function') showToast('Dashboard data refreshed', 'success');
                    })
                    .catch(err => {
                        console.error("DashboardInit: Error during manual refresh (individual components):", err);
                        if (typeof showToast === 'function') {
                            const message = err.message ? `Refresh error: ${err.message}` : 'Error refreshing dashboard data';
                            showToast(message, 'danger');
                        }
                    })
                    .finally(() => {
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-sync-alt me-1"></i>Refresh';
                        showGlobalLoadingOverlay(false);
                    });
            }
        });
         if (DASH_CONFIG.debugMode) console.log('DashboardInit: Refresh button event listener attached.');
    }

    function initializeDashboard() {
        console.log('DashboardInit: Starting main dashboard initialization sequence...');
        try {
            setupCommunicationMode();
            initializeDashboardComponents(); // This now handles its own loading overlay
            setupRefreshButton();
            console.log('DashboardInit: Dashboard initialization sequence complete.');
        } catch (error) {
            console.error('DashboardInit: Critical error during dashboard initialization sequence:', error);
            if (typeof showToast === 'function') {
                showToast('Fatal error initializing dashboard', 'danger');
            }
            showGlobalLoadingOverlay(false); // Ensure overlay is hidden on critical error
        }
    }

    setTimeout(initializeDashboard, 150); // Slightly increased delay for DOM readiness

});
