/**
 * Patch supplémentaire pour les modales Bootstrap
 * Résout les problèmes spécifiques à l'application Formation
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Modal patch initialized');
    
    // Correction pour la fermeture des modales avec formulaire
    fixModalFormSubmit();
    
    // Support pour les modales dynamiques (AJAX)
    setupDynamicModals();
    
    // Prise en charge de l'accessibilité des modales
    enhanceModalAccessibility();
});

/**
 * Corrige le problème de fermeture des modales après soumission de formulaire
 */
function fixModalFormSubmit() {
    // Intercepter les soumissions de formulaire dans les modales
    document.addEventListener('submit', function(event) {
        const form = event.target;
        const modal = form.closest('.modal');
        
        if (modal && !form.hasAttribute('data-no-modal-close')) {
            // Vérifier si le formulaire utilise AJAX
            if (form.hasAttribute('data-ajax-submit')) {
                event.preventDefault();
                
                // Soumettre le formulaire en AJAX
                const formData = new FormData(form);
                const method = form.method.toUpperCase() || 'POST';
                const url = form.action;
                
                fetch(url, {
                    method: method,
                    body: formData,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! Status: ${response.status}`);
                    }
                    
                    // Essayer de traiter la réponse en tant que JSON
                    return response.json().catch(() => response.text());
                })
                .then(data => {
                    // Fermer la modale
                    const bsModal = bootstrap.Modal.getInstance(modal);
                    bsModal.hide();
                    
                    // Afficher un message de succès si disponible
                    if (typeof data === 'object' && data.message) {
                        showToast('success', data.message);
                    }
                    
                    // Rafraîchir la page après un délai si nécessaire
                    if (form.hasAttribute('data-refresh-after-submit')) {
                        setTimeout(() => {
                            window.location.reload();
                        }, 500);
                    }
                })
                .catch(error => {
                    console.error('Form submission error:', error);
                    showToast('error', 'Erreur lors de la soumission du formulaire.');
                });
            } else {
                // Pour les formulaires non-AJAX, fermer manuellement après le traitement côté serveur
                form.setAttribute('data-close-modal-after-submit', 'true');
            }
        }
    });
    
    console.log('Modal form submission fix applied');
}

/**
 * Configure la prise en charge des modales chargées dynamiquement
 */
function setupDynamicModals() {
    // Gestionnaire pour les liens qui chargent des modales en AJAX
    document.addEventListener('click', function(event) {
        const element = event.target.closest('[data-modal-url]');
        
        if (element) {
            event.preventDefault();
            
            const url = element.getAttribute('data-modal-url');
            const target = element.getAttribute('data-modal-target') || 'dynamicModal';
            
            // Charger le contenu de la modale en AJAX
            fetch(url, {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.text();
            })
            .then(html => {
                // Créer ou mettre à jour la modale dynamique
                let modalElement = document.getElementById(target);
                
                if (!modalElement) {
                    modalElement = document.createElement('div');
                    modalElement.id = target;
                    document.body.appendChild(modalElement);
                }
                
                modalElement.innerHTML = html;
                
                // Initialiser la modale
                const modal = new bootstrap.Modal(modalElement.querySelector('.modal'));
                modal.show();
                
                // Initialiser les composants dans la modale
                initializeModalComponents(modalElement);
            })
            .catch(error => {
                console.error('Error loading modal content:', error);
                showToast('error', 'Erreur lors du chargement de la fenêtre modale.');
            });
        }
    });
    
    console.log('Dynamic modals setup complete');
}

/**
 * Initialise les composants dans une modale dynamique
 */
function initializeModalComponents(modalElement) {
    // Initialiser les tooltips
    const tooltips = modalElement.querySelectorAll('[data-bs-toggle="tooltip"]');
    tooltips.forEach(tooltip => new bootstrap.Tooltip(tooltip));
    
    // Initialiser les datepickers
    const datepickers = modalElement.querySelectorAll('.datepicker');
    if (datepickers.length > 0 && typeof flatpickr === 'function') {
        datepickers.forEach(input => {
            flatpickr(input, {
                dateFormat: 'd/m/Y',
                locale: 'fr',
                allowInput: true
            });
        });
    }
    
    // Initialiser les select2
    const selects = modalElement.querySelectorAll('.select2');
    if (selects.length > 0 && typeof $.fn.select2 === 'function') {
        $(selects).select2({
            dropdownParent: modalElement
        });
    }
    
    // Validation des formulaires
    const forms = modalElement.querySelectorAll('.needs-validation');
    forms.forEach(form => {
        form.addEventListener('submit', function(event) {
            if (!form.checkValidity()) {
                event.preventDefault();
                event.stopPropagation();
            }
            form.classList.add('was-validated');
        }, false);
    });
}

/**
 * Améliore l'accessibilité des modales
 */
function enhanceModalAccessibility() {
    // S'assurer que les modales ont les attributs ARIA appropriés
    document.addEventListener('shown.bs.modal', function(event) {
        const modal = event.target;
        
        // Vérifier et ajouter les attributs d'accessibilité
        if (!modal.getAttribute('aria-labelledby')) {
            const modalTitle = modal.querySelector('.modal-title');
            if (modalTitle) {
                const titleId = modalTitle.id || `modal-title-${Math.random().toString(36).substr(2, 9)}`;
                modalTitle.id = titleId;
                modal.setAttribute('aria-labelledby', titleId);
            }
        }
        
        if (!modal.getAttribute('aria-describedby')) {
            const modalBody = modal.querySelector('.modal-body');
            if (modalBody) {
                const bodyId = modalBody.id || `modal-body-${Math.random().toString(36).substr(2, 9)}`;
                modalBody.id = bodyId;
                modal.setAttribute('aria-describedby', bodyId);
            }
        }
        
        // S'assurer que le modal a role="dialog"
        if (!modal.hasAttribute('role')) {
            modal.setAttribute('role', 'dialog');
        }
    });
    
    console.log('Modal accessibility enhancements applied');
}

/**
 * Affiche un toast de notification
 * @param {string} type - Type de notification (success, error, warning, info)
 * @param {string} message - Message à afficher
 * @param {number} duration - Durée d'affichage en millisecondes
 */
function showToast(type, message, duration = 5000) {
    // Créer le conteneur de toasts s'il n'existe pas
    let toastContainer = document.getElementById('toast-container');
    
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'position-fixed top-0 end-0 p-3';
        toastContainer.style.zIndex = '1060';
        document.body.appendChild(toastContainer);
    }
    
    // Créer le toast
    const toastId = `toast-${Math.random().toString(36).substr(2, 9)}`;
    const bgClass = type === 'error' ? 'bg-danger' : 
                   (type === 'warning' ? 'bg-warning' : 
                   (type === 'info' ? 'bg-info' : 'bg-success'));
    
    const icon = type === 'error' ? 'exclamation-triangle' : 
                (type === 'warning' ? 'exclamation-circle' : 
                (type === 'info' ? 'info-circle' : 'check-circle'));
    
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = `toast align-items-center text-white ${bgClass} border-0`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                <i class="fas fa-${icon} me-2"></i>
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fermer"></button>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    // Initialiser et afficher le toast
    const toastInstance = new bootstrap.Toast(toast, {
        autohide: true,
        delay: duration
    });
    
    toastInstance.show();
    
    // Supprimer le toast du DOM après sa fermeture
    toast.addEventListener('hidden.bs.toast', function() {
        toast.remove();
    });
}

// Exposer les fonctions utiles globalement
window.modalPatch = {
    showToast,
    initializeModalComponents
};
