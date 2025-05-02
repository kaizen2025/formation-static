// static/js/dashboard.js
document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard core script loaded.'); // Added log for confirmation

    // --- Configuration ---
    // Centralized configuration for easier management
    const config = {
        fetchInterval: 30000, // 30 seconds
        apiEndpoints: {
            sessions: '/api/sessions',
            participants: '/api/participants'
        },
        selectors: {
            sessionTableBody: '.session-table tbody', // More specific if needed
            participantSelects: 'select[name="participant_id"]'
        },
        cssClasses: {
            placesAvailable: 'text-success',
            placesWarning: 'text-warning',
            placesDanger: 'text-danger'
        },
        thresholds: {
            danger: 3,
            warning: 7
        }
    };

    // --- Core Functions ---

    // Function to fetch data from a given URL
    async function fetchData(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Erreur lors de la récupération des données de ${url}:`, error);
            // Optionally: display a user-friendly error message on the page
            return null; // Return null to indicate failure
        }
    }

    // Function to fetch and update session data
    async function fetchAndUpdateSessionData() {
        const data = await fetchData(config.apiEndpoints.sessions);
        if (data) {
            updateSessionTable(data);
            updateCharts(data); // Keep chart update hook
        }
    }

    // Function to fetch and update participant data
    async function fetchAndUpdateParticipantData() {
        const data = await fetchData(config.apiEndpoints.participants);
        if (data) {
            updateParticipantDropdowns(data);
        }
    }

    // Function to update the session table in the dashboard/admin area
    function updateSessionTable(sessions) {
        const sessionTableBody = document.querySelector(config.selectors.sessionTableBody);
        if (!sessionTableBody) {
            // console.warn('Session table body not found.'); // Optional warning
            return;
        }

        sessions.forEach(session => {
            // Find row using data attribute (assuming it exists from server-side rendering)
            const row = sessionTableBody.querySelector(`tr[data-session-id="${session.id}"]`);
            if (row) {
                // Update places available cell
                const placesCell = row.querySelector('.places-dispo'); // Assuming this class identifies the cell
                if (placesCell) {
                    placesCell.textContent = `${session.places_restantes} / ${session.max_participants}`;

                    // Update styling based on remaining places
                    placesCell.classList.remove(config.cssClasses.placesAvailable, config.cssClasses.placesWarning, config.cssClasses.placesDanger);
                    if (session.places_restantes <= config.thresholds.danger) {
                        placesCell.classList.add(config.cssClasses.placesDanger);
                    } else if (session.places_restantes <= config.thresholds.warning) {
                        placesCell.classList.add(config.cssClasses.placesWarning);
                    } else {
                        placesCell.classList.add(config.cssClasses.placesAvailable);
                    }
                }

                // Update participant count in the button badge (adjust selector if needed)
                const participantsBtn = row.querySelector('.btn-view-participants, .btn-outline-secondary'); // Example selectors
                if (participantsBtn) {
                    const badge = participantsBtn.querySelector('.badge');
                    if (badge) {
                        badge.textContent = session.inscrits; // Assuming 'inscrits' is the count
                    }
                }

                // Update data attribute used by the new filter logic (from HTML snippet)
                row.dataset.full = (session.places_restantes <= 0) ? '1' : '0';
                // Ensure row.dataset.theme is already set correctly by the server-side template
            }
        });
    }

    // Function to update charts (Placeholder - requires specific chart library integration)
    function updateCharts(data) {
        // Check if chart instances exist before updating
        if (window.themeChart && typeof window.themeChart.update === 'function') {
            // console.log('Updating theme chart...');
            // Example: window.themeChart.data.labels = newLabels;
            // Example: window.themeChart.data.datasets[0].data = newData;
            // window.themeChart.update();
        } else {
            // console.log('Theme chart instance not found or update method missing.');
        }

        if (window.serviceChart && typeof window.serviceChart.update === 'function') {
            // console.log('Updating service chart...');
            // Similar update logic for the service chart
            // window.serviceChart.update();
        } else {
            // console.log('Service chart instance not found or update method missing.');
        }
    }

    // Function to update participant dropdowns found on the page
    function updateParticipantDropdowns(participants) {
        const participantSelects = document.querySelectorAll(config.selectors.participantSelects);
        if (participantSelects.length === 0) {
            // console.log('No participant dropdowns found to update.'); // Optional log
            return;
        }

        participantSelects.forEach(select => {
            const selectedValue = select.value; // Preserve selected value if possible

            // Clear existing options (except the placeholder)
            const placeholder = select.querySelector('option[value=""]');
            select.innerHTML = ''; // Clear all
            if (placeholder) {
                select.appendChild(placeholder); // Add placeholder back
            } else {
                 // Add a default placeholder if none existed
                const defaultPlaceholder = document.createElement('option');
                defaultPlaceholder.value = "";
                defaultPlaceholder.textContent = "-- Choisir un participant --";
                select.appendChild(defaultPlaceholder);
            }


            // Populate with new participant data
            participants.forEach(participant => {
                const option = document.createElement('option');
                option.value = participant.id;
                // Adjust textContent based on available participant fields
                option.textContent = `${participant.prenom || ''} ${participant.nom || ''} (${participant.service || 'N/A'})`.trim();

                // Re-select the previously selected value, if it still exists
                if (participant.id.toString() === selectedValue) {
                    option.selected = true;
                }

                select.appendChild(option);
            });
        });
    }

    // --- Initialization ---

    // Initial data fetch on page load
    fetchAndUpdateSessionData();
    fetchAndUpdateParticipantData();

    // Set up periodic updates
    setInterval(() => {
        fetchAndUpdateSessionData();
        fetchAndUpdateParticipantData();
    }, config.fetchInterval);

    // Note: The filtering logic previously here (for .session-card) has been removed.
    // The filtering logic provided in the HTML snippet for #sessions-table should be used instead.

}); // End DOMContentLoaded