// static/js/ui-fixers.js
// Version 1.0.1 - Corrected querySelectorAll for :contains

document.addEventListener('DOMContentLoaded', function() {
    const config = window.dashboardConfig || { debugMode: false };
    if (config.debugMode) console.log('UI Fixers initialized v1.0.1');
    
    const internalConfig = {
        enhanceLabels: true, fixTooltips: true, fixSessionInfo: true,
        fixSalleDisplay: true, enhanceAccessibility: true,
    };
    
    setTimeout(applyAllFixes, 550); // Slightly increased delay
    
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        const url = args[0].toString();
        if (url.includes('/api/')) {
            setTimeout(applyAllFixes, 350); // Slightly increased delay
        }
        return response;
    };
    
    function applyAllFixes() {
        if (config.debugMode) console.log('UI Fixers: Applying all fixes...');
        if (internalConfig.enhanceLabels) enhanceLabels();
        if (internalConfig.fixTooltips) fixTooltips();
        if (internalConfig.fixSessionInfo) fixSessionInfo();
        if (internalConfig.fixSalleDisplay) fixSalleDisplay();
        if (internalConfig.enhanceAccessibility) enhanceAccessibility();
        if (config.debugMode) console.log('UI Fixers: All fixes applied.');
    }
    
    function enhanceLabels() {
        document.querySelectorAll('a, button').forEach(el => {
            const text = el.textContent.trim();
            if (text === 'Voir Participants' && !el.querySelector('i.fa-users')) {
                el.innerHTML = '<i class="fas fa-users me-1"></i>Liste des participants';
            } else if (text === 'Gérer Salle' && !el.querySelector('i.fa-building')) {
                el.innerHTML = '<i class="fas fa-building me-1"></i>Gérer la salle';
            }
        });
        document.querySelectorAll('.card-header h5, .card-header .card-title').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('Sessions à venir') && !el.querySelector('i.fa-calendar-alt')) {
                el.innerHTML = '<i class="fas fa-calendar-alt me-2"></i>Sessions à venir';
            } else if (text.includes('Participants par service') && !el.querySelector('i.fa-users')) {
                el.innerHTML = '<i class="fas fa-users me-2"></i>Répartition par service';
            } else if (text.includes('Répartition par thème') && !el.querySelector('i.fa-book')) {
                el.innerHTML = '<i class="fas fa-book me-2"></i>Répartition par thème';
            }
        });
    }
    
    function fixTooltips() {
        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
            document.querySelectorAll('[data-bs-toggle="tooltip"], [title]:not(script):not(style)').forEach(el => {
                if (!bootstrap.Tooltip.getInstance(el)) { // Initialize only if not already done
                    try {
                        new bootstrap.Tooltip(el, { boundary: document.body, container: 'body', trigger: 'hover focus' });
                    } catch (e) { console.warn('UI Fixers: Error creating tooltip', e, el); }
                }
            });
            document.querySelectorAll('.salle-badge, .places-dispo, .theme-badge').forEach(el => {
                if (!el.getAttribute('title') && !el.dataset.bsOriginalTitle) { // Check if no title or BS original title
                    let titleText = '';
                    if (el.classList.contains('salle-badge')) titleText = 'Salle assignée';
                    else if (el.classList.contains('places-dispo')) titleText = 'Places disponibles / Capacité';
                    else if (el.classList.contains('theme-badge')) titleText = 'Thème de la formation';
                    
                    if (titleText) {
                        el.setAttribute('title', titleText);
                        if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
                           if (!bootstrap.Tooltip.getInstance(el)) {
                               try { new bootstrap.Tooltip(el, { boundary: document.body, container: 'body' }); }
                               catch (e) { console.warn('UI Fixers: Error creating tooltip for element', e, el); }
                           }
                        }
                    }
                }
            });
        }
    }
    
    function fixSessionInfo() {
        document.querySelectorAll('table tr').forEach(row => {
            const dateCell = row.querySelector('td:first-child');
            const themeCell = row.querySelector('td:nth-child(2).js-theme-cell, td:nth-child(2)[data-column-type="theme"]'); // More specific
            
            if (dateCell && dateCell.innerHTML.includes('/') && !dateCell.querySelector('strong')) {
                const parts = dateCell.innerHTML.split('<br>');
                if (parts.length > 0) {
                    dateCell.innerHTML = `<strong>${parts[0]}</strong>${parts.length > 1 ? `<br>${parts[1]}` : ''}`;
                }
            }
            // Theme badge enhancement is now primarily handled by layout.html's global script
            // This function can focus on other session info aspects if needed.
        });
        document.querySelectorAll('.places-dispo').forEach(el => {
            const text = el.textContent.trim();
            if (text.includes('/')) {
                const [dispo, total] = text.split('/').map(n => parseInt(n.trim(), 10));
                if (!isNaN(dispo) && !isNaN(total)) {
                    let colorClass = 'text-success';
                    if (dispo === 0) colorClass = 'text-danger';
                    else if (dispo <= total * 0.2) colorClass = 'text-danger';
                    else if (dispo <= total * 0.4) colorClass = 'text-warning';
                    
                    el.classList.remove('text-success', 'text-warning', 'text-danger');
                    el.classList.add(colorClass);
                    
                    if (!el.querySelector('i')) {
                        let icon = 'fa-check-circle';
                        if (dispo === 0) icon = 'fa-times-circle';
                        else if (dispo <= total * 0.2) icon = 'fa-exclamation-circle';
                        else if (dispo <= total * 0.4) icon = 'fa-exclamation-triangle';
                        el.innerHTML = `<i class="fas ${icon} me-1"></i> ${dispo} / ${total}`;
                    }
                }
            }
        });
    }
    
    function fixSalleDisplay() {
        // Target elements that are likely to contain salle names
        // Prefer using specific classes on these elements from your Jinja templates
        // e.g., <td class="js-salle-cell">{{ session.obj.salle.nom }}</td>
        document.querySelectorAll('.js-salle-cell, .salle-badge-container').forEach(el => {
            const salleText = el.textContent.trim();
            const isBadgeContainer = el.classList.contains('salle-badge-container');

            if (!salleText || salleText === 'N/A' || salleText.toLowerCase().includes('non définie')) {
                if (isBadgeContainer || !el.querySelector('.badge.bg-secondary')) {
                     el.innerHTML = '<span class="badge bg-secondary text-white salle-badge">Non définie</span>';
                }
            } else if (!el.querySelector('.badge.bg-info') && !el.classList.contains('badge')) {
                // If it's not already a badge, and not the placeholder "Non définie"
                const salleName = salleText.replace(/^Salle\s*/i, '').trim(); // Remove "Salle " prefix if present
                el.innerHTML = `<span class="badge bg-info text-white salle-badge">${salleName || 'Salle'}</span>`;
            }
        });

        // Fallback for less specific cells, be careful with this
        document.querySelectorAll('table td').forEach(cell => {
            // Heuristic: if it's the 4th cell, it might be a salle
            if (cell.cellIndex === 3 && !cell.querySelector('.salle-badge') && !cell.classList.contains('js-salle-cell')) {
                const text = cell.textContent.trim();
                if (text.toLowerCase().includes('salle') || text.match(/^[A-Za-z0-9\s-]+$/) && text.length > 2 && text.length < 30) { // Basic check for room-like names
                     if (text === '' || text === 'N/A' || text.toLowerCase().includes('non définie')) {
                        if (!cell.querySelector('.badge.bg-secondary')) {
                            cell.innerHTML = '<span class="badge bg-secondary salle-badge">Non définie</span>';
                        }
                    } else {
                        if (!cell.querySelector('.badge.bg-info')) {
                            cell.innerHTML = `<span class="badge bg-info text-white salle-badge">${text}</span>`;
                        }
                    }
                }
            }
        });
    }
    
    function enhanceAccessibility() {
        document.querySelectorAll('button:not([aria-label]), a.btn:not([aria-label])').forEach(el => {
            if (!el.getAttribute('aria-label')) {
                const icon = el.querySelector('i');
                let text = el.textContent.trim();
                if (!text && icon && icon.getAttribute('title')) {
                    text = icon.getAttribute('title');
                } else if (!text && el.getAttribute('title')) {
                    text = el.getAttribute('title');
                }
                if (text) el.setAttribute('aria-label', text);
            }
        });
        document.querySelectorAll('.text-muted').forEach(el => {
            el.classList.remove('text-muted');
            el.classList.add('text-secondary');
        });
        document.querySelectorAll('img:not([alt])').forEach(img => {
            img.setAttribute('alt', 'Image ' + (img.getAttribute('src') || 'descriptive').split('/').pop().split('.')[0]);
        });
    }

    window.uiFixers = { applyAllFixes, enhanceLabels, fixTooltips, fixSessionInfo, fixSalleDisplay, enhanceAccessibility };
    
    // Using a more targeted MutationObserver
    if (window.MutationObserver) {
        const observer = new MutationObserver(function(mutations) {
            let needsFixing = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1 && (
                            node.matches('.card, .table, tr, td, .badge, [data-bs-toggle="tooltip"]') ||
                            node.querySelector('.card, .table, tr, td, .badge, [data-bs-toggle="tooltip"]')
                        )) {
                            needsFixing = true;
                            break;
                        }
                    }
                }
                if (needsFixing) break;
            }
            if (needsFixing) {
                if (config.debugMode) console.log('UI Fixers: Relevant DOM change detected, reapplying fixes.');
                setTimeout(applyAllFixes, 150); // Debounce
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    
    if (config.debugMode) console.log('UI Fixers ready! v1.0.1');
});