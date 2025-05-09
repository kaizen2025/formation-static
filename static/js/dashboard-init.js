/**
 * Initialisation du dashboard et des composants UI
 * Ce fichier complète dashboard-core.js
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Dashboard initialization started');
    
    // Initialisation des tooltips Bootstrap
    initTooltips();
    
    // Initialisation des popovers Bootstrap
    initPopovers();
    
    // Gestion des formulaires avec validation
    setupFormValidation();
    
    // Gestion des modales
    setupModals();
    
    // Animations au défilement
    setupScrollAnimations();
    
    console.log('Dashboard initialization completed');
});

/**
 * Initialise les tooltips Bootstrap
 */
function initTooltips() {
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
    console.log(`Initialized ${tooltipList.length} tooltips`);
}

/**
 * Initialise les popovers Bootstrap
 */
function initPopovers() {
    const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
    const popoverList = [...popoverTriggerList].map(popoverTriggerEl => new bootstrap.Popover(popoverTriggerEl));
    console.log(`Initialized ${popoverList.length} popovers`);
}

/**
 * Configure la validation des formulaires
 */
function setupFormValidation() {
    // Récupère tous les formulaires qui ont besoin de validation
    const forms = document.querySelectorAll('.needs-validation');
    
    // Boucle sur eux pour empêcher la soumission
    Array.from(forms).forEach(form => {
        form.addEventListener('submit', event => {
            if (!form.checkValidity()) {
                event.preventDefault();
                event.stopPropagation();
            }
            
            form.classList.add('was-validated');
        }, false);
    });
    
    console.log(`Setup validation for ${forms.length} forms`);
}

/**
 * Configure les boîtes de dialogue modal
 */
function setupModals() {
    // Gestionnaire d'événements pour les modals de confirmation
    document.querySelectorAll('[data-confirm]').forEach(element => {
        element.addEventListener('click', function(e) {
            e.preventDefault();
            
            const message = this.getAttribute('data-confirm') || 'Êtes-vous sûr de vouloir effectuer cette action ?';
            const confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
            
            // Définir le message
            document.getElementById('confirmMessage').textContent = message;
            
            // Configurer le bouton de confirmation
            document.getElementById('confirmButton').onclick = () => {
                window.location.href = this.getAttribute('href');
            };
            
            // Afficher la modal
            confirmModal.show();
        });
    });
    
    // Gestionnaire pour les modals de suppression
    document.querySelectorAll('[data-delete]').forEach(element => {
        element.addEventListener('click', function(e) {
            e.preventDefault();
            
            const confirmModal = new bootstrap.Modal(document.getElementById('deleteModal'));
            const entityName = this.getAttribute('data-entity-name') || 'cet élément';
            
            // Définir le message
            document.getElementById('deleteEntityName').textContent = entityName;
            
            // Configurer le formulaire de suppression
            document.getElementById('deleteForm').action = this.getAttribute('data-delete');
            
            // Afficher la modal
            confirmModal.show();
        });
    });
    
    console.log('Modal setup completed');
}

/**
 * Configure les animations au défilement
 */
function setupScrollAnimations() {
    const fadeElements = document.querySelectorAll('.fade-in-element');
    
    if (fadeElements.length === 0) return;
    
    const fadeObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                fadeObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1
    });
    
    fadeElements.forEach(element => {
        fadeObserver.observe(element);
    });
    
    console.log(`Setup animations for ${fadeElements.length} elements`);
}

/**
 * Gestionnaire pour les filtres de tableau
 */
function setupTableFilters() {
    const filterInputs = document.querySelectorAll('[data-filter-table]');
    
    filterInputs.forEach(input => {
        input.addEventListener('keyup', function() {
            const tableId = this.getAttribute('data-filter-table');
            const table = document.getElementById(tableId);
            
            if (!table) return;
            
            const rows = table.querySelectorAll('tbody tr');
            const searchText = this.value.toLowerCase();
            
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(searchText) ? '' : 'none';
            });
            
            // Afficher un message si aucun résultat
            const noResultsRow = table.querySelector('.no-results-row');
            
            if (noResultsRow) {
                const visibleRows = [...rows].filter(row => row.style.display !== 'none').length;
                noResultsRow.style.display = visibleRows === 0 ? '' : 'none';
            }
        });
    });
}

/**
 * Rafraîchit l'interface après une action AJAX
 */
function refreshUI() {
    // Réinitialiser les graphiques
    if (typeof refreshDashboard === 'function') {
        refreshDashboard();
    }
    
    // Rétablir les tooltips et popovers
    initTooltips();
    initPopovers();
    
    console.log('UI refreshed');
}

/**
 * Formater les dates pour l'affichage
 */
function formatDate(dateString) {
    if (!dateString) return '';
    
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

/**
 * Formater les heures pour l'affichage
 */
function formatTime(timeString) {
    if (!timeString) return '';
    
    // Gérer les formats ISO et les formats hh:mm
    if (timeString.includes('T')) {
        const date = new Date(timeString);
        return date.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } else {
        return timeString.substring(0, 5);
    }
}

/**
 * Fonction pour exporter un tableau au format CSV
 */
function exportTableToCSV(tableId, filename = 'export.csv') {
    const table = document.getElementById(tableId);
    if (!table) {
        console.error(`Table with ID ${tableId} not found`);
        return;
    }
    
    // Récupérer les en-têtes
    const headers = [];
    const headerRow = table.querySelector('thead tr');
    if (headerRow) {
        headerRow.querySelectorAll('th').forEach(th => {
            headers.push(th.textContent.trim());
        });
    }
    
    // Récupérer les données
    const rows = [];
    table.querySelectorAll('tbody tr').forEach(tr => {
        const row = [];
        tr.querySelectorAll('td').forEach(td => {
            // Nettoyer le texte (supprimer les balises HTML, etc.)
            const text = td.textContent.trim().replace(/"/g, '""');
            row.push(`"${text}"`);
        });
        rows.push(row.join(','));
    });
    
    // Créer le CSV
    const csv = [
        headers.join(','),
        ...rows
    ].join('\n');
    
    // Télécharger le CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Configurer les filtres de tableau au chargement
document.addEventListener('DOMContentLoaded', setupTableFilters);

// Écouter les redimensionnements de fenêtre
window.addEventListener('resize', function() {
    // Redimensionner les graphiques si nécessaire
    if (typeof refreshChartSizes === 'function') {
        refreshChartSizes();
    }
});
