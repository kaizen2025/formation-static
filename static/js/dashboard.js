// static/js/dashboard.js
document.addEventListener('DOMContentLoaded', function() {
    // Actualiser les données en temps réel (toutes les 30 secondes)
    setInterval(function() {
        fetchSessionData();
        fetchParticipantData();
    }, 30000);

    // Fonction pour récupérer les données des sessions
    function fetchSessionData() {
        fetch('/api/sessions')
            .then(response => response.json())
            .then(data => {
                updateSessionTable(data);
                updateCharts(data);
            })
            .catch(error => console.error('Erreur lors de la récupération des données des sessions:', error));
    }

    // Fonction pour récupérer les données des participants
    function fetchParticipantData() {
        fetch('/api/participants')
            .then(response => response.json())
            .then(data => {
                updateParticipantData(data);
            })
            .catch(error => console.error('Erreur lors de la récupération des données des participants:', error));
    }

    // Fonction pour mettre à jour le tableau des sessions
    function updateSessionTable(data) {
        const sessionTable = document.querySelector('.session-table tbody');
        if (!sessionTable) return;

        // Mettre à jour les places disponibles pour chaque session
        data.forEach(session => {
            const row = document.querySelector(`tr[data-session-id="${session.id}"]`);
            if (row) {
                const placesCell = row.querySelector('.places-dispo');
                if (placesCell) {
                    placesCell.textContent = `${session.places_restantes} / ${session.max_participants}`;
                    
                    // Mettre à jour la classe CSS en fonction des places restantes
                    placesCell.classList.remove('text-success', 'text-warning', 'text-danger');
                    if (session.places_restantes <= 3) {
                        placesCell.classList.add('text-danger');
                    } else if (session.places_restantes <= 7) {
                        placesCell.classList.add('text-warning');
                    } else {
                        placesCell.classList.add('text-success');
                    }
                }
                
                // Mettre à jour le nombre de participants
                const participantsBtn = row.querySelector('.btn-outline-secondary');
                if (participantsBtn) {
                    const badge = participantsBtn.querySelector('.badge');
                    if (badge) {
                        badge.textContent = session.inscrits;
                    }
                }
            }
        });
    }

    // Fonction pour mettre à jour les graphiques
    function updateCharts(data) {
        // Mettre à jour les graphiques si nécessaire
        if (window.themeChart) {
            // Mettre à jour les données du graphique des thèmes
            // Code spécifique selon les besoins
        }
        
        if (window.serviceChart) {
            // Mettre à jour les données du graphique des services
            // Code spécifique selon les besoins
        }
    }

    // Fonction pour mettre à jour les données des participants
    function updateParticipantData(data) {
        // Mettre à jour les listes déroulantes des participants
        const participantSelects = document.querySelectorAll('select[name="participant_id"]');
        
        participantSelects.forEach(select => {
            const selectedValue = select.value;
            
            // Vider la liste
            select.innerHTML = '<option value="">-- Choisir un participant --</option>';
            
            // Remplir avec les nouvelles données
            data.forEach(participant => {
                const option = document.createElement('option');
                option.value = participant.id;
                option.textContent = `${participant.prenom} ${participant.nom} (${participant.service})`;
                
                if (participant.id.toString() === selectedValue) {
                    option.selected = true;
                }
                
                select.appendChild(option);
            });
        });
    }

    // Initialiser les filtres dans la page des sessions
    const themeFilter = document.getElementById('theme');
    const dateFilter = document.getElementById('date');
    const placesFilter = document.getElementById('places');
    
    if (themeFilter && dateFilter && placesFilter) {
        themeFilter.addEventListener('change', updateSessionDisplay);
        dateFilter.addEventListener('change', updateSessionDisplay);
        placesFilter.addEventListener('change', updateSessionDisplay);
        
        function updateSessionDisplay() {
            const themeValue = themeFilter.value;
            const dateValue = dateFilter.value;
            const placesValue = placesFilter.value;
            
            const sessionCards = document.querySelectorAll('.session-card');
            
            sessionCards.forEach(card => {
                let showCard = true;
                
                // Filtrer par thème
                if (themeValue && card.dataset.theme !== themeValue) {
                    showCard = false;
                }
                
                // Filtrer par date
                if (dateValue && card.dataset.date !== dateValue) {
                    showCard = false;
                }
                
                // Filtrer par places disponibles
                if (placesValue === 'available' && parseInt(card.dataset.places) <= 0) {
                    showCard = false;
                }
                
                card.closest('.col-md-6').style.display = showCard ? 'block' : 'none';
            });
        }
    }
});

