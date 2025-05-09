/**
 * dashboard-core.js - DEBUGGING VERSION
 * Version: DEBUG_1.0 - Focus on API call and basic data logging
 */

document.addEventListener('DOMContentLoaded', function() {
    if (window.dashboardCoreInitialized_DEBUG) {
        console.log('Dashboard Core (DEBUG): Already initialized. Skipping.');
        return;
    }
    window.dashboardCoreInitialized_DEBUG = true;
    console.log('Dashboard Core (DEBUG): Initializing (DEBUG_1.0)');

    const config = {
        debugMode: (window.dashboardConfig && window.dashboardConfig.debugMode !== undefined) ? window.dashboardConfig.debugMode : true, // Force debugMode for this test
        baseApiUrl: (window.dashboardConfig && window.dashboardConfig.baseApiUrl) || '/api',
        fetchTimeoutDuration: (window.dashboardConfig && window.dashboardConfig.fetchTimeoutDuration) || 20000
    };

    console.log('Dashboard Core (DEBUG): Config:', config);

    const globalLoadingOverlay = document.getElementById('loading-overlay');

    function showGlobalLoading(isLoading) {
        if (globalLoadingOverlay) {
            globalLoadingOverlay.style.display = isLoading ? 'flex' : 'none';
            if(isLoading) globalLoadingOverlay.classList.remove('hidden'); else globalLoadingOverlay.classList.add('hidden');
        }
    }

    async function fetchInitialData() {
        console.log('Dashboard Core (DEBUG): Attempting to fetch initial data...');
        showGlobalLoading(true);
        const apiUrl = `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                console.error('Dashboard Core (DEBUG): Fetch timed out!');
            }, config.fetchTimeoutDuration);

            const response = await fetch(apiUrl, { signal: controller.signal, cache: "no-store" });
            clearTimeout(timeoutId);

            console.log('Dashboard Core (DEBUG): API Response Status:', response.status, response.statusText);
            const responseText = await response.clone().text(); // Lire le texte pour le log
            console.log('Dashboard Core (DEBUG): API Response Text:', responseText);


            if (!response.ok) {
                let errorDetails = `HTTP error ${response.status}`;
                try {
                    const errorJson = JSON.parse(responseText); // Essayer de parser le texte qu'on a déjà
                    errorDetails = errorJson.message || errorJson.error || JSON.stringify(errorJson);
                } catch (e) {
                    // Si ce n'est pas du JSON, le responseText est déjà le message d'erreur (souvent HTML)
                    errorDetails = responseText.substring(0, 500) + "... (tronqué)"; // Limiter la taille du log HTML
                }
                console.error('Dashboard Core (DEBUG): API Error Data:', errorDetails);
                throw new Error(`API request failed with status ${response.status}: ${errorDetails}`);
            }

            const data = JSON.parse(responseText); // Parser le texte qu'on a déjà

            if (!data || typeof data !== 'object') {
                console.error('Dashboard Core (DEBUG): Invalid data format received from API.', data);
                throw new Error('Invalid data format from API.');
            }

            console.log('Dashboard Core (DEBUG): Data received successfully:', data);

            // Log spécifique pour chaque section de données
            if (data.sessions) {
                console.log(`Dashboard Core (DEBUG): Received ${data.sessions.length} sessions.`);
                // Vous pouvez ajouter un log du premier élément pour vérifier la structure
                // if (data.sessions.length > 0) console.log('Dashboard Core (DEBUG): First session:', data.sessions[0]);
            } else {
                console.warn('Dashboard Core (DEBUG): No "sessions" data in API response.');
            }

            if (data.participants) {
                console.log(`Dashboard Core (DEBUG): Received ${data.participants.length} participants.`);
            } else {
                console.warn('Dashboard Core (DEBUG): No "participants" data in API response.');
            }

            if (data.activites) {
                console.log(`Dashboard Core (DEBUG): Received ${data.activites.length} activities.`);
            } else {
                console.warn('Dashboard Core (DEBUG): No "activites" data in API response.');
            }

            // À ce stade, vous pourriez appeler des fonctions de rendu très simples
            // pour voir si les données de base s'affichent.
            // Par exemple, juste le nombre de sessions dans la table.
            const sessionTableBody = document.querySelector('.session-table tbody');
            if (sessionTableBody && data.sessions) {
                sessionTableBody.innerHTML = `<tr><td colspan="5">Nombre de sessions reçues: ${data.sessions.length}</td></tr>`;
            } else if (sessionTableBody) {
                 sessionTableBody.innerHTML = `<tr><td colspan="5">Aucune session reçue ou table non trouvée.</td></tr>`;
            }


        } catch (error) {
            console.error('Dashboard Core (DEBUG): Critical error during fetchInitialData:', error);
            const sessionTableBody = document.querySelector('.session-table tbody');
            if(sessionTableBody) sessionTableBody.innerHTML = `<tr><td colspan="5" class="text-danger">Erreur critique lors du chargement des données: ${error.message}</td></tr>`;
            if (typeof showToast === 'function') {
                showToast(`Erreur critique: ${error.message}`, 'danger');
            }
        } finally {
            showGlobalLoading(false);
            console.log('Dashboard Core (DEBUG): fetchInitialData finished.');
            document.dispatchEvent(new CustomEvent('dashboardCoreFrameworkReady')); // Signaler que le framework de base est prêt
        }
    }

    // Démarrer le chargement initial des données
    fetchInitialData();

});
