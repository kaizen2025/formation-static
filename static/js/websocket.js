/**
 * Formation Microsoft 365 - websocket.js (version améliorée)
 * Implémente la communication en temps réel et les graphiques
 * v1.3.0
 */

const config = {
    debugMode: false // Mettre à true dans la console pour logs détaillés
};

document.addEventListener('DOMContentLoaded', function() {
    console.log('WebSocket Initializing...');
    try {
        const socket = io({
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 10000,
            timeout: 20000,
            transports: ['websocket', 'polling'] // Autoriser polling en fallback
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
            initializeCharts(); // Initialiser/MàJ les graphiques
            refreshRecentActivity(); // Charger l'activité récente
            updateStatsCounters(); // Charger les compteurs stats
        });

        socket.on('heartbeat_response', function(data) { if (config.debugMode) console.log('Heartbeat received:', data); });
        socket.on('disconnect', function(reason) { console.log('WebSocket Disconnected:', reason); if (typeof showToast === 'function') showToast('Connexion serveur perdue...', 'warning'); clearInterval(heartbeatInterval); });
        socket.on('reconnect', function(attemptNumber) { console.log(`WebSocket Reconnected (attempt ${attemptNumber})`); if (typeof showToast === 'function') showToast('Connexion rétablie.', 'success'); startHeartbeat(); initializeCharts(); refreshRecentActivity(); updateStatsCounters(); });
        socket.on('reconnect_failed', function() { console.error('WebSocket Reconnect Failed'); if (typeof showToast === 'function') showToast('Reconnexion échouée. Rechargez la page.', 'danger'); });
        socket.on('reconnect_error', function(error) { console.error('WebSocket Reconnect Error:', error); if (typeof showToast === 'function') showToast('Erreur de reconnexion.', 'danger'); });
        socket.on('connect_error', (error) => { console.error('WebSocket Connection Error:', error.message); if (typeof showToast === 'function') showToast('Erreur de connexion WebSocket.', 'danger'); });
        socket.on('error', function(error) { console.error('WebSocket Generic Error:', error); if (typeof showToast === 'function') showToast('Erreur WebSocket.', 'danger'); });

        // --- Custom Event Handlers ---

        socket.on('notification', function(data) {
            console.log('Notification received:', data);
            if (typeof showToast === 'function') showToast(data.message, data.type || 'info');
            if (data.event === 'place_disponible') {
                updateSessionPlaces(data.session_id); // Met à jour l'affichage des places
            }
        });

        socket.on('inscription_nouvelle', function(data) {
            console.log('Inscription nouvelle:', data);
            updateSessionPlaces(data.session_id); // Met à jour l'affichage des places (même si pas encore confirmé)
            updateStatsCounters(['total_en_attente']); // Le total en attente peut changer
            refreshRecentActivity();
            updateParticipantModalData(data.session_id); // Met à jour la modale si ouverte
        });

        socket.on('inscription_validee', function(data) {
            console.log('Inscription validée:', data);
            updateInscriptionStatus(data.inscription_id, 'confirmé'); // Met à jour le statut dans la modale si ouverte
            updateStatsCounters(['total_inscriptions', 'total_sessions_completes']); // Met à jour les compteurs globaux
            updateSessionPlaces(data.session_id); // Recalcule et met à jour les places
            refreshRecentActivity();
            updateParticipantModalData(data.session_id); // Met à jour la modale si ouverte
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
            updateWaitlistCounters(data.session_id, data.total_session_attente); // Met à jour compteur spécifique session
            updateStatsCounters(['total_en_attente']); // Met à jour compteur global
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
             prependRecentActivity(data); // Ajoute au début du flux d'activité
        });


        // --- UI Update Functions ---

        function updateStatsCounters(counterIds = ['total_inscriptions', 'total_en_attente', 'total_sessions_completes', 'sessions_programmees', 'counter-participants', 'counter-salles', 'counter-capacite', 'counter-themes', 'counter-services']) {
            Promise.all([
                fetch('/api/sessions').then(res => res.ok ? res.json() : Promise.reject('API Sessions failed')),
                fetch('/api/participants').then(res => res.ok ? res.json() : Promise.reject('API Participants failed')),
                fetch('/api/salles').then(res => res.ok ? res.json() : Promise.reject('API Salles failed')),
            ]).then(([sessionsData, participantsData, sallesData]) => {
                 if (counterIds.includes('sessions_programmees')) updateCounter('sessions_programmees', sessionsData.length);
                 if (counterIds.includes('total_sessions_completes')) updateCounter('total_sessions_completes', sessionsData.filter(s => s.places_restantes === 0).length);
                 if (counterIds.includes('total_inscriptions')) updateCounter('total_inscriptions', sessionsData.reduce((sum, s) => sum + s.inscrits, 0));
                 if (counterIds.includes('total_en_attente')) updateCounter('total_en_attente', sessionsData.reduce((sum, s) => sum + s.liste_attente, 0));
                 if (counterIds.includes('counter-participants')) updateCounter('counter-participants', participantsData.length);
                 if (counterIds.includes('counter-salles')) updateCounter('counter-salles', sallesData.length);
                 if (counterIds.includes('counter-capacite')) updateCounter('counter-capacite', sallesData.reduce((sum, s) => sum + s.capacite, 0));
                 // Les compteurs thèmes/services sont souvent statiques, mais pourraient être mis à jour si nécessaire
            }).catch(error => console.error('Erreur MàJ compteurs:', error));
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
            const duration = 700; const steps = 15;
             const increment = (endValue - startValue) / steps;
             let current = startValue; let stepCount = 0;
             const interval = duration / steps;
             const timer = setInterval(() => {
                 current += increment; stepCount++;
                 if (stepCount >= steps || (increment > 0 && current >= endValue) || (increment < 0 && current <= endValue)) {
                     clearInterval(timer); element.textContent = endValue;
                 } else { element.textContent = Math.round(current); }
             }, interval);
         }

        function updateSessionPlaces(sessionId, placesRestantes = null) {
            // Si placesRestantes n'est pas fourni, on doit fetch pour le recalculer
            const apiUrl = placesRestantes === null ? `/api/sessions/${sessionId}` : null; // Fetch specific session if needed

            const updateLogic = (session) => {
                updatePlacesDisplay(
                    session.id,
                    placesRestantes !== null ? placesRestantes : session.places_restantes,
                    session.inscrits,
                    session.max_participants
                );
            };

            if (apiUrl) {
                fetch(apiUrl)
                    .then(response => response.ok ? response.json() : Promise.reject(`Failed fetch: ${apiUrl}`))
                    .then(sessionData => updateLogic(sessionData))
                    .catch(error => console.error('Erreur MàJ places session (fetch):', error));
            } else if (sessionId && placesRestantes !== null) {
                // On a déjà les places, mais il faut les inscrits/max pour updatePlacesDisplay
                // Solution simple : on fetch quand même pour avoir toutes les infos à jour
                 fetch(`/api/sessions/${sessionId}`)
                    .then(response => response.ok ? response.json() : Promise.reject(`Failed fetch: /api/sessions/${sessionId}`))
                    .then(sessionData => {
                         updatePlacesDisplay( sessionData.id, placesRestantes, sessionData.inscrits, sessionData.max_participants );
                    })
                    .catch(error => console.error('Erreur MàJ places session (fetch for counts):', error));
            }
        }

        function updatePlacesDisplay(sessionId, places, inscrits, max) {
             const placesElements = document.querySelectorAll(`.places-dispo[data-session-id="${sessionId}"]`);
             placesElements.forEach(el => {
                 el.innerHTML = `<strong>${places}</strong>`; // Afficher en gras
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
                 if (parentButton) { parentButton.style.display = (totalSessionAttente > 0) ? '' : 'none'; }
             });
        }

         function updateSalleDisplay(sessionId, salleNom) {
             const salleElements = document.querySelectorAll(`.salle-badge[data-session-id="${sessionId}"]`);
             salleElements.forEach(el => {
                if (salleNom) { el.textContent = salleNom; el.className = 'badge bg-info text-dark salle-badge'; }
                else { el.textContent = 'Non définie'; el.className = 'badge bg-secondary salle-badge'; }
             });
         }

         function updateInscriptionStatus(inscriptionId, status) {
            const modalRow = document.querySelector(`.modal.show tr[data-inscription-id="${inscriptionId}"]`);
            if (modalRow) {
                 const statusCell = modalRow.querySelector('.badge'); // Simplifié, peut nécessiter ajustement
                 const actionsCell = modalRow.querySelector('.actions-cell');
                 if (statusCell) {
                     statusCell.textContent = status.charAt(0).toUpperCase() + status.slice(1);
                     statusCell.className = `badge rounded-pill ${status === 'confirmé' ? 'bg-success' : (status === 'annulé' || status === 'refusé' ? 'bg-danger' : 'bg-warning text-dark')}`;
                 }
                 if (actionsCell) {
                    actionsCell.innerHTML = ''; // Vider
                     if (status === 'confirmé') {
                         actionsCell.innerHTML = `<a href="/generer_invitation/${inscriptionId}" class="btn btn-sm btn-outline-primary" target="_blank" title="Invitation Outlook"><i class="far fa-calendar-plus"></i></a>`;
                     } else if (status === 'en attente') {
                         actionsCell.innerHTML = `<span class="text-muted small">Validation...</span>`; // Placeholder
                     } // Laisser vide pour refusé/annulé
                 }
                 // Rafraîchir toute la modale pour assurer la cohérence des listes/comptes
                 const modal = modalRow.closest('.modal');
                 if (modal && modal.id.startsWith('participantsModal')) {
                     const sessionId = modal.id.replace('participantsModal', '');
                     updateParticipantModalData(sessionId);
                 }
            }
        }

        // Met à jour le contenu de la modale Participants/Attente
        function updateParticipantModalData(sessionId) {
            const modal = document.getElementById(`participantsModal${sessionId}`);
            // Ne met à jour que si la modale est actuellement affichée pour éviter travail inutile
            if (!modal || !modal.classList.contains('show')) return;

            if (config.debugMode) console.log(`Updating modal data for session ${sessionId}`);

            // Utiliser l'API détaillée pour une session
            fetch(`/api/sessions/${sessionId}`)
                .then(response => response.ok ? response.json() : Promise.reject('Failed fetch session details for modal'))
                .then(sessionData => {
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
                        confirmedListBody.innerHTML = ''; // Vider
                        const confirmedInscriptions = sessionData.inscriptions_details.filter(i => i.statut === 'confirmé');
                        // TODO: Trier si nécessaire (l'API devrait idéalement le faire)
                        if (confirmedInscriptions.length > 0) {
                            confirmedInscriptions.forEach(inscription => {
                                const tr = document.createElement('tr');
                                tr.dataset.inscriptionId = inscription.id;
                                // Note: L'API /api/sessions/<id> ne renvoie pas service/email, il faudrait l'ajouter ou simplifier l'affichage ici
                                tr.innerHTML = `
                                    <td>${inscription.participant}</td>
                                    <td><span class="text-muted small">N/A</span></td>
                                    <td><span class="text-muted small">N/A</span></td>
                                    <td class="actions-cell">
                                        <a href="/generer_invitation/${inscription.id}" class="btn btn-sm btn-outline-primary" target="_blank" title="Invitation Outlook"><i class="far fa-calendar-plus"></i></a>
                                        <!-- TODO: Add admin cancel button logic -->
                                    </td>`;
                                confirmedListBody.appendChild(tr);
                            });
                        } else { confirmedListBody.innerHTML = '<tr><td colspan="4"><div class="alert alert-light text-center border mt-2 small p-1"><i class="fas fa-info-circle me-2"></i>Aucun confirmé.</div></td></tr>'; }
                    }

                    // Liste En Attente de Validation
                    if (pendingListBody) {
                        pendingListBody.innerHTML = ''; // Vider
                        const pendingInscriptions = sessionData.inscriptions_details.filter(i => i.statut === 'en attente');
                        // TODO: Trier si nécessaire
                        if (pendingInscriptions.length > 0) {
                            pendingInscriptions.forEach(inscription => {
                                const tr = document.createElement('tr');
                                tr.dataset.inscriptionId = inscription.id;
                                // TODO: Ajouter date inscription si disponible dans API
                                tr.innerHTML = `
                                    <td>${inscription.participant}</td>
                                    <td><span class="text-muted small">N/A</span></td>
                                    <td><span class="text-muted small">N/A</span></td>
                                    <td class="actions-cell"><span class="text-muted small">Validation...</span></td>`; // Placeholder actions
                                pendingListBody.appendChild(tr);
                            });
                        } else { pendingListBody.innerHTML = '<tr><td colspan="4"><div class="alert alert-light text-center border mt-2 small p-1"><i class="fas fa-info-circle me-2"></i>Aucun en attente.</div></td></tr>'; }
                    }

                    // Liste d'Attente
                    if (waitlistListBody) {
                        waitlistListBody.innerHTML = ''; // Vider
                        const waitlistEntries = sessionData.liste_attente_details; // API should return sorted by position
                        if (waitlistEntries.length > 0) {
                            waitlistEntries.forEach(attente => {
                                const tr = document.createElement('tr');
                                tr.dataset.attenteId = attente.id;
                                // TODO: Ajouter service/date si disponible dans API
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
                        } else { waitlistListBody.innerHTML = '<tr><td colspan="5"><div class="alert alert-light text-center border mt-2 small p-1"><i class="fas fa-info-circle me-2"></i>Aucune liste d\'attente.</div></td></tr>'; }
                    }

                })
                .catch(error => console.error(`Error updating modal data for session ${sessionId}:`, error));
        }

        // Activity Feed Update
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
            
            fetch('/api/activites')
                .then(response => response.ok ? response.json() : Promise.reject('Failed activity fetch'))
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
                        list.innerHTML = '<div class="list-group-item px-0 border-0 text-center text-danger py-3">Erreur chargement.</div>'; 
                    }); 
                }); 
        }

        // ***** Chart Initialization and Update (AMÉLIORATION) *****
        // Stockage des instances de graphiques (pour pouvoir les détruire correctement)
        let themeChartInstance = null;
        let serviceChartInstance = null;

        async function initializeCharts() {
            console.log('Initialisation des graphiques...');
            
            // Vérifier si Chart.js est disponible
            if (typeof Chart === 'undefined') {
                console.error("Chart.js n'est pas chargé!");
                const overlays = document.querySelectorAll('#theme-chart-overlay, #service-chart-overlay');
                overlays.forEach(overlay => {
                    if (overlay) overlay.innerHTML = '<p class="text-danger">Erreur: Chart.js manquant</p>';
                });
                return false;
            }
            
            const themeChartCanvas = document.getElementById('themeChart');
            const serviceChartCanvas = document.getElementById('serviceChart');
            const themeOverlay = document.getElementById('theme-chart-overlay');
            const serviceOverlay = document.getElementById('service-chart-overlay');

            if(themeOverlay) themeOverlay.classList.remove('d-none');
            if(serviceOverlay) serviceOverlay.classList.remove('d-none');

            try {
                // Récupérer les données
                const [sessionsData, participantsData] = await Promise.all([
                    fetch('/api/sessions').then(res => res.ok ? res.json() : Promise.reject('API Sessions failed')),
                    fetch('/api/participants').then(res => res.ok ? res.json() : Promise.reject('API Participants failed'))
                ]);
                
                if (config.debugMode) console.log('Chart data fetched:', { sessionsData, participantsData });

                // --- Traitement des données du graphique Thème ---
                if (themeChartCanvas) {
                    try {
                        // CORRECTION : Détruire explicitement le graphique existant
                        if (themeChartInstance) {
                            themeChartInstance.destroy();
                            themeChartInstance = null;
                        }
                        
                        // Traitement des données pour le graphique Thème
                        const themeCounts = {};
                        sessionsData.forEach(session => { 
                            if (session.inscrits > 0) { 
                                themeCounts[session.theme] = (themeCounts[session.theme] || 0) + session.inscrits; 
                            } 
                        });
                        
                        const themeLabels = Object.keys(themeCounts); 
                        const themeValues = Object.values(themeCounts);
                        const themeColors = themeLabels.map(label => {
                            try {
                                if (label.includes('Teams')) return getComputedStyle(document.documentElement).getPropertyValue('--theme-teams').trim() || '#0078d4';
                                if (label.includes('Planner')) return getComputedStyle(document.documentElement).getPropertyValue('--theme-planner').trim() || '#7719aa';
                                if (label.includes('OneDrive')) return getComputedStyle(document.documentElement).getPropertyValue('--theme-onedrive').trim() || '#0364b8';
                                if (label.includes('Collaborer')) return getComputedStyle(document.documentElement).getPropertyValue('--theme-sharepoint').trim() || '#038387';
                            } catch(e) { /* Ignore error */ } 
                            return '#cccccc';
                        });
                        
                        const themeChartData = { 
                            labels: themeLabels, 
                            datasets: [{ 
                                data: themeValues, 
                                backgroundColor: themeColors, 
                                borderColor: '#fff', 
                                borderWidth: 1 
                            }] 
                        };
                        
                        // Création du graphique
                        const themeCtx = themeChartCanvas.getContext('2d');
                        themeChartInstance = new Chart(themeCtx, { 
                            type: 'doughnut', 
                            data: themeChartData, 
                            options: { 
                                responsive: true, 
                                maintainAspectRatio: false, 
                                cutout: '60%', 
                                plugins: { 
                                    legend: { 
                                        position: 'bottom', 
                                        labels: { 
                                            boxWidth: 12, 
                                            padding: 15 
                                        } 
                                    }, 
                                    tooltip: { 
                                        callbacks: { 
                                            label: (c) => `${c.label}: ${c.raw}` 
                                        } 
                                    } 
                                }, 
                                animation: { 
                                    duration: 500 
                                } 
                            } 
                        });
                        
                        if(themeOverlay) themeOverlay.classList.add('d-none');
                        if (config.debugMode) console.log('Theme chart updated.');
                    } catch (themeError) {
                        console.error('Error creating theme chart:', themeError);
                        if(themeOverlay) {
                            themeOverlay.innerHTML = '<p class="text-danger small p-2">Erreur graphique thème.</p>';
                            themeOverlay.classList.remove('d-none');
                        }
                    }
                }

                // --- Traitement des données du graphique Service (CORRIGÉ) ---
                if (serviceChartCanvas) {
                    try {
                        // CORRECTION : Détruire explicitement le graphique existant
                        if (serviceChartInstance) {
                            serviceChartInstance.destroy();
                            serviceChartInstance = null;
                        }
                        
                        // NOUVELLE APPROCHE: Compter les participants uniques et les inscriptions
                        // Structure de données: Map des services avec participants uniques (Set)
                        const serviceMap = {};
                        
                        // Première passe : Initialiser les services et leurs participants uniques
                        participantsData.forEach(participant => {
                            if (!participant.service_id || !participant.service) continue;
                            
                            if (!serviceMap[participant.service_id]) {
                                serviceMap[participant.service_id] = {
                                    nom: participant.service,
                                    uniqueParticipants: new Set(), // Ensemble pour assurer l'unicité
                                    totalInscriptions: 0,
                                    color: getServiceColor(participant.service)
                                };
                            }
                            
                            // Ajouter le participant à son service (uniquement une fois grâce au Set)
                            serviceMap[participant.service_id].uniqueParticipants.add(participant.id);
                            
                            // Compter les inscriptions confirmées
                            const inscriptionsCount = participant.inscriptions || 0;
                            serviceMap[participant.service_id].totalInscriptions += inscriptionsCount;
                        });
                        
                        // Préparer les données pour le graphique
                        const serviceLabels = [];
                        const uniqueCounts = [];
                        const inscriptionCounts = [];
                        const colors = [];
                        
                        // Extraire et trier par nom de service
                        Object.values(serviceMap)
                            .filter(s => s.uniqueParticipants.size > 0) // Exclure les services sans participants
                            .sort((a, b) => a.nom.localeCompare(b.nom))
                            .forEach(service => {
                                serviceLabels.push(service.nom);
                                uniqueCounts.push(service.uniqueParticipants.size);
                                inscriptionCounts.push(service.totalInscriptions);
                                colors.push(service.color);
                            });
                        
                        // Configuration du graphique
                        const serviceChartData = {
                            labels: serviceLabels,
                            datasets: [{
                                label: 'Participants uniques', // Label corrigé
                                data: uniqueCounts, // Données de participants uniques
                                backgroundColor: colors,
                                borderWidth: 1
                            }]
                        };
                        
                        // Création du graphique
                        const serviceCtx = serviceChartCanvas.getContext('2d');
                        serviceChartInstance = new Chart(serviceCtx, {
                            type: 'bar',
                            data: serviceChartData,
                            options: {
                                responsive: true,
                                maintainAspectRatio: false,
                                indexAxis: 'y', // Barres horizontales pour meilleure lisibilité
                                plugins: {
                                    legend: {
                                        display: false
                                    },
                                    tooltip: {
                                        callbacks: {
                                            label: function(context) {
                                                const index = context.dataIndex;
                                                return [
                                                    `${serviceLabels[index]}`,
                                                    `Participants uniques: ${uniqueCounts[index]}`,
                                                    `Inscriptions: ${inscriptionCounts[index]}`
                                                ];
                                            }
                                        }
                                    }
                                },
                                scales: {
                                    x: {
                                        beginAtZero: true,
                                        ticks: {
                                            stepSize: 1,
                                            precision: 0 // Nombres entiers uniquement
                                        }
                                    }
                                },
                                animation: {
                                    duration: 500
                                }
                            }
                        });
                        
                        if(serviceOverlay) serviceOverlay.classList.add('d-none');
                        if (config.debugMode) console.log('Service chart updated with unique participants.');
                    } catch (serviceError) {
                        console.error('Error creating service chart:', serviceError);
                        if(serviceOverlay) {
                            serviceOverlay.innerHTML = '<p class="text-danger small p-2">Erreur graphique service.</p>';
                            serviceOverlay.classList.remove('d-none');
                        }
                    }
                }

                console.log('Tous les graphiques initialisés avec succès');
                return true;
            } catch (error) {
                console.error('Erreur chargement données graphiques:', error);
                if(themeOverlay) { 
                    themeOverlay.innerHTML = '<p class="text-danger small p-2">Erreur chargement données.</p>'; 
                    themeOverlay.classList.remove('d-none'); 
                }
                if(serviceOverlay) { 
                    serviceOverlay.innerHTML = '<p class="text-danger small p-2">Erreur chargement données.</p>'; 
                    serviceOverlay.classList.remove('d-none'); 
                }
                return false;
            }
        }

        // Fonction auxiliaire pour déterminer la couleur d'un service
        function getServiceColor(serviceName) {
            if (!serviceName) return '#cccccc';
            
            const name = serviceName.toLowerCase();
            if (name.includes('qualité') || name.includes('qualite')) return '#F44336';
            if (name.includes('commerce')) return '#FFC107';
            if (name.includes('informatique')) return '#607D8B';
            if (name.includes('rh')) return '#FF9800';
            if (name.includes('marketing')) return '#9C27B0';
            if (name.includes('comptabilité') || name.includes('comptabilite')) return '#2196F3';
            if (name.includes('florensud')) return '#4CAF50';
            return '#6c757d'; // Gris par défaut
        }

        // Initial Load Actions
        refreshRecentActivity();
        // Charts initialized on connect
        // Counters updated on connect

    } catch (error) {
        console.error("Erreur majeure dans websocket.js:", error);
         const errorDiv = document.createElement('div');
         errorDiv.className = 'alert alert-danger m-3';
         errorDiv.innerHTML = '<strong>Erreur Critique:</strong> Impossible d\'initialiser les fonctionnalités temps réel. Veuillez recharger la page.';
         document.body.prepend(errorDiv);
    }
});