/**
 * Correctifs JavaScript pour les modales Bootstrap
 * Résout les problèmes courants avec les modales
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Modal fixes initialized');
    
    // Correction pour le padding-right du body
    fixModalPaddingIssue();
    
    // Correction pour les modales imbriquées
    fixNestedModals();
    
    // Correction pour la perte de focus dans les modales
    fixModalFocusIssue();
    
    // Correction pour le défilement des modales sur iOS
    fixIosModalScrolling();
    
    // Gestionnaire pour les modales de confirmation
    setupConfirmationModals();
});

/**
 * Corrige le problème de padding-right sur le body
 */
function fixModalPaddingIssue() {
    const originalSetPadding = bootstrap.Modal.prototype._setScrollbar;
    if (originalSetPadding) {
        bootstrap.Modal.prototype._setScrollbar = function() {
            // Ne rien faire pour éviter le padding automatique
        };
    }
    
    // Réinitialiser les styles lorsque la modal est fermée
    document.addEventListener('hidden.bs.modal', function() {
        document.body.style.paddingRight = '';
        document.body.style.overflow = '';
    });
    
    console.log('Modal padding fix applied');
}

/**
 * Corrige le problème des modales imbriquées
 */
function fixNestedModals() {
    // S'assurer que la modale parente reste visible lorsqu'une modale enfant est fermée
    document.addEventListener('hidden.bs.modal', function(event) {
        const zIndex = parseInt(document.querySelector('.modal-backdrop').style.zIndex, 10);
        
        if (document.querySelectorAll('.modal.show').length > 0) {
            document.body.classList.add('modal-open');
            
            // Si plusieurs modals sont ouvertes, ajuster les z-index
            if (zIndex > 1040) {
                const visibleModals = document.querySelectorAll('.modal.show');
                const lastModal = visibleModals[visibleModals.length - 1];
                lastModal.style.zIndex = (zIndex + 10).toString();
            }
        }
    });
    
    console.log('Nested modals fix applied');
}

/**
 * Corrige le problème de perte de focus dans les modales
 */
function fixModalFocusIssue() {
    // S'assurer que le focus reste dans la modale
    document.addEventListener('shown.bs.modal', function(event) {
        const modal = event.target;
        const focusableElements = modal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        if (focusableElements.length > 0) {
            focusableElements[0].focus();
            
            // Piéger le focus dans la modale
            modal.addEventListener('keydown', function(e) {
                if (e.key === 'Tab') {
                    const firstFocusable = focusableElements[0];
                    const lastFocusable = focusableElements[focusableElements.length - 1];
                    
                    // Si Shift+Tab sur le premier élément, aller au dernier
                    if (e.shiftKey && document.activeElement === firstFocusable) {
                        e.preventDefault();
                        lastFocusable.focus();
                    }
                    // Si Tab sur le dernier élément, aller au premier
                    else if (!e.shiftKey && document.activeElement === lastFocusable) {
                        e.preventDefault();
                        firstFocusable.focus();
                    }
                }
            });
        }
    });
    
    console.log('Modal focus fix applied');
}

/**
 * Corrige le problème de défilement des modales sur iOS
 */
function fixIosModalScrolling() {
    // Détecter si le navigateur est sur iOS
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    
    if (isIos) {
        // Fixer la position du body lorsqu'une modale est ouverte
        document.addEventListener('shown.bs.modal', function() {
            document.body.style.position = 'fixed';
            document.body.style.width = '100%';
        });
        
        // Rétablir le positionnement normal lorsque la modale est fermée
        document.addEventListener('hidden.bs.modal', function() {
            document.body.style.position = '';
            document.body.style.width = '';
        });
        
        console.log('iOS modal scrolling fix applied');
    }
}

/**
 * Configure les modales de confirmation standard
 */
function setupConfirmationModals() {
    // Créer la modale de confirmation si elle n'existe pas
    if (!document.getElementById('confirmModal')) {
        const modalHtml = `
            <div class="modal fade" id="confirmModal" tabindex="-1" aria-labelledby="confirmModalLabel" aria-hidden="true">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="confirmModalLabel">Confirmation</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fermer"></button>
                        </div>
                        <div class="modal-body">
                            <p id="confirmMessage">Êtes-vous sûr de vouloir effectuer cette action ?</p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Annuler</button>
                            <button type="button" class="btn btn-primary" id="confirmButton">Confirmer</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        console.log('Confirmation modal created');
    }
    
    // Créer la modale de suppression si elle n'existe pas
    if (!document.getElementById('deleteModal')) {
        const modalHtml = `
            <div class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="deleteModalLabel" aria-hidden="true">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="deleteModalLabel">Confirmation de suppression</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fermer"></button>
                        </div>
                        <div class="modal-body">
                            <p>Êtes-vous sûr de vouloir supprimer <strong id="deleteEntityName">cet élément</strong> ?</p>
                            <p class="text-danger">Cette action est irréversible.</p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Annuler</button>
                            <form id="deleteForm" method="POST">
                                <input type="hidden" name="_method" value="DELETE">
                                <button type="submit" class="btn btn-danger">Supprimer</button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        console.log('Delete modal created');
    }
}

/**
 * Affiche une modale de confirmation avec un message personnalisé
 * @param {string} message - Message à afficher
 * @param {Function} onConfirm - Fonction à exécuter si l'utilisateur confirme
 */
function showConfirmModal(message, onConfirm) {
    const confirmModal = document.getElementById('confirmModal');
    
    if (!confirmModal) {
        console.error('Confirmation modal not found');
        return;
    }
    
    // Définir le message
    const messageElement = document.getElementById('confirmMessage');
    if (messageElement) {
        messageElement.textContent = message;
    }
    
    // Configurer le bouton de confirmation
    const confirmButton = document.getElementById('confirmButton');
    
    // Supprimer les gestionnaires existants
    const newConfirmButton = confirmButton.cloneNode(true);
    confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
    
    // Ajouter le nouveau gestionnaire
    newConfirmButton.addEventListener('click', function() {
        // Fermer la modale
        const bsModal = bootstrap.Modal.getInstance(confirmModal);
        bsModal.hide();
        
        // Exécuter la fonction de confirmation
        if (typeof onConfirm === 'function') {
            setTimeout(onConfirm, 300); // Délai pour permettre à la modale de se fermer
        }
    });
    
    // Afficher la modale
    const modal = new bootstrap.Modal(confirmModal);
    modal.show();
}

/**
 * Affiche une modale de suppression avec des détails personnalisés
 * @param {string} entityName - Nom de l'entité à supprimer
 * @param {string} deleteUrl - URL de suppression
 */
function showDeleteModal(entityName, deleteUrl) {
    const deleteModal = document.getElementById('deleteModal');
    
    if (!deleteModal) {
        console.error('Delete modal not found');
        return;
    }
    
    // Définir le nom de l'entité
    const entityNameElement = document.getElementById('deleteEntityName');
    if (entityNameElement) {
        entityNameElement.textContent = entityName || 'cet élément';
    }
    
    // Configurer le formulaire de suppression
    const deleteForm = document.getElementById('deleteForm');
    if (deleteForm) {
        deleteForm.action = deleteUrl;
    }
    
    // Afficher la modale
    const modal = new bootstrap.Modal(deleteModal);
    modal.show();
}

// Exposer les fonctions utiles globalement
window.modalUtils = {
    showConfirmModal,
    showDeleteModal
};
