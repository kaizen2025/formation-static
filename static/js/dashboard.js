// static/js/dashboard.js
// v1.1.0 - Reduced scope, primarily for session table updates if not handled by polling-updates.js directly.
// polling-updates.js is now the primary driver for most dashboard data.
document.addEventListener('DOMContentLoaded', function() {
    const DASH_CONFIG = window.dashboardConfig || { debugMode: false, fetchInterval: 30000 };
    if (DASH_CONFIG.debugMode) {
        console.log('Dashboard core script (dashboard.js) loaded (v1.1.0 - Reduced Scope).');
    }

    const config = {
        apiEndpoints: {
            sessions: (window.dashboardConfig && window.dashboardConfig.baseApiUrl ? `${window.dashboardConfig.baseApiUrl}/sessions` : '/api/sessions'),
            participants: (window.dashboardConfig && window.dashboardConfig.baseApiUrl ? `${window.dashboardConfig.baseApiUrl}/participants` : '/api/participants')
        },
        selectors: {
            sessionTableBody: '.session-table tbody',
            participantSelects: 'select[name="participant_id"]' // For modals or other forms
        },
        cssClasses: {
            placesAvailable: 'text-success',
            placesWarning: 'text-warning',
            placesDanger: 'text-danger'
        },
        thresholds: { // These thresholds are also used in ui-fixers.js. Ensure consistency or centralize.
            danger: 0, // Places-dispo coloring
            warningLow: 0.2, // 20%
            warningHigh: 0.4 // 40%
        }
    };

    async function fetchData(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} for ${url}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Dashboard.js: Erreur lors de la récupération de ${url}:`, error);
            return null;
        }
    }

    // This function is EXPORTED to be callable by polling-updates.js
    // It expects an array of session objects from the API
    window.updateSessionTable = function(sessions) {
        const sessionTableBody = document.querySelector(config.selectors.sessionTableBody);
        if (!sessionTableBody) {
            if (DASH_CONFIG.debugMode) console.warn('Dashboard.js: Session table body not found.');
            return;
        }
        if (DASH_CONFIG.debugMode) console.log('Dashboard.js: Updating session table with', sessions ? sessions.length : 0, 'sessions.');

        // Clear existing rows before repopulating (if data comes from a full refresh)
        // Or, if updating selectively, find and update rows.
        // For simplicity with polling-updates providing full lists, let's assume full refresh of this component.
        // However, polling-updates.js might call this with a full list, so direct manipulation is better.

        sessions.forEach(session => {
            const row = sessionTableBody.querySelector(`tr[data-session-id="${session.id}"]`);
            if (row) {
                const placesCell = row.querySelector('.places-dispo');
                if (placesCell) {
                    placesCell.textContent = `${session.places_restantes} / ${session.max_participants}`;
                    // Color logic is now primarily in ui-fixers.js, but can be a fallback here
                    placesCell.classList.remove(config.cssClasses.placesAvailable, config.cssClasses.placesWarning, config.cssClasses.placesDanger);
                    if (session.places_restantes <= config.thresholds.danger) {
                        placesCell.classList.add(config.cssClasses.placesDanger);
                    } else if (session.places_restantes <= Math.floor(session.max_participants * config.thresholds.warningLow)) { // Example: 20%
                        placesCell.classList.add(config.cssClasses.placesDanger); // Still danger if very low
                    } else if (session.places_restantes <= Math.floor(session.max_participants * config.thresholds.warningHigh)) { // Example: 40%
                        placesCell.classList.add(config.cssClasses.placesWarning);
                    } else {
                        placesCell.classList.add(config.cssClasses.placesAvailable);
                    }
                }

                const participantsBtnBadge = row.querySelector('.btn-outline-secondary .badge');
                if (participantsBtnBadge) {
                    participantsBtnBadge.textContent = session.inscrits; // 'inscrits' from API payload
                }

                row.dataset.full = (session.places_restantes <= 0) ? '1' : '0';
                // data-theme should be set by Jinja initially
            } else {
                // If row doesn't exist, it means the polling-updates.js might need to handle full table rebuilds
                // or this script needs to be more robust in creating rows.
                // For now, assume rows are pre-rendered or polling-updates handles full data.
                if (DASH_CONFIG.debugMode) console.warn(`Dashboard.js: Row for session ID ${session.id} not found in table.`);
            }
        });
        // Call ui-fixers if it exists, as it does more detailed styling
        if (typeof window.uiFixers !== 'undefined' && typeof window.uiFixers.applyAllFixes === 'function') {
            setTimeout(window.uiFixers.applyAllFixes, 50); // Apply fixes after DOM update
        }
    }

    // This function can be called if participant dropdowns need dynamic updates
    // (e.g., in modals after a new participant is added via AJAX)
    window.updateParticipantDropdowns = async function() {
        const data = await fetchData(config.apiEndpoints.participants); // Fetches paginated data by default
        if (data && data.items) { // Expecting paginated response { items: [...] }
            const participants = data.items;
            const participantSelects = document.querySelectorAll(config.selectors.participantSelects);
            if (participantSelects.length === 0) return;

            participantSelects.forEach(select => {
                const selectedValue = select.value;
                const placeholder = select.querySelector('option[value=""]');
                select.innerHTML = '';
                if (placeholder) select.appendChild(placeholder);
                else {
                    const defaultPlaceholder = document.createElement('option');
                    defaultPlaceholder.value = "";
                    defaultPlaceholder.textContent = "-- Choisir un participant --";
                    select.appendChild(defaultPlaceholder);
                }

                participants.forEach(participant => {
                    const option = document.createElement('option');
                    option.value = participant.id;
                    option.textContent = `${participant.prenom || ''} ${participant.nom || ''} (${participant.service || 'N/A'})`.trim();
                    if (participant.id.toString() === selectedValue) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                });
            });
        } else if (DASH_CONFIG.debugMode) {
            console.warn("Dashboard.js: No participant data or incorrect format from API for dropdowns.");
        }
    }

    // Initial calls are now mostly handled by polling-updates.js
    // If this script were to run independently, you'd fetch here.
    // For example:
    // async function initialLoad() {
    //     const sessions = await fetchData(config.apiEndpoints.sessions);
    //     if (sessions && sessions.items) window.updateSessionTable(sessions.items);
    //     await window.updateParticipantDropdowns();
    // }
    // initialLoad();

    // Periodic updates are handled by polling-updates.js
    // The filtering logic for .session-row is in dashboard.html's inline script.

    if (DASH_CONFIG.debugMode) {
        console.log('Dashboard.js: Setup complete. Waiting for polling-updates.js to drive data.');
    }
});
