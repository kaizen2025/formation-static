/**
 * modal-fixes.css - Correctifs CSS consolidés pour les modaux de l'application
 * v2.0.0 - Styles robustes pour visibilité, z-index, et interaction.
 */

/* Styles fondamentaux pour les modaux (classe .modal-fix à ajouter aux modaux) */
.modal-fix {
    z-index: 1055 !important; /* Au-dessus du backdrop par défaut (1050) */
}

.modal-fix .modal-dialog {
    z-index: 1056 !important; /* Au-dessus du modal lui-même */
    margin: 1.75rem auto !important; /* Standard Bootstrap */
}

.modal-fix .modal-content {
    z-index: 1057 !important; /* Au-dessus du dialog */
    box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15) !important;
    border: none !important; /* Supprimer les bordures par défaut si elles causent des problèmes */
}

/* Assurer la visibilité et l'interaction des éléments de formulaire et autres */
.modal-fix input:not([type="hidden"]),
.modal-fix textarea,
.modal-fix button:not([type="hidden"]), /* Exclure les boutons cachés */
.modal-fix label,
.modal-fix .form-label,
.modal-fix .form-control, /* Classe générique pour inputs/textareas */
.modal-fix .invalid-feedback,
.modal-fix .form-text,
.modal-fix small, 
.modal-fix p, 
.modal-fix h1, .modal-fix h2, .modal-fix h3, .modal-fix h4, .modal-fix h5, .modal-fix h6,
.modal-fix .badge,
.modal-fix .alert,
.modal-fix .btn-group,
.modal-fix i.fas, .modal-fix i.far, .modal-fix i.fa, .modal-fix i.fab /* Icônes FontAwesome */
 {
    display: block !important; /* Par défaut, la plupart des éléments de formulaire sont block */
    visibility: visible !important;
    opacity: 1 !important;
    position: relative !important; /* Important pour le contexte de stacking et éviter les problèmes de positionnement absolu */
    z-index: auto !important; /* Laisser le navigateur gérer dans le contexte du modal-content, sauf si spécifiquement requis */
    pointer-events: auto !important; /* Assurer qu'ils sont cliquables/interactifs */
}

/* Ajustements spécifiques pour certains éléments inline-block */
.modal-fix button:not([type="hidden"]):not(.btn-close),
.modal-fix .btn:not(.btn-close), /* Exclure le bouton de fermeture Bootstrap */
.modal-fix .badge,
.modal-fix i.fas, .modal-fix i.far, .modal-fix i.fa, .modal-fix i.fab {
    display: inline-block !important; /* Les boutons et badges sont souvent inline */
}

/* Amélioration des sélecteurs (très important) */
.modal-fix select,
.modal-fix .form-select {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    position: relative !important;
    z-index: 1060 !important; /* Doit être au-dessus du contenu du modal pour être cliquable */
    pointer-events: auto !important;
    -webkit-appearance: menulist !important; /* Forcer l'apparence native pour éviter les problèmes de rendu */
    -moz-appearance: menulist !important;
    appearance: menulist !important;
    background-image: none !important; /* Supprimer les flèches custom de Bootstrap si elles posent problème */
    padding-right: 0.75rem !important; /* Standard Bootstrap */
    width: 100% !important;
    color: #212529 !important; /* Assurer la lisibilité du texte */
    background-color: #ffffff !important; /* Fond blanc standard */
    cursor: pointer !important;
    border: 1px solid #ced4da !important; /* Bordure standard Bootstrap */
    border-radius: 0.375rem !important; /* Rayon standard Bootstrap */
}
.modal-fix select option,
.modal-fix .form-select option {
    color: #212529 !important;
    background-color: #ffffff !important;
}


/* Boutons dans le footer ou body */
.modal-fix .modal-footer .btn,
.modal-fix .modal-body .btn {
    position: relative !important; /* Nécessaire pour que z-index s'applique correctement */
    z-index: 1070 !important; /* Au-dessus des autres éléments du corps/footer */
    display: inline-block !important;
    cursor: pointer !important;
}

