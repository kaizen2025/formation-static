/**
 * dashboard-compatibility-fix.js
 * Correctifs pour s'assurer que les fonctions clés retournent des promesses.
 * Version 1.0.2 - Ajout de délai et vérifications d'existence plus robustes.
 */
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        const DASH_CONFIG = window.dashboardConfig || { debugMode: false };
        const DEBUG = DASH_CONFIG.debugMode;

        if (DEBUG) {
            console.log('Dashboard Compatibility Fixes (v1.0.2): Initializing patches (with delay)...');
        }

        function patchFunction(obj, funcName, funcNameToLog) {
            if (obj && typeof obj[funcName] === 'function') {
                const originalFunction = obj[funcName];
                if (originalFunction._isPatchedByCompatibilityFix) {
                    if (DEBUG) console.log(`Dashboard Fix: ${funcNameToLog} already patched. Skipping.`);
                    return;
                }
                obj[funcName] = function(...args) {
                    if (DEBUG) console.log(`Dashboard Fix: Patched ${funcNameToLog} called`);
                    try {
                        const result = originalFunction.apply(this, args);
                        if (!(result instanceof Promise)) {
                            if (DEBUG) console.log(`Dashboard Fix: Converting ${funcNameToLog} result to Promise`);
                            return Promise.resolve(result);
                        }
                        return result;
                    } catch (error) {
                        if (DEBUG) console.error(`Dashboard Fix: Error in patched ${funcNameToLog}:`, error);
                        return Promise.reject(error);
                    }
                };
                obj[funcName]._isPatchedByCompatibilityFix = true; // Marquer comme patché
                if (DEBUG) console.log(`Dashboard Fix: ${funcNameToLog} patched successfully.`);
            } else if (DEBUG) {
                console.warn(`Dashboard Fix (delayed): ${funcNameToLog} not found or not a function. Creating dummy if part of expected API.`);
                // Créer des dummies seulement si c'est une fonction attendue par dashboard-init
                if (obj === window.chartModule && (funcName === 'initialize' || funcName === 'update')) {
                    obj[funcName] = function() { if (DEBUG) console.log(`Dashboard Fix: Using dummy ${funcNameToLog}`); return Promise.resolve(true); };
                } else if (obj === window && (funcName === 'refreshRecentActivity' || funcName === 'updateStatsCounters')) {
                    window[funcName] = function() { if (DEBUG) console.log(`Dashboard Fix: Using dummy ${funcNameToLog}`); return Promise.resolve(true); };
                }
            }
        }

        // S'assurer que window.chartModule existe avant d'essayer de patcher ses méthodes
        if (!window.chartModule) {
            if (DEBUG) console.warn('Dashboard Fix (delayed): window.chartModule not found. Creating dummy object.');
            window.chartModule = {
                initialize: function() { if (DEBUG) console.log('Dashboard Fix: Using dummy chartModule.initialize'); return Promise.resolve(true); },
                update: function() { if (DEBUG) console.log('Dashboard Fix: Using dummy chartModule.update'); return Promise.resolve(true); }
            };
        } else {
            patchFunction(window.chartModule, 'initialize', 'chartModule.initialize');
            patchFunction(window.chartModule, 'update', 'chartModule.update');
        }

        patchFunction(window, 'refreshRecentActivity', 'refreshRecentActivity');
        patchFunction(window, 'updateStatsCounters', 'updateStatsCounters');

        if (DEBUG) console.log('Dashboard Compatibility Fixes: All patch attempts completed.');

    }, 750); // Augmenter légèrement le délai si nécessaire (750ms)
});