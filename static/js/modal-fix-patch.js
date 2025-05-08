/**
 * modal-fix-patch.js - Correctif pour éviter les problèmes avec les modales
 */
(function() {
    console.log('Modal Fix Patch: Initializing');
    
    // Détection des modales bloquées après un certain temps
    setTimeout(function checkHangingModals() {
        // Vérifier si un backdrop est présent sans modale visible
        const backdrop = document.querySelector('.modal-backdrop');
        const visibleModal = document.querySelector('.modal.show');
        
        if (backdrop && !visibleModal) {
            console.log('Modal Fix Patch: Cleaning orphaned backdrop');
            backdrop.remove();
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }
        
        // Vérifier les modales qui pourraient être bloquées (visibles mais sans bouton de fermeture fonctionnel)
        document.querySelectorAll('.modal.show').forEach(modal => {
            // S'assurer que le bouton de fermeture est visible et cliquable
            const closeButton = modal.querySelector('.btn-close, .close, [data-bs-dismiss="modal"]');
            if (closeButton) {
                closeButton.style.zIndex = '2000';
                closeButton.style.position = 'relative';
                closeButton.style.opacity = '1';
                closeButton.style.display = 'block';
            } else {
                // Ajouter un bouton de fermeture d'urgence s'il n'y en a pas
                const modalHeader = modal.querySelector('.modal-header');
                if (modalHeader && !modalHeader.querySelector('.emergency-close')) {
                    const emergencyButton = document.createElement('button');
                    emergencyButton.className = 'btn-close emergency-close';
                    emergencyButton.setAttribute('data-bs-dismiss', 'modal');
                    emergencyButton.setAttribute('aria-label', 'Close');
                    emergencyButton.style.zIndex = '2000';
                    emergencyButton.style.position = 'absolute';
                    emergencyButton.style.right = '15px';
                    emergencyButton.style.top = '15px';
                    modalHeader.appendChild(emergencyButton);
                    
                    // Ajouter un gestionnaire d'événements pour le bouton d'urgence
                    emergencyButton.addEventListener('click', function() {
                        if (typeof bootstrap !== 'undefined') {
                            const modalInstance = bootstrap.Modal.getInstance(modal);
                            if (modalInstance) modalInstance.hide();
                        }
                        // Fallback
                        modal.classList.remove('show');
                        modal.style.display = 'none';
                        const backdrop = document.querySelector('.modal-backdrop');
                        if (backdrop) backdrop.remove();
                        document.body.classList.remove('modal-open');
                        document.body.style.overflow = '';
                        document.body.style.paddingRight = '';
                    });
                }
            }
        });
    }, 5000); // Vérifier après 5 secondes
    
    console.log('Modal Fix Patch: Setup complete');
})();