/* Correction pour le bouton de fermeture Bootstrap (croix) */
.modal-fix .btn-close {
    z-index: 1080 !important; /* Au-dessus de tout dans le modal-header */
    position: relative !important; /* Pour que z-index s'applique */
    opacity: 1 !important; /* Assurer la visibilité */
    pointer-events: auto !important;
    /* Bootstrap s'occupe du reste du style pour btn-close */
}

/* Gestion des onglets (Tabs) */
.modal-fix .nav-tabs,
.modal-fix .nav-pills {
    display: flex !important; /* Assurer l'affichage correct des onglets */
    visibility: visible !important;
    opacity: 1 !important;
    z-index: 1060 !important; /* Au-dessus du contenu de base du modal */
}
.modal-fix .nav-link {
    pointer-events: auto !important;
    cursor: pointer !important;
    position: relative !important; /* Pour z-index et stacking */
    z-index: 1061 !important; /* Au-dessus du conteneur d'onglets */
    display: block !important; /* Assurer l'affichage */
    visibility: visible !important;
    opacity: 1 !important;
}
.modal-fix .tab-content {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
}
.modal-fix .tab-pane {
    display: none !important; /* Caché par défaut */
    visibility: hidden !important; /* Complément à display:none */
    opacity: 0 !important; /* Transition douce si activée */
    width: 100% !important; /* S'assurer qu'il prend toute la largeur */
}
.modal-fix .tab-pane.active,
.modal-fix .tab-pane.show { /* Bootstrap 5 utilise .show.active */
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
}

/* Tableaux dans les modaux */
.modal-fix table,
.modal-fix .table,
.modal-fix .table-responsive { /* table-responsive est souvent un div wrapper */
    display: block !important; /* Pour .table-responsive, sinon 'table' pour <table> */
    visibility: visible !important;
    opacity: 1 !important;
    width: 100% !important;
}
.modal-fix table { display: table !important; } /* Spécifique pour l'élément table */

.modal-fix thead { display: table-header-group !important; visibility: visible !important; opacity: 1 !important; }
.modal-fix tbody { display: table-row-group !important; visibility: visible !important; opacity: 1 !important; }
.modal-fix tr { display: table-row !important; visibility: visible !important; opacity: 1 !important; }
.modal-fix th,
.modal-fix td { display: table-cell !important; visibility: visible !important; opacity: 1 !important; }


/* Anti-scintillement (Peut aider avec les transitions CSS) */
.modal.fade.show {
    transform: translateZ(0); /* Force l'accélération matérielle */
    -webkit-backface-visibility: hidden; /* Pour Safari/Chrome */
    backface-visibility: hidden;
}

/* Backdrop (arrière-plan sombre) */
.modal-backdrop {
    z-index: 1050 !important; /* Standard, mais on le réaffirme */
}
.modal-backdrop.fade { opacity: 0 !important; } /* Commence transparent */
.modal-backdrop.show { opacity: 0.5 !important; } /* Opacité standard de Bootstrap */


/* Styles pour les navigateurs spécifiques si des problèmes persistent */
/* Chrome, Safari */
@media screen and (-webkit-min-device-pixel-ratio:0) { 
    .modal-fix select,
    .modal-fix .form-select {
        -webkit-appearance: menulist !important;
        background-image: none !important; /* Peut être nécessaire si la flèche par défaut interfère */
    }
}
/* Firefox */
@-moz-document url-prefix() {
    .modal-fix select,
    .modal-fix .form-select {
        -moz-appearance: menulist !important;
        background-image: none !important;
    }
}

/* Améliorations pour l'affichage mobile */
@media (max-width: 576px) {
    .modal-fix .modal-dialog {
        margin: 0.5rem auto !important; /* Moins de marge sur mobile */
        max-width: 96% !important; /* Un peu de marge sur les côtés */
    }
    .modal-fix .modal-header,
    .modal-fix .modal-footer {
        padding: 0.75rem 1rem !important; /* Padding réduit pour petits écrans */
    }
    .modal-fix .modal-body {
        padding: 1rem !important; /* Padding réduit pour petits écrans */
    }
}
