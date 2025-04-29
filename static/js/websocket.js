// static/js/websocket.js
document.addEventListener('DOMContentLoaded', function() {
    // Initialisation de Socket.IO
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
    });
    
    // Erreur de reconnexion
    socket.on('reconnect_error', function(error) {
        console.error('Erreur de reconnexion:', error);
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
    });
    
    // Nouvelle entrée en liste d'attente
    socket.on('liste_attente_nouvelle', function(data) {
        // Mettre à jour le compteur de liste d'attente pour la session
        const attenteCounter = document.querySelector(`.attente-counter[data-session-id="${data.session_id}"]`);
        if (attenteCounter) {
            const currentCount = parseInt(attenteCounter.textContent) || 0;
            attenteCounter.textContent = currentCount + 1;
        }
        
        // Actualiser les compteurs
        updateStatsCounter('total_en_attente');
    });
    
    // Fonction pour mettre à jour l'affichage des places disponibles
    function updateSessionPlaces(sessionId, placesRestantes) {
        // Si places_restantes n'est pas fourni, faire une requête API pour l'obtenir
        if (placesRestantes === undefined) {
            fetch(`/api/sessions`)
                .then(response => response.json())
                .then(data => {
                    const session = data.find(s => s.id == sessionId);
                    if (session) {
                        updatePlacesDisplay(sessionId, session.places_restantes);
                    }
                })
                .catch(error => console.error('Erreur lors de la récupération des données:', error));
        } else {
            updatePlacesDisplay(sessionId, placesRestantes);
        }
    }
    
    // Mettre à jour l'affichage des places
    function updatePlacesDisplay(sessionId, placesRestantes) {
        // Mettre à jour tous les éléments qui affichent les places pour cette session
        const placesElements = document.querySelectorAll(`.places-dispo[data-session-id="${sessionId}"]`);
        
        placesElements.forEach(element => {
            const maxParticipants = parseInt(element.getAttribute('data-max-participants') || 15);
            element.textContent = `${placesRestantes} / ${maxParticipants}`;
            
            // Mettre à jour la classe CSS en fonction des places restantes
            element.classList.remove('text-success', 'text-warning', 'text-danger');
            if (placesRestantes <= 3) {
                element.classList.add('text-danger');
            } else if (placesRestantes <= 7) {
                element.classList.add('text-warning');
            } else {
                element.classList.add('text-success');
            }
            
            // Mettre à jour les boutons d'inscription si nécessaire
            const sessionCard = document.querySelector(`.card[data-session-id="${sessionId}"]`);
            if (sessionCard) {
                const inscriptionBtn = sessionCard.querySelector('.btn-inscription');
                const listeAttenteBtn = sessionCard.querySelector('.btn-liste-attente');
                
                if (inscriptionBtn && listeAttenteBtn) {
                    if (placesRestantes > 0) {
                        inscriptionBtn.classList.remove('d-none');
                        listeAttenteBtn.classList.add('d-none');
                    } else {
                        inscriptionBtn.classList.add('d-none');
                        listeAttenteBtn.classList.remove('d-none');
                    }
                }
            }
        });
        
        // Mettre à jour les barres de progression
        const progressBars = document.querySelectorAll(`.progress-bar[data-session-id="${sessionId}"]`);
        progressBars.forEach(bar => {
            const maxParticipants = parseInt(bar.getAttribute('data-max-participants') || 15);
            const inscrits = maxParticipants - placesRestantes;
            const progressPercent = (inscrits / maxParticipants) * 100;
            
            bar.style.width = `${progressPercent}%`;
            bar.textContent = `${inscrits} / ${maxParticipants}`;
            
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
    }
    
    // Fonction pour mettre à jour les compteurs
    function updateStatsCounter(counterId) {
        const counterElement = document.getElementById(counterId);
        if (counterElement) {
            let currentValue = parseInt(counterElement.textContent) || 0;
            currentValue++;
            
            // Animation de compteur
            const duration = 1000;
            const steps = 20;
            const increment = 1 / steps;
            let current = 0;
            const interval = duration / steps;
            
            const timer = setInterval(() => {
                current += increment;
                if (current >= 1) {
                    clearInterval(timer);
                    counterElement.textContent = currentValue;
                } else {
                    const intermediateValue = Math.floor(current * currentValue + (1 - current) * (currentValue - 1));
                    counterElement.textContent = intermediateValue;
                }
            }, interval);
        }
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
    
    // Initialisation des charts avec mises à jour en temps réel
    // Si la page contient des graphiques, les initialiser
    const themeChartCanvas = document.getElementById('themeChart');
    const serviceChartCanvas = document.getElementById('serviceChart');
    
    if (themeChartCanvas && serviceChartCanvas) {
        // Créer un objet pour stocker les références aux graphiques
        window.dashboardCharts = {};
        
        // Détruire les charts existants si présents
        if (window.themeChart && typeof window.themeChart.destroy === 'function') {
            window.themeChart.destroy();
        }
        if (window.serviceChart && typeof window.serviceChart.destroy === 'function') {
            window.serviceChart.destroy();
        }
        
        // Initialiser les graphiques
        initCharts();
        
        // Mettre à jour les graphiques périodiquement
        setInterval(updateCharts, 30000);
    }
    
    function initCharts() {
        // Initialisation du graphique des thèmes
        if (themeChartCanvas) {
            const ctxTheme = themeChartCanvas.getContext('2d');
            window.dashboardCharts.themeChart = new Chart(ctxTheme, {
                type: 'doughnut',
                data: {
                    labels: [
                        'Communiquer avec Teams',
                        'Gérer les tâches (Planner)',
                        'Gérer mes fichiers (OneDrive)',
                        'Collaborer Teams / SharePoint'
                    ],
                    datasets: [{
                        data: [0, 0, 0, 0], // Valeurs par défaut
                        backgroundColor: [
                            '#0078d4',
                            '#7719aa',
                            '#0364b8',
                            '#038387'
                        ],
                        borderWidth: 0,
                        hoverOffset: 15
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                padding: 15,
                                usePointStyle: true
                            }
                        },
                        title: {
                            display: true,
                            text: 'Répartition par thème'
                        }
                    },
                    animation: {
                        animateScale: true,
                        animateRotate: true
                    }
                }
            });
            
            // Stocker la référence
            window.themeChart = window.dashboardCharts.themeChart;
        }
        
        // Initialisation du graphique des services
        if (serviceChartCanvas) {
            const ctxService = serviceChartCanvas.getContext('2d');
            window.dashboardCharts.serviceChart = new Chart(ctxService, {
                type: 'bar',
                data: {
                    labels: [], // Sera rempli dynamiquement
                    datasets: [{
                        label: 'Participants par service',
                        data: [], // Sera rempli dynamiquement
                        backgroundColor: [
                            '#FFC107',
                            '#2196F3',
                            '#4CAF50',
                            '#607D8B',
                            '#9C27B0',
                            '#F44336',
                            '#FF9800'
                        ],
                        borderRadius: 5
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            display: false
                        },
                        title: {
                            display: true,
                            text: 'Participants par service'
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                precision: 0
                            }
                        }
                    }
                }
            });
            
            // Stocker la référence
            window.serviceChart = window.dashboardCharts.serviceChart;
        }
        
        // Mettre à jour les données des graphiques
        updateCharts();
    }
    
    function updateCharts() {
        try {
            // Récupérer les données actuelles des sessions
            fetch('/api/sessions')
                .then(response => response.json())
                .then(sessions => {
                    // Compter les inscriptions par thème
                    const themeCounts = {
                        'Communiquer avec Teams': 0,
                        'Gérer les tâches (Planner)': 0,
                        'Gérer mes fichiers (OneDrive)': 0,
                        'Collaborer Teams / SharePoint': 0
                    };
                    
                    sessions.forEach(session => {
                        if (themeCounts[session.theme] !== undefined) {
                            themeCounts[session.theme] += session.inscrits || 0;
                        }
                    });
                    
                    // Mettre à jour le graphique des thèmes si disponible
                    if (window.dashboardCharts && window.dashboardCharts.themeChart) {
                        window.dashboardCharts.themeChart.data.datasets[0].data = [
                            themeCounts['Communiquer avec Teams'],
                            themeCounts['Gérer les tâches (Planner)'],
                            themeCounts['Gérer mes fichiers (OneDrive)'],
                            themeCounts['Collaborer Teams / SharePoint']
                        ];
                        window.dashboardCharts.themeChart.update();
                    }
                })
                .catch(error => {
                    console.error('Erreur lors de la récupération des données des sessions:', error);
                });
            
            // Récupérer les données des participants
            fetch('/api/participants')
                .then(response => response.json())
                .then(participants => {
                    // Compter les participants par service
                    const serviceCounts = {};
                    const serviceLabels = [];
                    
                    participants.forEach(participant => {
                        if (participant.service) {
                            if (!serviceCounts[participant.service]) {
                                serviceCounts[participant.service] = 0;
                                serviceLabels.push(participant.service);
                            }
                            serviceCounts[participant.service]++;
                        }
                    });
                    
                    // Mettre à jour le graphique des services si disponible
                    if (window.dashboardCharts && window.dashboardCharts.serviceChart) {
                        window.dashboardCharts.serviceChart.data.labels = serviceLabels;
                        window.dashboardCharts.serviceChart.data.datasets[0].data = Object.values(serviceCounts);
                        window.dashboardCharts.serviceChart.update();
                    }
                })
                .catch(error => {
                    console.error('Erreur lors de la récupération des données des participants:', error);
                });
                
        } catch (error) {
            console.error('Erreur lors de la mise à jour des graphiques:', error);
        }
    }
});