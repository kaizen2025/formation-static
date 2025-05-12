// --- START OF FILE static/js/global-modal-fix.js ---
/**
 * global-modal-fix.js - Solution JS globale et simplifiée pour les modaux Bootstrap
 * v1.0.0 - Se concentre sur l'initialisation des composants et le focus.
 * S'appuie sur modern-modal-fixes.css pour l'affichage.
 */
(function() {
    'use strict';

    const config = {
        debug: (window.dashboardConfig && window.dashboardConfig.debugMode) || false,
        log: function(message) {
            if (this.debug) console.log("GlobalModalFix:", message);
        }
    };

    config.log("Initializing global modal fix...");

    /**
     * Initialise les composants Bootstrap (tooltips) à l'intérieur d'un modal.
     * Gère le focus sur le premier élément interactif.
     * Assure le bon fonctionnement des onglets.
     */
    function setupModalInternals(modalElement) {
        if (!modalElement) return;
        const modalId = modalElement.id || 'unknownModal';
        config.log(`Setting up internals for modal: ${modalId}`);

        // 1. Initialiser les tooltips Bootstrap dans le modal
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
            const tooltipTriggerList = [].slice.call(modalElement.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.forEach(function (tooltipTriggerEl) {
                // Détruire l'ancien tooltip s'il existe pour éviter les doublons
                const existingTooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                if (existingTooltip) {
                    existingTooltip.dispose();
                }
                new bootstrap.Tooltip(tooltipTriggerEl);
            });
            config.log(`Tooltips initialized for modal: ${modalId}`);
        }

        // 2. Gérer le focus sur le premier élément interactif
        // Le focus est généralement géré par Bootstrap, mais on peut le forcer si besoin.
        // Le JS spécifique à la fin de chaque modal (_inscription_modal_simple.html, etc.)
        // gère déjà le focus de manière ciblée. Ce bloc est donc un fallback.
        setTimeout(() => {
            const firstFocusableElement = modalElement.querySelector(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (firstFocusableElement && document.activeElement !== firstFocusableElement) {
                // Ne pas forcer le focus si un script spécifique l'a déjà fait
                // ou si Bootstrap l'a bien géré.
                // firstFocusableElement.focus();
                // config.log(`Attempted to focus on first element in modal: ${modalId}`);
            }
        }, 150); // Léger délai pour laisser Bootstrap faire son travail

        // 3. Assurer le bon fonctionnement des onglets (si présents)
        const tabTriggers = modalElement.querySelectorAll('[data-bs-toggle="tab"]');
        tabTriggers.forEach(tabTrigger => {
            // Bootstrap gère nativement l'activation des onglets.
            // On peut ajouter des écouteurs si des actions spécifiques sont nécessaires au changement d'onglet.
            tabTrigger.addEventListener('shown.bs.tab', function (event) {
                config.log(`Tab shown in modal ${modalId}: ${event.target.getAttribute('data-bs-target')}`);
                // Réinitialiser les tooltips dans le nouveau panneau d'onglet actif
                const activeTabPane = document.querySelector(event.target.getAttribute('data-bs-target'));
                if (activeTabPane && typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
                    const tooltipsInPane = [].slice.call(activeTabPane.querySelectorAll('[data-bs-toggle="tooltip"]'));
                    tooltipsInPane.forEach(function (tooltipEl) {
                        const existing = bootstrap.Tooltip.getInstance(tooltipEl);
                        if (existing) existing.dispose();
                        new bootstrap.Tooltip(tooltipEl);
                    });
                }
                // Améliorer les badges de thème dans le nouveau panneau
                if (activeTabPane && typeof window.enhanceThemeBadgesGlobally === 'function') {
                    window.enhanceThemeBadgesGlobally(activeTabPane);
                }
            });
        });
         // Améliorer les badges de thème dans le modal initialement
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            window.enhanceThemeBadgesGlobally(modalElement);
        }
    }

    // Écouter l'événement 'shown.bs.modal' pour tous les modaux
    document.addEventListener('shown.bs.modal', function(event) {
        setupModalInternals(event.target);
    });
    
    // Correctif pour les boutons qui ouvrent d'autres modaux depuis un modal
    // (Ex: bouton "Inscrire un participant" dans le modal des participants)
    document.querySelectorAll('.modal button[data-bs-toggle="modal"]').forEach(button => {
        button.addEventListener('click', function(event) {
            const currentModalElement = button.closest('.modal');
            if (currentModalElement) {
                const currentBsModal = bootstrap.Modal.getInstance(currentModalElement);
                if (currentBsModal) {
                    // Cacher le modal actuel avant d'ouvrir le nouveau
                    // Bootstrap devrait gérer cela, mais on s'assure
                    // currentBsModal.hide(); 
                    // Note: Laisser Bootstrap gérer la transition entre modaux est souvent plus fluide.
                    // Si des problèmes persistent, on peut forcer la fermeture ici.
                    config.log(`Button clicked to open another modal. Current modal: ${currentModalElement.id}`);
                }
            }
        });
    });


    config.log("Global modal fix initialized.");
})();