// static/css/custom.css
:root {
    --primary-color: #0078d4;
    --secondary-color: #69afe5;
    --light-color: #f3f3f3;
    --dark-color: #333;
    --success-color: #4caf50;
    --warning-color: #ff9800;
    --danger-color: #f44336;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background-color: #f8f9fa;
}

.navbar {
    background-color: var(--primary-color);
}

.navbar-brand {
    font-weight: bold;
}

.card {
    border-radius: 10px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    transition: transform 0.3s;
    margin-bottom: 20px;
}

.card:hover {
    transform: translateY(-5px);
}

.session-card {
    border-left: 5px solid var(--primary-color);
}

.theme-badge {
    font-size: 0.8rem;
    padding: 5px 10px;
    border-radius: 20px;
    margin-right: 5px;
}

.theme-comm {
    background-color: #0078d4;
    color: white;
}

.theme-planner {
    background-color: #7719aa;
    color: white;
}

.theme-onedrive {
    background-color: #0364b8;
    color: white;
}

.theme-sharepoint {
    background-color: #038387;
    color: white;
}

.service-badge {
    display: inline-block;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    margin-right: 5px;
}

.dashboard-stats {
    background-color: white;
    border-radius: 10px;
    padding: 20px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    margin-bottom: 20px;
}

.stat-item {
    text-align: center;
    padding: 15px;
}

.stat-number {
    font-size: 2rem;
    font-weight: bold;
    color: var(--primary-color);
}

.stat-label {
    color: var(--dark-color);
    font-size: 0.9rem;
}

.session-table th {
    background-color: var(--primary-color);
    color: white;
}

.places-dispo {
    font-weight: bold;
}

.footer {
    background-color: var(--dark-color);
    color: white;
    padding: 20px 0;
    margin-top: 50px;
}

.theme-description {
    margin-bottom: 30px;
    padding: 15px;
    background-color: white;
    border-radius: 10px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* Couleurs des services */
.commerce { background-color: #FFC107; }
.comptabilite { background-color: #2196F3; }
.florensud { background-color: #4CAF50; }
.informatique { background-color: #607D8B; }
.marketing { background-color: #9C27B0; }
.qualite { background-color: #F44336; }
.rh { background-color: #FF9800; }

/* Animations */
.fade-in {
    animation: fadeIn 0.5s ease-in-out;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

/* Style pour les boutons */
.btn-primary {
    background-color: var(--primary-color);
    border-color: var(--primary-color);
}

.btn-primary:hover {
    background-color: #005a9e;
    border-color: #005a9e;
}

/* Style pour les alertes */
.alert {
    border-radius: 10px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* Style pour les modals */
.modal-content {
    border-radius: 10px;
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
}

.modal-header {
    border-top-left-radius: 10px;
    border-top-right-radius: 10px;
}

/* Style pour les tableaux */
.table {
    border-collapse: separate;
    border-spacing: 0;
}

.table th:first-child {
    border-top-left-radius: 10px;
}

.table th:last-child {
    border-top-right-radius: 10px;
}

/* Responsive */
@media (max-width: 768px) {
    .stat-number {
        font-size: 1.5rem;
    }
    
    .card {
        margin-bottom: 15px;
    }
    
    .session-table {
        font-size: 0.9rem;
    }
}