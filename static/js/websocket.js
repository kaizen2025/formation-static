// static/js/websocket.js
document.addEventListener('DOMContentLoaded', function() {
    // Initialisation de Socket.IO avec options de reconnexion
    const socket = io({
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
    });
    
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
        
        // Forcer une mise à jour des données à la connexion
        setTimeout(function() {
            updateCharts();
            updateSessionPlaces();
            updateCounters();
        }, 1000);
    });
    
    // Déconnexion
    socket.on('disconnect', function() {
        console.log('Déconnecté du serveur WebSocket');
        showToast('Connexion au serveur perdue, tentative de reconnexion...', 'warning');
    });
    
    // Reconnexion
    socket.on('reconnect', function(attemptNumber) {
        console.log(`Reconnecté au serveur après ${attemptNumber} tentatives`);
        showToast('Connexion rétablie!', 'success');
        
        // Forcer un rafraîchissement des données
        updateCharts();
        updateSessionPlaces();
        updateCounters();
    });
    
    // Erreur de reconnexion
    socket.on('reconnect_error', function(error) {
        console.error('Erreur de reconnexion:', error);
        showToast('Impossible de se reconnecter au serveur', 'danger');
    });
    
    // Notification générale
    socket.on('notification', function(data) {
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
    });
    
    // Nouvelle inscription
    socket.on('inscription_nouvelle', function(data) {
        updateSessionPlaces(data.session_id, data.places_restantes);
        
        // Actualiser les compteurs
        updateStatsCounter('total_inscriptions');
        
        // Actualiser la répartition par thème et par service
        updateCharts();
        
        // Ajouter à l'activité récente
        refreshRecentActivity();
    });
    
    // Inscription validée
    socket.on('inscription_validee', function(data) {
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
        
        // Actualiser la répartition par thème
        updateCharts();
        
        // Actualiser l'activité récente
        refreshRecentActivity();
    });
    
    // Inscription refusée
    socket.on('inscription_refusee', function(data) {
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
    });
    
    // Nouvelle entrée en liste d'attente
    socket.on('liste_attente_nouvelle', function(data) {
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
    });
    
    // Attribution de salle
    socket.on('attribution_salle', function(data) {
        // Mettre à jour le nom de la salle dans l'interface
        const salleElements = document.querySelectorAll(`.salle-badge[data-session-id="${data.session_id}"]`);
        
        salleElements.forEach(element => {
            element.textContent = data.salle_nom;
            element.classList.remove('bg-secondary');
            element.classList.add('bg-info');
        });
        
        // Actualiser l'activité récente
        refreshRecentActivity();
    });
    
    // Nouvelle activité
    socket.on('nouvelle_activite', function(data) {
        // Ajouter l'activité à la liste des activités récentes
        const activitesList = document.getElementById('recent-activity');
        if (activitesList) {
            // Créer un nouvel élément pour l'activité
            const newActivity = document.createElement('div');
            newActivity.className = 'list-group-item slide-in-right';
            
            // Déterminer le titre en fonction du type
            let titre = 'Nouvelle activité';
            switch (data.type) {
                case 'inscription':
                    titre = 'Nouvelle inscription';
                    break;
                case 'validation':
                    titre = 'Validation d\'inscription';
                    break;
                case 'refus':
                    titre = 'Refus d\'inscription';
                    break;
                case 'liste_attente':
                    titre = 'Ajout en liste d\'attente';
                    break;
                case 'attribution_salle':
                    titre = 'Attribution de salle';
                    break;
                case 'ajout_participant':
                    titre = 'Nouveau participant';
                    break;
            }
            
            // Construire le contenu
            newActivity.innerHTML = `
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1">${titre}</h6>
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
                        // Déterminer le titre en fonction du type
                        let titre = 'Activité';
                        switch (activite.type) {
                            case 'inscription':
                                titre = 'Nouvelle inscription';
                                break;
                            case 'validation':
                                titre = 'Validation d\'inscription';
                                break;
                            case 'refus':
                                titre = 'Refus d\'inscription';
                                break;
                            case 'liste_attente':
                                titre = 'Ajout en liste d\'attente';
                                break;
                            case 'attribution_salle':
                                titre = 'Attribution de salle';
                                break;
                            case 'ajout_participant':
                                titre = 'Nouveau participant';
                                break;
                        }
                        
                        const activityItem = document.createElement('div');
                        activityItem.className = 'list-group-item';
                        activityItem.innerHTML = `
                            <div class="d-flex w-100 justify-content-between">
                                <h6 class="mb-1">${titre}</h6>
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
                    defaultActivity.className = 'list-group-item';
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
    function updateSessionPlaces() {
        fetch('/api/sessions')
            .then(response => response.json())
            .then(data => {
                data.forEach(session => {
                    updatePlacesDisplay(session.id, session.places_restantes, session.inscrits, session.max_participants);
                });
            })
            .catch(error => console.error('Erreur lors de la récupération des données des sessions:', error));
    }
    
    // Fonction pour mettre à jour l'affichage des places pour une session spécifique
    function updatePlacesDisplay(sessionId, placesRestantes, inscrits, maxParticipants) {
        // Mettre à jour tous les éléments qui affichent les places pour cette session
        const placesElements = document.querySelectorAll(`.places-dispo[data-session-id="${sessionId}"]`);
        
        placesElements.forEach(element => {
            // Utiliser les valeurs fournies ou celles de l'élément
            const max = maxParticipants || parseInt(element.getAttribute('data-max-participants') || 15);
            element.textContent = `${placesRestantes} / ${max}`;
            
            // Mettre à jour la classe CSS en fonction des places restantes
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
            
            // Mettre à jour la classe CSS
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
        // Statistiques des sessions
        fetch('/api/sessions')
            .then(response => response.json())
            .then(data => {
                // Compter les sessions complètes
                const sessionsCompletes = data.filter(session => session.places_restantes === 0).length;
                updateCounter('total_sessions_completes', sessionsCompletes);
                
                // Mettre à jour le compteur de sessions programmées
                updateCounter('sessions_programmees', data.length);
                
                // Calculer le total des inscriptions
                const totalInscrits = data.reduce((total, session) => total + session.inscrits, 0);
                updateCounter('total_inscriptions', totalInscrits);
                
                // Calculer le total en liste d'attente
                const totalAttente = data.reduce((total, session) => total + (session.liste_attente || 0), 0);
                updateCounter('total_en_attente', totalAttente);
            })
            .catch(error => console.error('Erreur lors de la récupération des données des sessions:', error));
        
        // Participants inscrits
        fetch('/api/participants')
            .then(response => response.json())
            .then(data => {
                updateCounter('participants_inscrits', data.length);
            })
            .catch(error => console.error('Erreur lors de la récupération des données des participants:', error));
    }
    
    // Fonction pour mettre à jour un compteur spécifique
    function updateCounter(id, value) {
        // Trouver tous les éléments qui affichent ce compteur
        const counters = document.querySelectorAll(`.counter-${id}, #${id}`);
        
        counters.forEach(counter => {
            // Animation du compteur
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
        // Créer un élément toast
        const toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            // Créer le conteneur s'il n'existe pas
            const container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'position-fixed bottom-0 end-0 p-3';
            container.style.zIndex = '5';
            document.body.appendChild(container);
        }
        
        // Créer le toast
        const toastId = `toast-${Date.now()}`;
        const toastElement = document.createElement('div');
        toastElement.id = toastId;
        toastElement.className = `toast align-items-center text-white bg-${type} border-0`;
        toastElement.setAttribute('role', 'alert');
        toastElement.setAttribute('aria-live', 'assertive');
        toastElement.setAttribute('aria-atomic', 'true');
        
        // Contenu du toast
        toastElement.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
        
        const toastContainerEl = document.getElementById('toast-container');
        if (toastContainerEl) {
            toastContainerEl.appendChild(toastElement);
            
            // Initialiser et afficher le toast
            const toast = new bootstrap.Toast(toastElement, { autohide: true, delay: 5000 });
            toast.show();
        }
    }
    
    // Fonction pour afficher une modal
    function showModal(title, content) {
        // Créer l'élément modal s'il n'existe pas
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
        
        // Mettre à jour le contenu
        modalElement.querySelector('.modal-title').textContent = title;
        modalElement.querySelector('.modal-body').innerHTML = content;
        
        // Afficher la modal
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    }
    
    // Initialisation des graphiques avec mises à jour en temps réel
    function updateCharts() {
        // Récupérer les éléments de graphique
        const themeChartCanvas = document.getElementById('themeChart');
        const serviceChartCanvas = document.getElementById('serviceChart');
        
        // Si les graphiques existent, les mettre à jour
        if (themeChartCanvas || serviceChartCanvas) {
            try {
                // Initialiser ou mettre à jour les graphiques
                initializeOrUpdateCharts(themeChartCanvas, serviceChartCanvas);
            } catch (error) {
                console.error('Erreur lors de la mise à jour des graphiques:', error);
            }
        }
    }
    
    // Fonction pour initialiser ou mettre à jour les graphiques
    function initializeOrUpdateCharts(themeCanvas, serviceCanvas) {
        // Si les graphiques n'existent pas encore
        if (!window.dashboardCharts) {
            window.dashboardCharts = {};
        }
        
        // Graphique des thèmes
        if (themeCanvas) {
            // Détruire l'existant si nécessaire
            if (window.themeChart && typeof window.themeChart.destroy === 'function') {
                window.themeChart.destroy();
            }
            
            // Récupérer les données des sessions pour les thèmes
            fetch('/api/sessions')
                .then(response => response.json())
                .then(sessions => {
                    // Compter par thème
                    const themeCounts = {};
                    const themeLabels = [];
                    
                    sessions.forEach(session => {
                        if (!themeCounts[session.theme]) {
                            themeCounts[session.theme] = 0;
                            themeLabels.push(session.theme);
                        }
                        themeCounts[session.theme] += session.inscrits || 0;
                    });
                    
                    // Couleurs pour les thèmes
                    const themeColors = {
                        'Communiquer avec Teams': '#0078d4',
                        'Gérer les tâches (Planner)': '#7719aa',
                        'Gérer mes fichiers (OneDrive/SharePoint)': '#0364b8',
                        'Collaborer avec Teams': '#038387'
                    };
                    
                    // Créer le graphique
                    const ctx = themeCanvas.getContext('2d');
                    window.themeChart = new Chart(ctx, {
                        type: 'doughnut',
                        data: {
                            labels: themeLabels,
                            datasets: [{
                                data: themeLabels.map(label => themeCounts[label]),
                                backgroundColor: themeLabels.map(label => themeColors[label] || '#777777'),
                                borderWidth: 0,
                                hoverOffset: 15
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            cutout: '70%',
                            plugins: {
                                legend: {
                                    position: 'bottom',
                                    labels: {
                                        padding: 15,
                                        usePointStyle: true
                                    }
                                },
                                tooltip: {
                                    callbacks: {
                                        label: function(context) {
                                            const label = context.label || '';
                                            const value = context.parsed || 0;
                                            const total = context.dataset.data.reduce((acc, val) => acc + val, 0);
                                            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                                            return `${label}: ${value} (${percentage}%)`;
                                        }
                                    }
                                }
                            },
                            animation: {
                                animateScale: true,
                                animateRotate: true
                            }
                        }
                    });
                    
                    // Stocker dans l'objet global
                    window.dashboardCharts.themeChart = window.themeChart;
                })
                .catch(error => console.error('Erreur lors de la récupération des données pour le graphique des thèmes:', error));
        }
        
        // Graphique des services
        if (serviceCanvas) {
            // Détruire l'existant si nécessaire
            if (window.serviceChart && typeof window.serviceChart.destroy === 'function') {
                window.serviceChart.destroy();
            }
            
            // Récupérer les données des participants
            fetch('/api/participants')
                .then(response => response.json())
                .then(participants => {
                    // Compter par service
                    const serviceCounts = {};
                    
                    participants.forEach(participant => {
                        if (!serviceCounts[participant.service]) {
                            serviceCounts[participant.service] = 0;
                        }
                        serviceCounts[participant.service]++;
                    });
                    
                    // Extraire les labels et les données
                    const serviceLabels = Object.keys(serviceCounts);
                    const serviceData = serviceLabels.map(label => serviceCounts[label]);
                    
                    // Couleurs pour les services
                    const serviceColors = [
                        '#FFC107', '#2196F3', '#4CAF50', '#607D8B', 
                        '#9C27B0', '#F44336', '#FF9800'
                    ];
                    
                    // Créer le graphique
                    const ctx = serviceCanvas.getContext('2d');
                    window.serviceChart = new Chart(ctx, {
                        type: 'bar',
                        data: {
                            labels: serviceLabels,
                            datasets: [{
                                label: 'Participants',
                                data: serviceData,
                                backgroundColor: serviceColors.slice(0, serviceLabels.length),
                                borderRadius: 5,
                                maxBarThickness: 35
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: {
                                    display: false
                                }
                            },
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    grid: {
                                        drawBorder: false,
                                        color: 'rgba(0,0,0,0.05)'
                                    },
                                    ticks: {
                                        precision: 0
                                    }
                                },
                                x: {
                                    grid: {
                                        display: false
                                    }
                                }
                            },
                            animation: {
                                duration: 2000,
                                easing: 'easeOutQuart'
                            }
                        }
                    });
                    
                    // Stocker dans l'objet global
                    window.dashboardCharts.serviceChart = window.serviceChart;
                })
                .catch(error => console.error('Erreur lors de la récupération des données pour le graphique des services:', error));
        }
    }

    // Gestion des modales qui scintillent
    const modalOpenButtons = document.querySelectorAll('[data-bs-toggle="modal"]');
    modalOpenButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const modalId = this.getAttribute('data-bs-target');
            if (!modalId) return;
            
            // Récupérer la modal et l'ouvrir via Bootstrap
            const modalElement = document.querySelector(modalId);
            if (modalElement) {
                const modal = new bootstrap.Modal(modalElement, {
                    keyboard: true,
                    backdrop: true,
                    focus: true
                });
                
                try {
                    modal.show();
                } catch (error) {
                    console.error('Erreur lors de l\'ouverture de la modal:', error);
                }
            }
        });
    });
    
    // Actualiser les données périodiquement
    setInterval(updateSessionPlaces, 30000); // Toutes les 30 secondes
    setInterval(updateCharts, 60000); // Toutes les 60 secondes
    setInterval(updateCounters, 30000); // Toutes les 30 secondes
    setInterval(refreshRecentActivity, 60000); // Toutes les 60 secondes
    
    // Initialisation au chargement
    updateSessionPlaces();
    updateCharts();
    updateCounters();
    setTimeout(refreshRecentActivity, 1000); // Léger délai pour éviter les problèmes de rendu
});