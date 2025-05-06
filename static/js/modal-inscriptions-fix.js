/**
 * modal-inscriptions-fix.js
 * Correctif spécifique pour les problèmes de modales d'inscription et d'ajout de participants
 */
document.addEventListener('DOMContentLoaded', function() {
  console.log('Correctif modales inscription chargé');
  
  // Fix 1: Correction des problèmes de z-index et de visibilité des modales
  function fixModalDisplay() {
    // Assurer que les modales sont correctement positionnées et visibles
    document.querySelectorAll('.modal').forEach(modal => {
      modal.style.zIndex = '1055';
      
      // Correction des sélecteurs dans les modales
      modal.querySelectorAll('select, .form-select').forEach(select => {
        select.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 2000 !important; position: relative !important; pointer-events: auto !important; -webkit-appearance: listbox !important; appearance: listbox !important;';
      });

      // Correction des boutons dans les modales
      modal.querySelectorAll('button, .btn').forEach(button => {
        button.style.cssText = 'position: relative !important; z-index: 2001 !important; pointer-events: auto !important;';
      });
      
      // Correction des champs de formulaire
      modal.querySelectorAll('input, textarea').forEach(input => {
        input.style.cssText = 'position: relative !important; z-index: 1999 !important; pointer-events: auto !important;';
      });
    });
  }

  // Fix 2: Correction des événements de soumission des formulaires d'inscription
  function fixInscriptionForms() {
    // Identifier les formulaires d'inscription dans les modales
    document.querySelectorAll('.modal form').forEach(form => {
      // Retirer les gestionnaires d'événements existants qui pourraient interférer
      const newForm = form.cloneNode(true);
      form.parentNode.replaceChild(newForm, form);
      
      // Ajouter un nouvel écouteur d'événements
      newForm.addEventListener('submit', function(e) {
        console.log('Soumission du formulaire interceptée');
        
        // Vérifier si tous les champs requis sont remplis
        const requiredFields = newForm.querySelectorAll('[required]');
        let allFilled = true;
        
        requiredFields.forEach(field => {
          if (!field.value.trim()) {
            allFilled = false;
            field.classList.add('is-invalid');
          } else {
            field.classList.remove('is-invalid');
          }
        });
        
        if (!allFilled) {
          e.preventDefault();
          console.log('Formulaire incomplet');
          
          // Afficher un message d'erreur
          const errorAlert = document.createElement('div');
          errorAlert.className = 'alert alert-danger mt-2';
          errorAlert.textContent = 'Veuillez remplir tous les champs requis.';
          
          // Supprimer les alertes existantes
          newForm.querySelectorAll('.alert-danger').forEach(alert => alert.remove());
          
          // Ajouter la nouvelle alerte
          newForm.appendChild(errorAlert);
          return false;
        }
        
        console.log('Formulaire valide, soumission en cours');
        // La soumission se poursuit normalement
      });
    });
  }

  // Fix 3: Correction spécifique pour la modale d'inscription participant
  function fixInscriptionModal() {
    // Cibler spécifiquement la modale d'inscription
    const inscriptionModals = document.querySelectorAll('#inscriptionModal, [id^="inscriptionModal_"]');
    
    inscriptionModals.forEach(modal => {
      if (!modal) return;
      
      // S'assurer que la modale est visible et fonctionnelle
      modal.classList.add('modal-fixed');
      modal.style.zIndex = '1060';
      
      // Correction des sélecteurs de participants
      const participantSelects = modal.querySelectorAll('select[name="participant_id"]');
      participantSelects.forEach(select => {
        select.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 2000 !important; position: relative !important; pointer-events: auto !important; -webkit-appearance: listbox !important; appearance: listbox !important;';
        
        // Ajouter un gestionnaire d'événements pour détecter les changements
        select.addEventListener('change', function() {
          console.log('Participant sélectionné:', this.value);
        });
      });
      
      // Correction des boutons de validation
      const submitButtons = modal.querySelectorAll('button[type="submit"], input[type="submit"]');
      submitButtons.forEach(button => {
        button.style.cssText = 'position: relative !important; z-index: 2005 !important; pointer-events: auto !important;';
        
        // Renforcer le gestionnaire d'événements
        button.addEventListener('click', function(e) {
          console.log('Bouton de soumission cliqué');
          
          // Vérifier si un participant est sélectionné
          const participantSelect = modal.querySelector('select[name="participant_id"]');
          if (participantSelect && !participantSelect.value) {
            e.preventDefault();
            alert('Veuillez sélectionner un participant.');
            return false;
          }
        });
      });
    });
  }

  // Fix 4: Correction de la modale d'ajout de nouveau participant
  function fixNewParticipantModal() {
    // Cibler la modale pour ajouter un nouveau participant
    const newParticipantModal = document.querySelector('#nouveauParticipantModal');
    
    if (newParticipantModal) {
      newParticipantModal.style.zIndex = '1065';
      
      // Correction des champs de formulaire
      newParticipantModal.querySelectorAll('input, select').forEach(field => {
        field.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 2000 !important; position: relative !important; pointer-events: auto !important;';
      });
      
      // Correction du bouton d'ajout
      const addButton = newParticipantModal.querySelector('button.btn-success');
      if (addButton) {
        addButton.style.cssText = 'position: relative !important; z-index: 2005 !important; pointer-events: auto !important;';
        
        // Renforcer le gestionnaire d'événements
        addButton.addEventListener('click', function(e) {
          console.log('Bouton d\'ajout cliqué');
          
          // Vérifier les champs requis
          const requiredFields = newParticipantModal.querySelectorAll('[required]');
          let allFilled = true;
          
          requiredFields.forEach(field => {
            if (!field.value.trim()) {
              allFilled = false;
              field.classList.add('is-invalid');
            } else {
              field.classList.remove('is-invalid');
            }
          });
          
          if (!allFilled) {
            e.preventDefault();
            alert('Veuillez remplir tous les champs obligatoires.');
            return false;
          }
        });
      }
    }
  }

  // Fix 5: Correction générale pour les boutons qui ouvrent des modales
  function fixModalTriggers() {
    // Cibler tous les boutons qui ouvrent des modales
    document.querySelectorAll('[data-bs-toggle="modal"]').forEach(trigger => {
      trigger.addEventListener('click', function(e) {
        const targetSelector = this.getAttribute('data-bs-target') || this.getAttribute('href');
        if (!targetSelector) return;
        
        const modalElement = document.querySelector(targetSelector);
        if (!modalElement) return;
        
        console.log('Ouverture de la modale:', targetSelector);
        
        // Appliquer les correctifs après un court délai
        setTimeout(() => {
          // Forcer l'ouverture de la modale
          modalElement.classList.add('show');
          modalElement.style.display = 'block';
          document.body.classList.add('modal-open');
          
          // Créer un backdrop si nécessaire
          if (!document.querySelector('.modal-backdrop')) {
            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop fade show';
            document.body.appendChild(backdrop);
          }
          
          // Appliquer les correctifs spécifiques
          fixModalDisplay();
          fixInscriptionForms();
          fixInscriptionModal();
          fixNewParticipantModal();
          
          // Focus sur le premier champ de formulaire
          const firstInput = modalElement.querySelector('input, select');
          if (firstInput) firstInput.focus();
        }, 150);
      });
    });
  }

  // Fix 6: Optimisation de l'ajout de participant depuis la modale d'inscription
  function fixParticipantAddFlow() {
    // Rechercher les liens ou boutons pour "Nouveau participant"
    document.querySelectorAll('.nouveau-participant-btn, a[href="#nouveauParticipantModal"], [data-bs-target="#nouveauParticipantModal"]').forEach(button => {
      button.addEventListener('click', function(e) {
        console.log('Bouton Nouveau participant cliqué');
        
        // Capturer la session_id de la modale parent
        const parentModal = this.closest('.modal');
        if (parentModal) {
          const sessionIdField = parentModal.querySelector('input[name="session_id"]');
          if (sessionIdField) {
            const sessionId = sessionIdField.value;
            console.log('Session ID détectée:', sessionId);
            
            // Stocker dans sessionStorage pour la récupérer dans la modale d'ajout
            sessionStorage.setItem('redirect_session_id', sessionId);
          }
        }
      });
    });
    
    // Dans la modale d'ajout de participant, récupérer la session_id
    const newParticipantModal = document.querySelector('#nouveauParticipantModal');
    if (newParticipantModal) {
      newParticipantModal.addEventListener('show.bs.modal', function() {
        const sessionId = sessionStorage.getItem('redirect_session_id');
        if (sessionId) {
          console.log('Ajout pour la session:', sessionId);
          
          // Créer ou mettre à jour le champ caché
          let redirectField = newParticipantModal.querySelector('input[name="redirect_session_id"]');
          if (!redirectField) {
            redirectField = document.createElement('input');
            redirectField.type = 'hidden';
            redirectField.name = 'redirect_session_id';
            newParticipantModal.querySelector('form').appendChild(redirectField);
          }
          redirectField.value = sessionId;
          
          // Ajouter un champ pour indiquer l'action après l'ajout
          let actionField = newParticipantModal.querySelector('input[name="action_after_add"]');
          if (!actionField) {
            actionField = document.createElement('input');
            actionField.type = 'hidden';
            actionField.name = 'action_after_add';
            newParticipantModal.querySelector('form').appendChild(actionField);
          }
          actionField.value = 'inscription';
        }
      });
    }
  }

  // Appliquer tous les correctifs
  function applyAllFixes() {
    fixModalDisplay();
    fixInscriptionForms();
    fixInscriptionModal();
    fixNewParticipantModal();
    fixModalTriggers();
    fixParticipantAddFlow();
    console.log('Tous les correctifs pour les modales d\'inscription ont été appliqués');
  }

  // Appliquer les correctifs immédiatement
  applyAllFixes();

  // Réappliquer après des changements dans le DOM
  const observer = new MutationObserver(function(mutations) {
    let needsFixing = false;
    
    mutations.forEach(function(mutation) {
      if (mutation.addedNodes.length > 0) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node.nodeType === 1 && (
            node.classList && node.classList.contains('modal') ||
            node.querySelector && node.querySelector('.modal')
          )) {
            needsFixing = true;
            break;
          }
        }
      }
    });
    
    if (needsFixing) {
      setTimeout(applyAllFixes, 10);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Exposer les fonctions pour le débogage si nécessaire
  window.modalInscriptionFix = {
    applyAllFixes,
    fixModalDisplay,
    fixInscriptionForms,
    fixInscriptionModal,
    fixNewParticipantModal,
    fixModalTriggers,
    fixParticipantAddFlow
  };
});