/*
 * modal-fix.js - Robuste fix for Bootstrap modals and dynamic content initialization.
 * v1.0.3 - Centralized dynamic content init, improved focus, robust event handling.
 */
document.addEventListener('DOMContentLoaded', function() {
    const DASH_CONFIG = window.dashboardConfig || { debugMode: false };
    if (DASH_CONFIG.debugMode) console.log('ModalFix: Initializing (v1.0.3)');

    // Fonction pour initialiser le contenu dynamique à l'intérieur d'une modale
    function initializeModalDynamicContent(modalElement) {
        if (!modalElement) return;
        if (DASH_CONFIG.debugMode) console.log('ModalFix: Initializing dynamic content for modal:', modalElement.id);

        // Améliorer les badges de thème
        if (typeof window.enhanceThemeBadgesGlobally === 'function') {
            // Passe l'élément modal comme parent pour cibler uniquement les badges à l'intérieur
            window.enhanceThemeBadgesGlobally(modalElement);
        }

        // Initialiser/Réinitialiser les tooltips Bootstrap
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
            const tooltipTriggerList = [].slice.call(modalElement.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.forEach(function (tooltipTriggerEl) {
                const existingTooltip = bootstrap.Tooltip.getInstance(tooltipTriggerEl);
                if (existingTooltip) {
                    existingTooltip.dispose(); 
                }
                new bootstrap.Tooltip(tooltipTriggerEl); // Créer une nouvelle instance
            });
            if (DASH_CONFIG.debugMode && tooltipTriggerList.length > 0) {
                 console.log(`ModalFix: ${tooltipTriggerList.length} tooltips re-initialized in modal: ${modalElement.id}`);
            }
        }
    }

    // Fonction pour appliquer les corrections de style et gérer le focus
    function applyModalStylingAndFocus(modalElement) {
        if (!modalElement) return;
        if (DASH_CONFIG.debugMode) console.log('ModalFix: Applying styling and focus to modal:', modalElement.id);

        modalElement.style.zIndex = '1055'; 

        modalElement.querySelectorAll('select, .form-select').forEach(select => {
            select.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 1056 !important; position: relative !important; pointer-events: auto !important; -webkit-appearance: listbox !important; appearance: listbox !important;';
        });

        modalElement.querySelectorAll('button:not(.btn-close), .btn:not(.btn-close), input[type="button"], input[type="submit"]').forEach(button => {
            button.style.position = 'relative';
            button.style.zIndex = '1057'; 
            button.style.pointerEvents = 'auto';
        });
        
        modalElement.querySelectorAll('.btn-close').forEach(closeBtn => {
            closeBtn.style.position = 'relative';
            closeBtn.style.zIndex = '1060'; // Assurer qu'il est au-dessus de tout
            closeBtn.style.pointerEvents = 'auto';
        });

        // Gestion du focus améliorée
        // Tenter de focus sur un élément avec autofocus, sinon le premier focusable
        let focusTarget = modalElement.querySelector('[autofocus]:not(:disabled)');
        if (!focusTarget) {
            focusTarget = modalElement.querySelector(
                'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled):not(.btn-close), [href], [tabindex]:not([tabindex="-1"])'
            );
        }
        
        if (focusTarget && typeof focusTarget.focus === 'function') {
            // Léger délai pour s'assurer que la modale est complètement prête pour le focus
            setTimeout(() => {
                try {
                    focusTarget.focus({ preventScroll: true });
                    if (DASH_CONFIG.debugMode) console.log('ModalFix: Focused on:', focusTarget, 'in modal', modalElement.id);
                } catch (e) {
                    if (DASH_CONFIG.debugMode) console.warn('ModalFix: Error focusing on element:', e, focusTarget);
                }
            }, 100); // Un délai un peu plus long peut parfois aider avec les transitions CSS
        }
    }

    // Écouteur d'événement global pour 'shown.bs.modal'
    // Utiliser la délégation d'événement si les modales sont ajoutées dynamiquement,
    // mais document.addEventListener est généralement suffisant pour les modales Bootstrap.
    if (!document.body.dataset.modalFixListenerAttached) { // Empêcher l'attachement multiple
        document.addEventListener('shown.bs.modal', function(event) {
            if (DASH_CONFIG.debugMode) console.log('ModalFix: Global shown.bs.modal triggered for', event.target.id);
            const modal = event.target;
            if (modal && modal.classList.contains('modal')) {
                // Léger délai pour s'assurer que la modale est complètement rendue par Bootstrap
                // et que les transitions CSS sont terminées.
                setTimeout(() => {
                    // S'assurer que la modale est toujours visible (au cas où elle aurait été fermée rapidement)
                    if (modal.classList.contains('show')) { 
                        applyModalStylingAndFocus(modal);
                        initializeModalDynamicContent(modal);
                    }
                }, 100); // Ajustez ce délai si nécessaire (50-150ms est généralement bon)
            }
        });
        document.body.dataset.modalFixListenerAttached = 'true';
    }


    // Optionnel: MutationObserver pour les modales ajoutées dynamiquement APRÈS le chargement initial de la page.
    // Si toutes vos modales sont dans le HTML initial, ce n'est peut-être pas nécessaire.
    if (window.MutationObserver) {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                        const node = mutation.addedNodes[i];
                        // Si un nœud modal est ajouté, Bootstrap devrait déclencher 'shown.bs.modal'
                        // lorsqu'il est affiché, donc les fixes s'appliqueront.
                        if (node.nodeType === 1 && node.classList && node.classList.contains('modal')) {
                            if (DASH_CONFIG.debugMode) console.log('ModalFix: New modal detected in DOM by MutationObserver:', node.id);
                            // Pas besoin d'appeler les fixes ici directement, on se fie à 'shown.bs.modal'
                        }
                    }
                }
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (DASH_CONFIG.debugMode) console.log('ModalFix: Initialization complete (v1.0.3).');
});
