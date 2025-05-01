// static/js/websocket.js

// Main WebSocket logic
document.addEventListener('DOMContentLoaded', function() {
    // Initialisation de Socket.IO avec options de reconnexion
    const socket = io({
        reconnection: true,
        reconnectionAttempts: 10, 
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 20000
    });

    // Heartbeat mechanism to keep connection alive
    let heartbeatInterval;
    function startHeartbeat() {
        heartbeatInterval = setInterval(() => {
            socket.emit('heartbeat', { timestamp: Date.now() });
        }, 30000); // Send heartbeat every 30 seconds
    }

    // Connexion établie
    socket.on('connect', function() {
        console.log('Connecté au serveur WebSocket');
        showToast('Connexion établie avec le serveur', 'success');
        
        // Rejoindre la room pour les mises à jour générales
        socket.emit('join', { room: 'general' });
        
        // Si l'utilisateur est connecté, rejoindre sa room personnelle
        const userId = document.getElementById('user-id');
        if (userId) {
            socket.emit('join', { room: `user_${userId.value}` });
        }

        // Start heartbeat
        startHeartbeat();
        
        // Initialiser les graphiques après connexion WebSocket
        initializeCharts();
    });
    
    // Réponse au heartbeat
    socket.on('heartbeat_response', function(data) {
        console.log('Heartbeat received:', data);
    });

    // Déconnexion
    socket.on('disconnect', function() {
        console.log('Déconnecté du serveur WebSocket');
        showToast('Connexion au serveur perdue, tentative de reconnexion...', 'warning');
        clearInterval(heartbeatInterval); // Stop heartbeat on disconnect
    });
    
    // Reconnexion
    socket.on('reconnect', function(attemptNumber) {
        console.log(`Reconnecté au serveur après ${attemptNumber} tentatives`);
        showToast('Connexion rétablie!', 'success');
        startHeartbeat(); // Restart heartbeat on reconnect
        
        // Réinitialiser les graphiques après reconnexion
        initializeCharts();
    });
    
    // Échec de reconnexion après toutes les tentatives
    socket.on('reconnect_failed', function() {
        console.error('Échec de la reconnexion après toutes les tentatives');
        showToast('Impossible de se reconnecter au serveur. Veuillez recharger la page.', 'danger');
    });
    
    // Erreur de reconnexion
    socket.on('reconnect_error', function(error) {
        console.error('Erreur de reconnexion:', error);
        showToast('Erreur lors de la reconnexion au serveur', 'danger');
    });

    // Gestion des erreurs WebSocket
    socket.on('error', function(error) {
        console.error('Erreur WebSocket:', error);
        showToast('Une erreur est survenue avec la connexion WebSocket', 'danger');
    });
    
    // Notification générale
    socket.on('notification', function(data) {
        try {
            // Afficher une notification toast
            showToast(data.message, data.type);
            
            // Si c'est une notification de place disponible, mettre à jour l'interface
            if (data.type === 'place_disponible') {
                // Mettre à jour le compteur de places pour la session concernée
                updateSessionPlaces(data.session_id);
                
                // Si le participant concerné est l'utilisateur actuel, afficher une notification plus visible
                const userId = document.getElementById('user-id');
                if (userId && userId.value == data.participant_id) {
                    showModal('Place disponible', 
                        `Une place s'est libérée pour la session que vous attendiez. 
                        <a href="/sessions/${data.session_id}" class="btn btn-primary mt-3">Voir la session</a>`);
                }
            }
        } catch (error) {
            console.error('Erreur lors du traitement de la notification:', error);
        }
    });
    
    // Nouvelle inscription
    socket.on('inscription_nouvelle', function(data) {
        try {
            updateSessionPlaces(data.session_id, data.places_restantes);
            updateStatsCounter('total_inscriptions');
            refreshRecentActivity();
        } catch (error) {
            console.error('Erreur lors du traitement de l\'inscription_nouvelle:', error);
        }
    });
    
    // Inscription validée
    socket.on('inscription_validee', function(data) {
        try {
            // Mettre à jour le statut de l'inscription dans l'interface
            const inscriptionElement = document.querySelector(`[data-inscription-id="${data.inscription_id}"]`);
            if (inscriptionElement) {
                const statusBadge = inscriptionElement.querySelector('.badge');
                if (statusBadge) {
                    statusBadge.textContent = 'Confirmé';
                    statusBadge.className = 'badge bg-success';
                }
                
                // Ajouter le bouton d'invitation Outlook
                const actionsCell = inscriptionElement.querySelector('.actions-cell');
                if (actionsCell) {
                    const invitationBtn = document.createElement('a');
                    invitationBtn.href = `/generer_invitation/${data.inscription_id}`;
                    invitationBtn.className = 'btn btn-sm btn-outline-primary mt-2';
                    invitationBtn.innerHTML = '<i class="far fa-calendar-plus me-1"></i> Ajouter à mon calendrier Outlook';
                    actionsCell.appendChild(invitationBtn);
                }
            }
            
            // Mettre à jour le compteur d'inscriptions
            if (data.total_inscriptions) {
                updateCounter('total_inscriptions', data.total_inscriptions);
            }
            
            // Actualiser l'activité récente
            refreshRecentActivity();
        } catch (error) {
            console.error('Erreur lors du traitement de l\'inscription_validee:', error);
        }
    });
    
    // Inscription refusée
    socket.on('inscription_refusee', function(data) {
        try {
            // Mettre à jour le statut de l'inscription dans l'interface
            const inscriptionElement = document.querySelector(`[data-inscription-id="${data.inscription_id}"]`);
            if (inscriptionElement) {
                const statusBadge = inscriptionElement.querySelector('.badge');
                if (statusBadge) {
                    statusBadge.textContent = 'Annulé';
                    statusBadge.className = 'badge bg-danger';
                }
                
                // Retirer les boutons d'action
                const actionsCell = inscriptionElement.querySelector('.actions-cell');
                if (actionsCell) {
                    actionsCell.innerHTML = '';
                }
            }
            
            // Mettre à jour les places disponibles
            updateSessionPlaces(data.session_id);
            
            // Actualiser l'activité récente
            refreshRecentActivity();
        } catch (error) {
            console.error('Erreur lors du traitement de l\'inscription_refusee:', error);
        }
    });
    
    // Nouvelle entrée en liste d'attente
    socket.on('liste_attente_nouvelle', function(data) {
        try {
            // Mettre à jour le compteur de liste d'attente pour la session
            const attenteCounter = document.querySelector(`.attente-counter[data-session-id="${data.session_id}"]`);
            if (attenteCounter) {
                const currentCount = parseInt(attenteCounter.textContent) || 0;
                attenteCounter.textContent = currentCount + 1;
            }
            
            // Mettre à jour le compteur global de liste d'attente
            if (data.total_en_attente) {
                updateCounter('total_en_attente', data.total_en_attente);
            }
            
            // Actualiser l'activité récente
            refreshRecentActivity();
        } catch (error) {
            console.error('Erreur lors du traitement de la liste_attente_nouvelle:', error);
        }
    });
    
    // Attribution de salle
    socket.on('attribution_salle', function(data) {
        try {
            // Mettre à jour le nom de la salle dans l'interface
            const salleElements = document.querySelectorAll(`.salle-badge[data-session-id="${data.session_id}"]`);
            
            salleElements.forEach(element => {
                element.textContent = data.salle_nom;
                element.classList.remove('bg-secondary');
                element.classList.add('bg-info');
            });
            
            // Actualiser l'activité récente
            refreshRecentActivity();
        } catch (error) {
            console.error('Erreur lors du traitement de l\'attribution_salle:', error);
        }
    });
    
    // Nouvelle activité
    socket.on('nouvelle_activite', function(data) {
        try {
            // Ajouter l'activité à la liste des activités récentes
            const activitesList = document.getElementById('recent-activity');
            if (activitesList) {
                // Créer un nouvel élément pour l'activité
                const newActivity = document.createElement('div');
                newActivity.className = 'list-group-item slide-in-right';
                
                // Déterminer le titre en fonction du type
                let titre = 'Nouvelle activité';
                let icon = 'fas fa-info-circle';
                
                switch (data.type) {
                    case 'inscription':
                        titre = 'Nouvelle inscription';
                        icon = 'fas fa-user-plus text-success';
                        break;
                    case 'validation':
                        titre = 'Validation d\'inscription';
                        icon = 'fas fa-check-circle text-primary';
                        break;
                    case 'refus':
                        titre = 'Refus d\'inscription';
                        icon = 'fas fa-times-circle text-danger';
                        break;
                    case 'liste_attente':
                        titre = 'Ajout en liste d\'attente';
                        icon = 'fas fa-clock text-warning';
                        break;
                    case 'attribution_salle':
                        titre = 'Attribution de salle';
                        icon = 'fas fa-building text-info';
                        break;
                    case 'ajout_participant':
                        titre = 'Nouveau participant';
                        icon = 'fas fa-user-plus text-success';
                        break;
                }
                
                // Construire le contenu
                newActivity.innerHTML = `
                    <div class="d-flex w-100 justify-content-between">
                        <h6 class="mb-1"><i class="${icon} me-2"></i>${titre}</h6>
                        <small class="text-muted">${data.date_relative || 'à l\'instant'}</small>
                    </div>
                    <p class="mb-1">${data.description}</p>
                    ${data.details ? `<small class="text-muted">${data.details}</small>` : ''}
                `;
                
                // Ajouter au début de la liste
                if (activitesList.firstChild) {
                    activitesList.insertBefore(newActivity, activitesList.firstChild);
                } else {
                    activitesList.appendChild(newActivity);
                }
                
                // Limiter à 5 activités affichées
                if (activitesList.children.length > 5) {
                    activitesList.removeChild(activitesList.lastChild);
                }
            }
        } catch (error) {
            console.error('Erreur lors du traitement de la nouvelle_activite:', error);
        }
    });
    
    // Fonction pour actualiser l'activité récente
    function refreshRecentActivity() {
        const activitesList = document.getElementById('recent-activity');
        if (!activitesList) return;
        
        fetch('/api/activites')
            .then(response => response.json())
            .then(data => {
                // Vider la liste actuelle
                activitesList.innerHTML = '';
                
                // Limiter aux 5 premières activités
                const activities = data.slice(0, 5);
                
                if (activities.length > 0) {
                    // Ajouter les activités
                    activities.forEach(activite => {
                        // Déterminer le titre et l'icône en fonction du type
                        let titre = 'Activité';
                        let icon = 'fas fa-info-circle';
                        
                        switch (activite.type) {
                            case 'inscription':
                                titre = 'Nouvelle inscription';
                                icon = 'fas fa-user-plus text-success';
                                break;
                            case 'validation':
                                titre = 'Validation d\'inscription';
                                icon = 'fas fa-check-circle text-primary';
                                break;
                            case 'refus':
                                titre = 'Refus d\'inscription';
                                icon = 'fas fa-times-circle text-danger';
                                break;
                            case 'liste_attente':
                                titre = 'Ajout en liste d\'attente';
                                icon = 'fas fa-clock text-warning';
                                break;
                            case 'attribution_salle':
                                titre = 'Attribution de salle';
                                icon = 'fas fa-building text-info';
                                break;
                            case 'ajout_participant':
                                titre = 'Nouveau participant';
                                icon = 'fas fa-user-plus text-success';
                                break;
                            case 'connexion':
                                titre = 'Connexion';
                                icon = 'fas fa-sign-in-alt text-primary';
                                break;
                            case 'deconnexion':
                                titre = 'Déconnexion';
                                icon = 'fas fa-sign-out-alt text-secondary';
                                break;
                        }
                        
                        const activityItem = document.createElement('div');
                        activityItem.className = 'list-group-item px-0';
                        activityItem.innerHTML = `
                            <div class="d-flex w-100 justify-content-between">
                                <h6 class="mb-1"><i class="${icon} me-2"></i>${titre}</h6>
                                <small class="text-muted">${activite.date_relative}</small>
                            </div>
                            <p class="mb-1">${activite.description}</p>
                            ${activite.details ? `<small class="text-muted">${activite.details}</small>` : ''}
                        `;
                        
                        activitesList.appendChild(activityItem);
                    });
                } else {
                    // Message par défaut si aucune activité
                    const defaultActivity = document.createElement('div');
                    defaultActivity.className = 'list-group-item px-0';
                    defaultActivity.innerHTML = `
                        <div class="d-flex w-100 justify-content-between">
                            <h6 class="mb-1">Bienvenue sur le dashboard</h6>
                            <small class="text-muted">à l'instant</small>
                        </div>
                        <p class="mb-1">Les activités récentes s'afficheront ici.</p>
                        <small class="text-muted">Commencez par inscrire des participants aux sessions.</small>
                    `;
                    
                    activitesList.appendChild(defaultActivity);
                }
            })
            .catch(error => console.error('Erreur lors de la récupération des activités:', error));
    }
    
    // Fonction pour mettre à jour l'affichage des places disponibles pour toutes les sessions
    function updateSessionPlaces(sessionId = null, placesRestantes = null) {
        fetch('/api/sessions')
            .then(response => response.json())
            .then(data => {
                data.forEach(session => {
                    if (!sessionId || session.id === sessionId) {
                        updatePlacesDisplay(
                            session.id,
                            sessionId && session.id === sessionId ? placesRestantes : session.places_restantes,
                            session.inscrits,
                            session.max_participants
                        );
                    }
                });
            })
            .catch(error => console.error('Erreur lors de la récupération des données des sessions:', error));
    }
    
    // Fonction pour mettre à jour l'affichage des places pour une session spécifique
    function updatePlacesDisplay(sessionId, placesRestantes, inscrits, maxParticipants) {
        // Mettre à jour tous les éléments qui affichent les places pour cette session
        const placesElements = document.querySelectorAll(`.places-dispo[data-session-id="${sessionId}"]`);
        
        placesElements.forEach(element => {
            const max = maxParticipants || parseInt(element.getAttribute('data-max-participants') || 15);
            element.textContent = `${placesRestantes} / ${max}`;
            
            element.classList.remove('text-success', 'text-warning', 'text-danger');
            if (placesRestantes <= 3) {
                element.classList.add('text-danger');
            } else if (placesRestantes <= 7) {
                element.classList.add('text-warning');
            } else {
                element.classList.add('text-success');
            }
        });
        
        // Mettre à jour les compteurs d'inscrits
        const inscritsElements = document.querySelectorAll(`.inscrits-count[data-session-id="${sessionId}"]`);
        inscritsElements.forEach(element => {
            element.textContent = inscrits || 0;
        });
        
        // Mettre à jour les barres de progression
        const progressBars = document.querySelectorAll(`.progress-bar[data-session-id="${sessionId}"]`);
        progressBars.forEach(bar => {
            const max = maxParticipants || parseInt(bar.getAttribute('data-max-participants') || 15);
            const inscr = inscrits || (max - placesRestantes);
            const progressPercent = (inscr / max) * 100;
            
            bar.style.width = `${progressPercent}%`;
            bar.textContent = `${inscr} / ${max}`;
            
            bar.classList.remove('bg-success', 'bg-warning', 'bg-danger');
            if (placesRestantes <= 3) {
                bar.classList.add('bg-danger');
            } else if (placesRestantes <= 7) {
                bar.classList.add('bg-warning');
            } else {
                bar.classList.add('bg-success');
            }
        });
        
        // Mettre à jour les boutons d'inscription
        const sessionRows = document.querySelectorAll(`[data-session-id="${sessionId}"]`);
        sessionRows.forEach(row => {
            const inscriptionBtn = row.querySelector('.btn-inscription');
            const listeAttenteBtn = row.querySelector('.btn-liste-attente');
            
            if (inscriptionBtn && listeAttenteBtn) {
                if (placesRestantes > 0) {
                    inscriptionBtn.style.display = '';
                    listeAttenteBtn.style.display = 'none';
                } else {
                    inscriptionBtn.style.display = 'none';
                    listeAttenteBtn.style.display = '';
                }
            }
        });
    }
    
    // Fonction pour mettre à jour tous les compteurs
    function updateCounters() {
        fetch('/api/sessions')
            .then(response => response.json())
            .then(data => {
                const sessionsCompletes = data.filter(session => session.places_restantes === 0).length;
                updateCounter('total_sessions_completes', sessionsCompletes);
                updateCounter('sessions_programmees', data.length);
                const totalInscrits = data.reduce((total, session) => total + session.inscrits, 0);
                updateCounter('total_inscriptions', totalInscrits);
                const totalAttente = data.reduce((total, session) => total + (session.liste_attente || 0), 0);
                updateCounter('total_en_attente', totalAttente);
            })
            .catch(error => console.error('Erreur lors de la récupération des données des sessions:', error));
        
        fetch('/api/participants')
            .then(response => response.json())
            .then(data => {
                updateCounter('participants_inscrits', data.length);
            })
            .catch(error => console.error('Erreur lors de la récupération des données des participants:', error));
    }
    
    // Fonction pour mettre à jour un compteur spécifique
    function updateCounter(id, value) {
        const counters = document.querySelectorAll(`.counter-${id}, #${id}`);
        counters.forEach(counter => {
            const currentValue = parseInt(counter.textContent) || 0;
            animateCounter(counter, currentValue, value);
        });
    }
    
    // Fonction pour animer un compteur
    function animateCounter(element, startValue, endValue) {
        if (startValue === endValue) return;
        
        const duration = 1000;
        const steps = 20;
        const increment = (endValue - startValue) / steps;
        let current = startValue;
        const interval = duration / steps;
        
        const timer = setInterval(() => {
            current += increment;
            if ((increment > 0 && current >= endValue) || (increment < 0 && current <= endValue)) {
                clearInterval(timer);
                element.textContent = endValue;
            } else {
                element.textContent = Math.round(current);
            }
        }, interval);
    }
    
    // Fonction pour afficher un toast
    function showToast(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            // Utiliser la fonction globale si disponible
            window.showToast(message, type);
        } else {
            // Fallback si la fonction globale n'est pas disponible
            const toastContainer = document.getElementById('toast-container');
            if (!toastContainer) return;
            
            const toastId = `toast-${Date.now()}`;
            const toastElement = document.createElement('div');
            toastElement.id = toastId;
            toastElement.className = `toast align-items-center text-white bg-${type} border-0`;
            toastElement.setAttribute('role', 'alert');
            toastElement.setAttribute('aria-live', 'assertive');
            toastElement.setAttribute('aria-atomic', 'true');
            
            // Déterminer l'icône en fonction du type
            let icon = 'fas fa-info-circle';
            switch (type) {
                case 'success':
                    icon = 'fas fa-check-circle';
                    break;
                case 'danger':
                    icon = 'fas fa-exclamation-circle';
                    break;
                case 'warning':
                    icon = 'fas fa-exclamation-triangle';
                    break;
            }
            
            toastElement.innerHTML = `
                <div class="d-flex">
                    <div class="toast-body">
                        <i class="${icon} me-2"></i>${message}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            `;
            
            toastContainer.appendChild(toastElement);
            
            // Initialiser et afficher le toast
            if (typeof bootstrap !== 'undefined') {
                const toast = new bootstrap.Toast(toastElement, { autohide: true, delay: 5000 });
                toast.show();
            } else {
                // Fallback si Bootstrap n'est pas disponible
                setTimeout(() => {
                    toastElement.remove();
                }, 5000);
            }
        }
    }
    
    // Fonction pour afficher une modal
    function showModal(title, content) {
        // Cette fonction est un fallback simple, les modales sont maintenant gérées par modal-fix-extreme.js
        let modalElement = document.getElementById('dynamic-modal');
        
        if (!modalElement) {
            modalElement = document.createElement('div');
            modalElement.id = 'dynamic-modal';
            modalElement.className = 'modal fade';
            modalElement.setAttribute('tabindex', '-1');
            modalElement.setAttribute('aria-hidden', 'true');
            
            modalElement.innerHTML = `
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"></h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body"></div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modalElement);
        }
        
        modalElement.querySelector('.modal-title').textContent = title;
        modalElement.querySelector('.modal-body').innerHTML = content;
        
        // Utiliser modal-fix-extreme.js si disponible
        if (modalElement && modalElement.style) {
            modalElement.style.display = 'block';
            modalElement.classList.add('show');
            document.body.classList.add('modal-open');
            
            // Ajouter un backdrop simple
            let backdrop = document.querySelector('.manual-modal-backdrop');
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.className = 'manual-modal-backdrop';
                backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1040;';
                document.body.appendChild(backdrop);
            }
            
            // Ajouter un gestionnaire pour fermer
            const closeBtn = modalElement.querySelector('.btn-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', function() {
                    modalElement.style.display = 'none';
                    modalElement.classList.remove('show');
                    document.body.classList.remove('modal-open');
                    if (backdrop) backdrop.style.display = 'none';
                });
            }
        }
    }
    
    // Fonction pour initialiser les graphiques
    function initializeCharts() {
        const themeChartCanvas = document.getElementById('themeChart');
        const serviceChartCanvas = document.getElementById('serviceChart');
        
        // Seulement continuer si nous avons au moins un des canvas
        if (!themeChartCanvas && !serviceChartCanvas) return;
        
        try {
            // Cleanup des anciens graphiques s'ils existent
            if (window.themeChart && typeof window.themeChart.destroy === 'function') {
                window.themeChart.destroy();
            }
            
            if (window.serviceChart && typeof window.serviceChart.destroy === 'function') {
                window.serviceChart.destroy();
            }
            
            // On s'assure que Chart.js est chargé
            if (typeof Chart === 'undefined') {
                console.error("Chart.js n'est pas chargé");
                return;
            }
            
            // Initialiser les graphiques
            if (themeChartCanvas) {
                const themeCtx = themeChartCanvas.getContext('2d');
                window.themeChart = new Chart(themeCtx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Communiquer avec Teams', 'Gérer les tâches (Planner)', 'Gérer mes fichiers (OneDrive/SharePoint)', 'Collaborer avec Teams'],
                        datasets: [{
                            data: [4, 4, 4, 4],
                            backgroundColor: ['#0078d4', '#7719aa', '#0364b8', '#038387']
                        }]
                    },
                    options: {
                        responsive: true,
                        animation: false,
                        plugins: {
                            legend: {
                                position: 'bottom'
                            }
                        }
                    }
                });
                
                // Cacher l'overlay
                const themeOverlay = document.getElementById('theme-chart-overlay');
                if (themeOverlay) themeOverlay.classList.add('hidden');
            }
            
            if (serviceChartCanvas) {
                const serviceCtx = serviceChartCanvas.getContext('2d');
                window.serviceChart = new Chart(serviceCtx, {
                    type: 'bar',
                    data: {
                        labels: ['Qualité', 'Commerce', 'Informatique', 'RH', 'Marketing', 'Comptabilité', 'Florensud'],
                        datasets: [{
                            label: 'Participants',
                            data: [4, 0, 0, 0, 0, 0, 0],
                            backgroundColor: ['#F44336', '#FFC107', '#607D8B', '#FF9800', '#9C27B0', '#2196F3', '#4CAF50']
                        }]
                    },
                    options: {
                        responsive: true,
                        animation: false,
                        plugins: {
                            legend: {
                                display: false
                            }
                        }
                    }
                });
                
                // Cacher l'overlay
                const serviceOverlay = document.getElementById('service-chart-overlay');
                if (serviceOverlay) serviceOverlay.classList.add('hidden');
            }
            
            console.log('Graphiques initialisés avec succès');
        } catch (error) {
            console.error('Erreur lors de l\'initialisation des graphiques:', error);
            // Ne pas masquer les overlays en cas d'erreur
        }
    }
    
    // Actualiser les données périodiquement
    setInterval(updateSessionPlaces, 30000); // Toutes les 30 secondes
    setInterval(updateCounters, 30000); // Toutes les 30 secondes
    setInterval(refreshRecentActivity, 60000); // Toutes les 60 secondes
    
    // Charger les données initiales
    updateSessionPlaces();
    updateCounters();
    refreshRecentActivity();
});