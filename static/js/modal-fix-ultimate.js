document.addEventListener('DOMContentLoaded', function() {
    // 1. Supprimer toutes les instances et listeners de Bootstrap pour les modales
    if (window.bootstrap && window.bootstrap.Modal) {
        // Désactiver complètement les modales Bootstrap
        const originalModal = window.bootstrap.Modal;
        window.bootstrap.Modal = function() {
            return {
                show: function() {},
                hide: function() {},
                toggle: function() {},
                dispose: function() {},
                getInstance: function() { return null; }
            };
        };
    }
    
    // 2. Remplacer tous les déclencheurs de modales
    document.querySelectorAll('[data-bs-toggle="modal"], .btn-participant, [data-bs-target*="Modal"]').forEach(button => {
        const newButton = button.cloneNode(true);
        if (button.parentNode) {
            button.parentNode.replaceChild(newButton, button);
            
            // Ajouter notre gestionnaire personnalisé
            newButton.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                // Trouver l'ID de la modale
                let modalId = this.getAttribute('data-bs-target') || this.getAttribute('href');
                if (!modalId && this.closest('[data-bs-target]')) {
                    modalId = this.closest('[data-bs-target]').getAttribute('data-bs-target');
                }
                
                if (!modalId) return;
                if (modalId.startsWith('#')) modalId = modalId.substring(1);
                
                // Ouvrir la modale manuellement
                openModalManually(modalId);
            });
        }
    });
    
    // 3. Fonction pour ouvrir la modale manuellement
    function openModalManually(modalId) {
        const modalElement = document.getElementById(modalId);
        if (!modalElement) return;
        
        // Créer backdrop
        let backdrop = document.querySelector('.manual-modal-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'manual-modal-backdrop';
            backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1040;';
            document.body.appendChild(backdrop);
        }
        
        // Configurer la modale
        modalElement.style.display = 'block';
        modalElement.style.zIndex = '1050';
        modalElement.classList.add('show');
        modalElement.setAttribute('aria-modal', 'true');
        modalElement.setAttribute('role', 'dialog');
        
        // Bloquer le scroll du body
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
        document.body.style.paddingRight = '15px';
        
        // Configurer les boutons de fermeture
        modalElement.querySelectorAll('[data-bs-dismiss="modal"], .btn-close').forEach(closeButton => {
            const newCloseButton = closeButton.cloneNode(true);
            closeButton.parentNode.replaceChild(newCloseButton, closeButton);
            
            newCloseButton.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                closeModalManually(modalElement, backdrop);
            });
        });
        
        // Fermer en cliquant sur le backdrop
        backdrop.addEventListener('click', function() {
            closeModalManually(modalElement, backdrop);
        });
        
        // Fermer avec Escape
        document.addEventListener('keydown', function escKeyHandler(e) {
            if (e.key === 'Escape') {
                closeModalManually(modalElement, backdrop);
                document.removeEventListener('keydown', escKeyHandler);
            }
        });
    }
    
    // 4. Fonction pour fermer la modale manuellement
    function closeModalManually(modalElement, backdrop) {
        modalElement.style.display = 'none';
        modalElement.classList.remove('show');
        
        if (backdrop) {
            backdrop.style.display = 'none';
        }
        
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }
    
    // 5. Ajouter des styles CSS nécessaires
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        .modal {
            transition: none !important;
        }
        .modal * {
            transition: none !important;
        }
        .modal-backdrop {
            display: none !important;
        }
        .manual-modal-backdrop {
            opacity: 1;
            transition: none !important;
        }
    `;
    document.head.appendChild(styleElement);
    
    console.log('Modal Fix Extreme chargé avec succès');
});