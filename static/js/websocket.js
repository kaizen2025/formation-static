/**
 * Formation Microsoft 365 - websocket.js (version optimisée)
 * Implémente la communication en temps réel et corrige les problèmes de connexion
 * v1.4.0
 */

const config = {
    debugMode: false, // Mettre à true dans la console pour logs détaillés
    retryAttempts: 3,  // Nombre de tentatives pour les API
    retryDelay: 500    // Délai initial entre les tentatives (ms)
};

// Fonction utilitaire pour les requêtes fetch avec retry
async function fetchWithRetry(url, options = {}, maxRetries = config.retryAttempts, initialDelay = config.retryDelay) {
    let retries = 0;
    let delay = initialDelay;
    
    while (retries < maxRetries) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response.json();
            throw new Error(`Erreur HTTP ${response.status}`);
        } catch (error) {
            retries++;
            if (retries >= maxRetries) throw error;
            
            console.log(`Erreur fetch, tentative ${retries}/${maxRetries} dans ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Délai exponentiel avec jitter pour éviter la congestion
            delay = delay * 1.5 + Math.random() * 200;
        }
    }
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('WebSocket Initializing...');
    
    try {
        const socket = io({
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 10000,
            transports: ['websocket', 'polling'], // Autoriser polling en fallback
            forceNew: true                        // Forcer une nouvelle connexion
        });

        let heartbeatInterval;
        function startHeartbeat() {
            clearInterval(heartbeatInterval);
            heartbeatInterval = setInterval(() => {
                if (socket.connected) {
                    socket.emit('heartbeat', { timestamp: Date.now() });
                    if (config.debugMode) console.log('Heartbeat sent');
                }
            }, 30000);
        }

        // --- Socket.IO Event Listeners ---

        socket.on('connect', function() {
            console.log('WebSocket Connected:', socket.id);
            if (typeof showToast === 'function') showToast('Connecté au serveur.', 'success');
            socket.emit('join', { room: 'general' });
            const userIdInput = document.getElementById('user-id');
            if (userIdInput && userIdInput.value) {
                socket.emit('join', { room: `user_${userIdInput.value}` });
                if (config.debugMode) console.log(`User ${userIdInput.value} joining personal room.`);
            } else {
                 if (config.debugMode) console.log('No user ID found, not joining personal room.');
            }
            startHeartbeat();
            
            // Initialiser les composants après connexion réussie
            if (typeof window.chartModule !== 'undefined' && window.chartModule.initialize) {
                window.chartModule.initialize();
            } else {
                console.warn('Module de graphiques non disponible, initialisant directement');
                initializeCharts();
            }
            
            refreshRecentActivity();
            updateStatsCounters();
        });

        socket.on('disconnect', function(reason) { 
            console.log('WebSocket Disconnected:', reason); 
            if (typeof showToast === 'function') showToast('Connexion serveur perdue...', 'warning'); 
            clearInterval(heartbeatInterval); 
        });
        
        socket.on('reconnect', function(attemptNumber) { 
            console.log(`WebSocket Reconnected (attempt ${attemptNumber})`); 
            if (typeof showToast === 'function') showToast('Connexion rétablie.', 'success'); 
            startHeartbeat(); 
            
            // Réinitialiser les composants après reconnexion
            if (typeof window.chartModule !== 'undefined' && window.chartModule.initialize) {
                window.chartModule.initialize();
            } else {
                initializeCharts();
            }
            
            refreshRecentActivity(); 
            updateStatsCounters(); 
        });
        
        // Gestion des erreurs de connexion
        socket.on('reconnect_failed', function() { 
            console.error('WebSocket Reconnect Failed'); 
            if (typeof showToast === 'function') showToast('Reconnexion échouée. Rechargez la page.', 'danger'); 
        });
        
        socket.on('reconnect_error', function(error) { 
            console.error('WebSocket Reconnect Error:', error); 
            if (typeof showToast === 'function') showToast('Erreur de reconnexion.', 'danger'); 
        });
        
        socket.on('connect_error', (error) => { 
            console.error('WebSocket Connection Error:', error.message); 
            if (typeof showToast === 'function') showToast('Erreur de connexion WebSocket.', 'danger'); 
        });
        
        socket.on('error', function(error) { 
            console.error('WebSocket Generic Error:', error); 
            if (typeof showToast === 'function') showToast('Erreur WebSocket.', 'danger'); 
        });

        // --- Gestionnaires d'événements spécifiques ---

        socket.on('heartbeat_response', function(data) { 
            if (config.debugMode) console.log('Heartbeat received:', data); 
        });

        socket.on('notification', function(data) {
            console.log('Notification received:', data);
            if (typeof showToast === 'function') showToast(data.message, data.type || 'info');
            if (data.event === 'place_disponible') {
                updateSessionPlaces(data.session_id);
            }
        });

        socket.on('inscription_nouvelle', function(data) {
            console.log('Inscription nouvelle:', data);
            updateSessionPlaces(data.session_id);
            updateStatsCounters(['total_en_attente']);
            refreshRecentActivity();
            updateParticipantModalData(data.session_id);
        });

        socket.on('inscription_validee', function(data) {
            console.log('Inscription validée:', data);
            updateInscriptionStatus(data.inscription_id, 'confirmé');
            updateStatsCounters(['total_inscriptions', 'total_sessions_completes']);
            updateSessionPlaces(data.session_id);
            refreshRecentActivity();
            updateParticipantModalData(data.session_id);
        });

        socket.on('inscription_refusee', function(data) {
            console.log('Inscription refusée:', data);
            updateInscriptionStatus(data.inscription_id, 'refusé');
            refreshRecentActivity();
            updateParticipantModalData(data.session_id);
        });

        socket.on('inscription_annulee', function(data) {
            console.log('Inscription annulée:', data);
            updateInscriptionStatus(data.inscription_id, 'annulé');
            updateStatsCounters(['total_inscriptions', 'total_sessions_completes']);
            updateSessionPlaces(data.session_id);
            refreshRecentActivity();
            updateParticipantModalData(data.session_id);
        });

        socket.on('liste_attente_nouvelle', function(data) {
            console.log('Liste attente nouvelle:', data);
            updateWaitlistCounters(data.session_id, data.total_session_attente);
            updateStatsCounters(['total_en_attente']);
            refreshRecentActivity();
            updateParticipantModalData(data.session_id);
        });

        socket.on('attribution_salle', function(data) {
            console.log('Attribution salle:', data);
            updateSalleDisplay(data.session_id, data.salle_nom);
            refreshRecentActivity();
        });

        socket.on('nouvelle_activite', function(data) {
            if (config.debugMode) console.log('Nouvelle activité (raw):', data);
            prependRecentActivity(data);
        });

        // --- Fonctions de mise à jour de l'interface ---

        function updateStatsCounters(counterIds = ['total_inscriptions', 'total_en_attente', 'total_sessions_completes', 'sessions_programmees', 'counter-participants', 'counter-salles', 'counter-capacite', 'counter-themes', 'counter-services']) {
            Promise.all([
                fetchWithRetry('/api/sessions'),
                fetchWithRetry('/api/participants'),
                fetchWithRetry('/api/salles')
            ]).then(([sessionsData, participantsData, sallesData]) => {
                if (counterIds.includes('sessions_programmees')) updateCounter('sessions_programmees', sessionsData.length);
                if (counterIds.includes('total_sessions_completes')) updateCounter('total_sessions_completes', sessionsData.filter(s => s.places_restantes === 0).length);
                if (counterIds.includes('total_inscriptions')) updateCounter('total_inscriptions', sessionsData.reduce((sum, s) => sum + s.inscrits, 0));
                if (counterIds.includes('total_en_attente')) updateCounter('total_en_attente', sessionsData.reduce((sum, s) => sum + (s.liste_attente || 0), 0));
                if (counterIds.includes('counter-participants')) updateCounter('counter-participants', participantsData.length);
                if (counterIds.includes('counter-salles')) updateCounter('counter-salles', sallesData.length);
                if (counterIds.includes('counter-capacite')) updateCounter('counter-capacite', sallesData.reduce((sum, s) => sum + (s.capacite || 0), 0));
            }).catch(error => {
                console.error('Erreur MàJ compteurs:', error);
                if (typeof showToast === 'function') showToast('Erreur chargement statistiques', 'warning');
            });
        }

        function updateCounter(elementId, value) {
            const elements = document.querySelectorAll(`#${elementId}, .${elementId}, [id^="counter-${elementId}"]`);
            elements.forEach(element => {
                if (element) {
                    const currentValue = parseInt(element.textContent.replace(/,/g, ''), 10) || 0;
                    const targetValue = parseInt(value, 10);
                    if (!isNaN(targetValue)) { animateCounter(element, currentValue, targetValue); }
                }
            });
        }

        function animateCounter(element, startValue, endValue) {
            if (startValue === endValue) { element.textContent = endValue; return; }
            const duration = 700;
            const steps = 15;
            const increment = (endValue - startValue) / steps;
            let current = startValue;
            let stepCount = 0;
            const interval = duration / steps;
            const timer = setInterval(() => {
                current += increment;
                stepCount++;
                if (stepCount >= steps || (increment > 0 && current >= endValue) || (increment < 0 && current <= endValue)) {
                    clearInterval(timer);
                    element.textContent = endValue;
                } else {
                    element.textContent = Math.round(current);
                }
            }, interval);
        }

        function updateSessionPlaces(sessionId, placesRestantes = null) {
            // Si placesRestantes n'est pas fourni, on doit fetch pour le recalculer
            if (placesRestantes === null) {
                fetchWithRetry(`/api/sessions/${sessionId}`)
                    .then(sessionData => {
                        updatePlacesDisplay(
                            sessionData.id,
                            sessionData.places_restantes,
                            sessionData.inscrits,
                            sessionData.max_participants
                        );
                    })
                    .catch(error => console.error('Erreur MàJ places session:', error));
            } else {
                // On a les places, mais on a quand même besoin des autres infos
                fetchWithRetry(`/api/sessions/${sessionId}`)
                    .then(sessionData => {
                        updatePlacesDisplay(
                            sessionData.id,
                            placesRestantes,
                            sessionData.inscrits,
                            sessionData.max_participants
                        );
                    })
                    .catch(error => console.error('Erreur MàJ places session:', error));
            }
        }

        function updatePlacesDisplay(sessionId, places, inscrits, max) {
            const placesElements = document.querySelectorAll(`.places-dispo[data-session-id="${sessionId}"]`);
            placesElements.forEach(el => {
                el.innerHTML = `<strong>${places}</strong>`;
                el.classList.remove('text-success', 'text-warning', 'text-danger');
                if (places <= 0) el.classList.add('text-danger');
                else if (places <= 3) el.classList.add('text-warning');
                else el.classList.add('text-success');
                const row = el.closest('.session-row, .session-card-col');
                if (row) row.dataset.full = (places === 0) ? '1' : '0';
            });
            
            const inscritsElements = document.querySelectorAll(`.inscrits-count[data-session-id="${sessionId}"]`);
            inscritsElements.forEach(el => el.textContent = inscrits);
            
            const progressBars = document.querySelectorAll(`.progress-bar[data-session-id="${sessionId}"]`);
            progressBars.forEach(bar => {
                const progress = max > 0 ? (inscrits / max * 100) : 0;
                bar.style.width = `${progress}%`;
                bar.setAttribute('aria-valuenow', inscrits);
                bar.classList.remove('bg-success', 'bg-warning', 'bg-danger');
                if (places <= 0) bar.classList.add('bg-danger');
                else if (progress >= 75) bar.classList.add('bg-warning');
                else bar.classList.add('bg-success');
            });
            
            const rowElements = document.querySelectorAll(`.session-row[data-session-id="${sessionId}"], .session-card-col[data-session-id="${sessionId}"]`);
            rowElements.forEach(row => {
                const inscriptionBtn = row.querySelector('.btn-action-inscription');
                const attenteBtn = row.querySelector('.btn-action-attente');
                if (inscriptionBtn) inscriptionBtn.style.display = places > 0 ? '' : 'none';
                if (attenteBtn) attenteBtn.style.display = places <= 0 ? '' : 'none';
            });
        }

        function updateWaitlistCounters(sessionId, totalSessionAttente) {
            const attenteCounters = document.querySelectorAll(`.attente-counter[data-session-id="${sessionId}"]`);
            attenteCounters.forEach(el => {
                el.textContent = totalSessionAttente || 0;
                const parentButton = el.closest('.btn-view-attente');
                if (parentButton) {
                    parentButton.style.display = (totalSessionAttente > 0) ? '' : 'none';
                }
            });
        }

        function updateSalleDisplay(sessionId, salleNom) {
            const salleElements = document.querySelectorAll(`.salle-badge[data-session-id="${sessionId}"]`);
            salleElements.forEach(el => {
                if (salleNom) {
                    el.textContent = salleNom;
                    el.className = 'badge bg-info text-dark salle-badge';
                } else {
                    el.textContent = 'Non définie';
                    el.className = 'badge bg-secondary salle-badge';
                }
            });
        }

        function updateInscriptionStatus(inscriptionId, status) {
            const modalRow = document.querySelector(`.modal.show tr[data-inscription-id="${inscriptionId}"]`);
            if (modalRow) {
                const statusCell = modalRow.querySelector('.badge');
                const actionsCell = modalRow.querySelector('.actions-cell');
                
                if (statusCell) {
                    statusCell.textContent = status.charAt(0).toUpperCase() + status.slice(1);
                    statusCell.className = `badge rounded-pill ${status === 'confirmé' ? 'bg-success' : (status === 'annulé' || status === 'refusé' ? 'bg-danger' : 'bg-warning text-dark')}`;
                }
                
                if (actionsCell) {
                    actionsCell.innerHTML = '';
                    if (status === 'confirmé') {
                        actionsCell.innerHTML = `<a href="/generer_invitation/${inscriptionId}" class="btn btn-sm btn-outline-primary" target="_blank" title="Invitation Outlook"><i class="far fa-calendar-plus"></i></a>`;
                    } else if (status === 'en attente') {
                        actionsCell.innerHTML = `<span class="text-muted small">Validation...</span>`;
                    }
                }
                
                // Rafraîchir toute la modale pour assurer la cohérence des listes/comptes
                const modal = modalRow.closest('.modal');
                if (modal && modal.id.startsWith('participantsModal')) {
                    const sessionId = modal.id.replace('participantsModal', '');
                    updateParticipantModalData(sessionId);
                }
            }
        }

        function updateParticipantModalData(sessionId) {
            const modal = document.getElementById(`participantsModal${sessionId}`);
            // Ne met à jour que si la modale est actuellement affichée
            if (!modal || !modal.classList.contains('show')) return;

            if (config.debugMode) console.log(`Updating modal data for session ${sessionId}`);

            // Afficher un indicateur de chargement
            const loadingIndicators = modal.querySelectorAll('.modal-loading-indicator');
            loadingIndicators.forEach(indicator => {
                if (indicator) indicator.style.display = 'block';
            });

            fetchWithRetry(`/api/sessions/${sessionId}`)
                .then(sessionData => {
                    // Masquer les indicateurs de chargement
                    loadingIndicators.forEach(indicator => {
                        if (indicator) indicator.style.display = 'none';
                    });

                    // Mettre à jour les compteurs des onglets
                    const count_confirmed = sessionData.inscriptions_details.filter(i => i.statut === 'confirmé').length;
                    const count_pending = sessionData.inscriptions_details.filter(i => i.statut === 'en attente').length;
                    const count_waitlist = sessionData.liste_attente_details.length;

                    const inscritsTabBadge = modal.querySelector('#inscrits-tab' + sessionId + ' .badge');
                    const attenteTabBadge = modal.querySelector('#attente-tab' + sessionId + ' .badge');
                    const pendingTabBadge = modal.querySelector('#pending-tab' + sessionId + ' .badge');

                    if(inscritsTabBadge) inscritsTabBadge.textContent = count_confirmed;
                    if(attenteTabBadge) attenteTabBadge.textContent = count_waitlist;
                    if(pendingTabBadge) pendingTabBadge.textContent = count_pending;

                    // --- Re-générer les listes ---
                    const confirmedListBody = modal.querySelector(`#inscrits-list-${sessionId}`);
                    const pendingListBody = modal.querySelector(`#pending-list-${sessionId}`);
                    const waitlistListBody = modal.querySelector(`#attente-list-${sessionId}`);

                    // Liste des Confirmés
                    if (confirmedListBody) {
                        confirmedListBody.innerHTML = '';
                        const confirmedInscriptions = sessionData.inscriptions_details.filter(i => i.statut === 'confirmé');
                        
                        if (confirmedInscriptions.length > 0) {
                            confirmedInscriptions.forEach(inscription => {
                                const tr = document.createElement('tr');
                                tr.dataset.inscriptionId = inscription.id;
                                tr.innerHTML = `
                                    <td>${inscription.participant}</td>
                                    <td><span class="text-muted small">N/A</span></td>
                                    <td><span class="text-muted small">N/A</span></td>
                                    <td class="actions-cell">
                                        <a href="/generer_invitation/${inscription.id}" class="btn btn-sm btn-outline-primary" target="_blank" title="Invitation Outlook"><i class="far fa-calendar-plus"></i></a>
                                    </td>`;
                                confirmedListBody.appendChild(tr);
                            });
                        } else {
                            confirmedListBody.innerHTML = '<tr><td colspan="4"><div class="alert alert-light text-center border mt-2 small p-1"><i class="fas fa-info-circle me-2"></i>Aucun confirmé.</div></td></tr>';
                        }
                    }

                    // Liste En Attente de Validation
                    if (pendingListBody) {
                        pendingListBody.innerHTML = '';
                        const pendingInscriptions = sessionData.inscriptions_details.filter(i => i.statut === 'en attente');
                        
                        if (pendingInscriptions.length > 0) {
                            pendingInscriptions.forEach(inscription => {
                                const tr = document.createElement('tr');
                                tr.dataset.inscriptionId = inscription.id;
                                tr.innerHTML = `
                                    <td>${inscription.participant}</td>
                                    <td><span class="text-muted small">N/A</span></td>
                                    <td><span class="text-muted small">N/A</span></td>
                                    <td class="actions-cell"><span class="text-muted small">Validation...</span></td>`;
                                pendingListBody.appendChild(tr);
                            });
                        } else {
                            pendingListBody.innerHTML = '<tr><td colspan="4"><div class="alert alert-light text-center border mt-2 small p-1"><i class="fas fa-info-circle me-2"></i>Aucun en attente.</div></td></tr>';
                        }
                    }

                    // Liste d'Attente
                    if (waitlistListBody) {
                        waitlistListBody.innerHTML = '';
                        const waitlistEntries = sessionData.liste_attente_details;
                        
                        if (waitlistEntries.length > 0) {
                            waitlistEntries.forEach(attente => {
                                const tr = document.createElement('tr');
                                tr.dataset.attenteId = attente.id;
                                tr.innerHTML = `
                                    <td><span class="badge bg-secondary">${attente.position}</span></td>
                                    <td>${attente.participant}</td>
                                    <td><span class="text-muted small">N/A</span></td>
                                    <td><span class="text-muted small">N/A</span></td>
                                    <td><span class="badge bg-light text-dark border">En attente</span></td>
                                    ${document.getElementById('user-id') && document.getElementById('user-id').dataset.role === 'admin' ? '<td class="actions-cell"><span class="text-muted fst-italic small">Gérer...</span></td>' : ''}
                                `;
                                waitlistListBody.appendChild(tr);
                            });
                        } else {
                            waitlistListBody.innerHTML = '<tr><td colspan="5"><div class="alert alert-light text-center border mt-2 small p-1"><i class="fas fa-info-circle me-2"></i>Aucune liste d\'attente.</div></td></tr>';
                        }
                    }
                })
                .catch(error => {
                    console.error(`Error updating modal data for session ${sessionId}:`, error);
                    // Masquer les indicateurs de chargement
                    loadingIndicators.forEach(indicator => {
                        if (indicator) indicator.style.display = 'none';
                    });
                    
                    // Afficher un message d'erreur dans chaque liste
                    const lists = [
                        modal.querySelector(`#inscrits-list-${sessionId}`),
                        modal.querySelector(`#pending-list-${sessionId}`),
                        modal.querySelector(`#attente-list-${sessionId}`)
                    ];
                    
                    lists.forEach(list => {
                        if (list) {
                            list.innerHTML = '<tr><td colspan="5"><div class="alert alert-danger text-center border mt-2 small p-1"><i class="fas fa-exclamation-circle me-2"></i>Erreur chargement données.</div></td></tr>';
                        }
                    });
                });
        }

        // Activity Feed Management

        function getIconForActivity(type) { 
            switch (type) { 
                case 'inscription': return 'fas fa-user-plus text-success'; 
                case 'validation': return 'fas fa-check-circle text-primary'; 
                case 'refus': return 'fas fa-times-circle text-danger'; 
                case 'annulation': return 'fas fa-user-minus text-danger'; 
                case 'liste_attente': return 'fas fa-clock text-warning'; 
                case 'attribution_salle': return 'fas fa-building text-info'; 
                case 'ajout_participant': return 'fas fa-user-plus text-success'; 
                case 'modification_participant': return 'fas fa-user-edit text-success'; 
                case 'ajout_salle': return 'fas fa-building text-info'; 
                case 'modification_salle': return 'fas fa-edit text-info'; 
                case 'ajout_theme': return 'fas fa-book text-warning'; 
                case 'modification_theme': return 'fas fa-edit text-warning'; 
                case 'connexion': return 'fas fa-sign-in-alt text-primary'; 
                case 'deconnexion': return 'fas fa-sign-out-alt text-secondary'; 
                case 'systeme': return 'fas fa-cogs text-secondary'; 
                case 'notification': return 'fas fa-bell text-warning'; 
                case 'telecharger_invitation': return 'far fa-calendar-plus text-primary'; 
                default: return 'fas fa-info-circle text-secondary'; 
            } 
        }
        
        function prependRecentActivity(activite) { 
            const activitesLists = document.querySelectorAll('#recent-activity, #recent-activity-admin'); 
            if (activitesLists.length === 0) return; 
            
            const icon = getIconForActivity(activite.type); 
            const titre = activite.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); 
            const activityHTML = `
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1 small fw-bold">
                        <i class="${icon} me-2 fa-fw"></i>${titre}
                    </h6>
                    <small class="text-muted text-nowrap">
                        ${activite.date_relative || 'à l\'instant'}
                    </small>
                </div>
                <p class="mb-1 small">${activite.description}</p>
                ${activite.details ? `<small class="text-muted">${activite.details}</small>` : ''}
            `; 
            
            activitesLists.forEach(list => { 
                const activityItem = document.createElement('div'); 
                activityItem.className = 'list-group-item list-group-item-action px-0 py-2 border-0'; 
                activityItem.innerHTML = activityHTML; 
                activityItem.style.opacity = '0'; 
                activityItem.style.transition = 'opacity 0.5s ease-in-out'; 
                list.insertBefore(activityItem, list.firstChild); 
                setTimeout(() => activityItem.style.opacity = '1', 10); 
                
                // Limiter à 5 activités
                while (list.children.length > 5) { 
                    list.removeChild(list.lastChild); 
                } 
            }); 
        }
        
        function refreshRecentActivity() { 
            const activitesLists = document.querySelectorAll('#recent-activity, #recent-activity-admin'); 
            if (activitesLists.length === 0) return; 
            
            // Afficher un indicateur de chargement
            activitesLists.forEach(list => {
                list.innerHTML = '<div class="list-group-item px-0 border-0 text-center py-3"><div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div> Chargement...</div>';
            });
            
            fetchWithRetry('/api/activites')
                .then(data => { 
                    activitesLists.forEach(list => { 
                        list.innerHTML = ''; 
                        const activities = data.slice(0, 5); 
                        
                        if (activities.length > 0) { 
                            activities.forEach(activite => { 
                                const icon = getIconForActivity(activite.type); 
                                const titre = activite.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); 
                                const activityItem = document.createElement('div'); 
                                activityItem.className = 'list-group-item list-group-item-action px-0 py-2 border-0'; 
                                activityItem.innerHTML = `
                                    <div class="d-flex w-100 justify-content-between">
                                        <h6 class="mb-1 small fw-bold"><i class="${icon} me-2 fa-fw"></i>${titre}</h6>
                                        <small class="text-muted text-nowrap">${activite.date_relative}</small>
                                    </div>
                                    <p class="mb-1 small">${activite.description}</p>
                                    ${activite.details ? `<small class="text-muted">${activite.details}</small>` : ''}
                                `; 
                                list.appendChild(activityItem); 
                            }); 
                        } else { 
                            list.innerHTML = '<div class="list-group-item px-0 border-0 text-center text-muted fst-italic py-3">Aucune activité récente.</div>'; 
                        } 
                    }); 
                })
                .catch(error => { 
                    console.error('Erreur MàJ activités:', error); 
                    activitesLists.forEach(list => { 
                        list.innerHTML = `
                            <div class="list-group-item px-0 border-0 text-center text-danger py-3">
                                <i class="fas fa-exclamation-circle me-2"></i>Erreur chargement.
                                <div class="mt-2">
                                    <button class="btn btn-sm btn-outline-primary" onclick="refreshRecentActivity()">
                                        <i class="fas fa-sync-alt me-1"></i>Réessayer
                                    </button>
                                </div>
                            </div>`; 
                    }); 
                }); 
        }

        // --- Initialisation des graphiques ---
        // Cette fonction est appelée par le système de graphiques externe (charts.js)
        // ou directement si ce module n'est pas disponible
        async function initializeCharts() {
            if (typeof window.chartModule !== 'undefined' && window.chartModule.initialize) {
                return window.chartModule.initialize();
            }
            
            console.log('Module de graphiques externe non trouvé, pas d\'initialisation de graphiques');
            return false;
        }

        // Export des fonctions pour utilisation externe
        window.refreshRecentActivity = refreshRecentActivity;
        window.updateStatsCounters = updateStatsCounters;
        window.updateParticipantModalData = updateParticipantModalData;
        window.animateCounter = animateCounter;
        window.fetchWithRetry = fetchWithRetry;

    } catch (error) {
        console.error("Erreur majeure dans websocket.js:", error);
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger m-3';
        errorDiv.innerHTML = '<strong>Erreur Critique:</strong> Impossible d\'initialiser les fonctionnalités temps réel. Veuillez recharger la page.';
        document.body.prepend(errorDiv);
    }
});