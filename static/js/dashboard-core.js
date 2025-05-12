// --- START OF FILE static/js/dashboard-core.js ---
/**
 * dashboard-core.js
 * Version: 1.6.8 - Corrected SyntaxError in renderThemeDistributionChartJS, robust initialization and data handling.
 */
document.addEventListener('DOMContentLoaded', function() {
    if (window.dashboardCoreInitialized) {
        console.warn('Dashboard Core (v1.6.8): Already initialized. Skipping.');
        return;
    }
    window.dashboardCoreInitialized = true;
    console.log('Dashboard Core (v1.6.8): Initializing...');

    const globalLoadingOverlay = document.getElementById('loading-overlay');
    const dashInitConfig = window.dashboardConfig || {};
    const config = {
        debugMode: dashInitConfig.debugMode || false,
        refreshInterval: dashInitConfig.autoRefreshInterval || 120000,
        minRefreshDelay: dashInitConfig.minRefreshDelay || 30000,
        debounceDelay: dashInitConfig.debounceDelay || 1000,
        baseApiUrl: dashInitConfig.baseApiUrl || '/api',
        chartRendering: dashInitConfig.chartRendering || 'auto',
        usingDashboardInit: !!dashInitConfig.autoRefreshInterval || !!dashInitConfig.preferredMode,
        errorThrottleMode: false,
        fetchTimeoutDuration: 15000
    };

    if (config.debugMode) console.log(`Dashboard Core: Configured`, JSON.parse(JSON.stringify(config)));

    let dashboardState = {
        lastRefresh: 0, updating: false,
        dataHashes: { sessions: null, participants: null, activites: null },
        rawData: { sessions: [], participants: [], activites: [] },
        errorCount: 0, maxErrors: 5, pollingActive: true,
        pollingTimeout: null, pollingTimeoutScheduled: false,
        fetchTimeoutId: null
    };

    const errorHandler = window.apiErrorHandler || {
        handleApiError: (e,d,s) => { console.error(`FallbackErr: ${s} on ${e}`,d); if(typeof window.showToast==='function')window.showToast(`Err ${s} loading ${e}`,'danger'); return false;},
        checkAndFixBrokenElements: () => { if(config.debugMode)console.log("DB Core: Fallback checkAndFix."); fixDataIssues(); enhanceBadgesAndLabels(); }
    };

    function initializeDashboard() {
        enhanceUI();
        if (typeof window.chartModule === 'object' && typeof window.chartModule.initialize === 'function') {
            window.chartModule.initialize().catch(e => console.error("Chart init error via chartModule:", e));
        } else {
            initializeChartsFallback();
        }

        if (!config.usingDashboardInit) {
            setupEventListeners(); startPolling();
        } else {
            // Ensure these are available for dashboard-init.js
            if (typeof window.forcePollingUpdate !== 'function') window.forcePollingUpdate = (force) => debouncedFetchDashboardData(force);
            if (typeof window.updateStatsCounters !== 'function') window.updateStatsCounters = updateStatisticsCounters;
            if (typeof window.refreshRecentActivity !== 'function') window.refreshRecentActivity = () => updateActivityFeed(null);
            if (typeof window.chartModule !== 'object' || typeof window.chartModule.initialize !== 'function') {
                 window.chartModule = { 
                    initialize: initializeChartsFallback, 
                    update: updateChartsFallback 
                };
            }
        }
        debouncedFetchDashboardData(true);
        if (config.debugMode) console.log('Dashboard Core: Init sequence complete.');
    }

    function startPolling() {
        if (config.usingDashboardInit && config.preferredMode !== 'polling' && DASH_CONFIG.activeMode !== 'polling') return;
        if (dashboardState.pollingTimeout) clearTimeout(dashboardState.pollingTimeout);
        dashboardState.pollingTimeoutScheduled = false;
        function scheduleNextPoll() {
            if (dashboardState.pollingTimeoutScheduled || !dashboardState.pollingActive) return;
            dashboardState.pollingTimeoutScheduled = true;
            dashboardState.pollingTimeout = setTimeout(async () => {
                dashboardState.pollingTimeoutScheduled = false;
                if (dashboardState.pollingActive && document.visibilityState === 'visible' && !dashboardState.updating) {
                    try { await debouncedFetchDashboardData(false); } catch (err) { console.error("DB Core: Poll error:", err); }
                    finally { if (dashboardState.pollingActive) scheduleNextPoll(); }
                } else if (dashboardState.pollingActive) scheduleNextPoll();
            }, config.refreshInterval);
        }
        scheduleNextPoll();
    }

    function setupEventListeners() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && dashboardState.pollingActive) debouncedFetchDashboardData(false);
            else if (document.visibilityState === 'hidden' && dashboardState.pollingTimeout) { clearTimeout(dashboardState.pollingTimeout); dashboardState.pollingTimeoutScheduled = false; }
        });
        const btn = document.getElementById('refresh-dashboard');
        if (btn) {
            btn.addEventListener('click', function() {
                this.disabled = true; this.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i>Actualisation...';
                if (globalLoadingOverlay) { globalLoadingOverlay.style.display = 'flex'; globalLoadingOverlay.classList.remove('hidden');}
                debouncedFetchDashboardData(true)
                    .then(u => { if(typeof window.showToast==='function'){if(u===true)window.showToast('Données à jour','success');else if(u===false)window.showToast('Pas de nouveauté.','info');} if(!dashboardState.pollingActive){dashboardState.pollingActive=true;dashboardState.errorCount=0;showErrorWarning(false);startPolling();}})
                    .catch(e => { if(typeof window.showToast==='function')window.showToast('Erreur refresh.','danger');})
                    .finally(() => { const cb=document.getElementById('refresh-dashboard'); if(cb){cb.disabled=false;cb.innerHTML='<i class="fas fa-sync-alt me-1"></i>Actualiser';} if(globalLoadingOverlay&&!dashboardState.updating){globalLoadingOverlay.style.display='none';globalLoadingOverlay.classList.add('hidden');}});
            });
        }
        setupValidationListeners(); setupMutationObserver();
    }

    function setupMutationObserver() {
        if (!window.MutationObserver) return; let t = null;
        new MutationObserver(m => { if(m.some(mu=>mu.type==='childList'&&mu.addedNodes.length>0&&Array.from(mu.addedNodes).some(n=>n.nodeType===1&&n.classList&&(n.classList.contains('places-dispo')||n.classList.contains('theme-badge')||n.classList.contains('counter-value')||n.querySelector('.places-dispo,.theme-badge,.counter-value'))))){clearTimeout(t);t=setTimeout(()=>{fixDataIssues();enhanceBadgesAndLabels();},300);}}).observe(document.body,{childList:true,subtree:true});
    }

    async function _fetchDashboardData(forceRefresh = false) {
        if (dashboardState.updating && !forceRefresh) return Promise.resolve(false);
        if (config.errorThrottleMode && !forceRefresh) return Promise.resolve(false);
        const now = Date.now();
        if (!forceRefresh && (now - dashboardState.lastRefresh < config.minRefreshDelay)) return Promise.resolve(false);
        dashboardState.updating = true;
        if (!forceRefresh || (forceRefresh && (now - dashboardState.lastRefresh >= config.minRefreshDelay))) dashboardState.lastRefresh = now;
        let currentUrl = '';
        if (globalLoadingOverlay && forceRefresh) { globalLoadingOverlay.style.display = 'flex'; globalLoadingOverlay.classList.remove('hidden'); }
        try {
            currentUrl = `${config.baseApiUrl}/dashboard_essential?_=${Date.now()}`;
            const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), config.fetchTimeoutDuration);
            const response = await fetch(currentUrl, { method: 'GET', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' }, signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) { let eD={message:`HTTP err ${response.status}`,status:response.status}; try{eD=await response.clone().json();}catch(e){} if(response.status>=500&&!config.errorThrottleMode){config.errorThrottleMode=true;setTimeout(()=>{config.errorThrottleMode=false;},60000);} errorHandler.handleApiError(currentUrl,eD,response.status); return false; }
            const data = await response.json();
            if (!data || typeof data !== 'object') { errorHandler.handleApiError(currentUrl,{message:"Invalid data format"},response.status); return false; }
            dashboardState.rawData = data; const hasChanged = processData(data, forceRefresh);
            dashboardState.errorCount = 0; showErrorWarning(false);
            if (hasChanged) document.dispatchEvent(new CustomEvent('dashboardDataRefreshed', { detail: { data: data } }));
            return hasChanged;
        } catch (error) {
            errorHandler.handleApiError(currentUrl, { message: error.message, name: error.name }, 0);
            dashboardState.errorCount++;
            if (dashboardState.errorCount >= 3 && !config.errorThrottleMode) { config.errorThrottleMode = true; setTimeout(() => { config.errorThrottleMode = false; }, 120000); }
            if (dashboardState.errorCount >= dashboardState.maxErrors && dashboardState.pollingActive) { dashboardState.pollingActive = false; if (dashboardState.pollingTimeout) clearTimeout(dashboardState.pollingTimeout); dashboardState.pollingTimeoutScheduled = false; showErrorWarning(true); }
            return undefined;
        } finally {
            dashboardState.updating = false;
            if (globalLoadingOverlay && forceRefresh) { setTimeout(() => { if (!dashboardState.updating) { globalLoadingOverlay.style.display = 'none'; globalLoadingOverlay.classList.add('hidden'); } }, 200); }
        }
    }

    function debouncedFetchDashboardData(forceRefresh = false) {
        if (forceRefresh) { if (dashboardState.fetchTimeoutId) { clearTimeout(dashboardState.fetchTimeoutId); dashboardState.fetchTimeoutId = null; } return _fetchDashboardData(true); }
        if (dashboardState.fetchTimeoutId) return Promise.resolve(false);
        return new Promise(resolve => { dashboardState.fetchTimeoutId = setTimeout(async () => { dashboardState.fetchTimeoutId = null; try { const r = await _fetchDashboardData(false); resolve(r); } catch (e) { resolve(undefined); } }, config.debounceDelay); });
    }

    function processData(data, forceRefresh = false) {
        if (!data || typeof data !== 'object') { if(config.debugMode)console.warn("ProcessData: Invalid data. Static content kept."); return false; }
        let hasChanged = forceRefresh;
        if (data.sessions && Array.isArray(data.sessions)) {
            const vS = data.sessions.map(s => ({ ...s, inscrits:parseInt(s.inscrits)||0, liste_attente:parseInt(s.liste_attente)||0, max_participants:parseInt(s.max_participants)||0, places_restantes:(s.places_restantes!==undefined&&!isNaN(parseInt(s.places_restantes)))?parseInt(s.places_restantes):Math.max(0,(parseInt(s.max_participants)||0)-(parseInt(s.inscrits)||0))}));
            const sH = simpleHash(vS);
            if (sH !== dashboardState.dataHashes.sessions || forceRefresh) {
                updateSessionTable(vS); updateStatisticsCounters(vS);
                dashboardState.dataHashes.sessions = sH; hasChanged = true;
            }
        } else if (forceRefresh) { /* Optionally clear if forced and no data */ }

        if (data.participants && Array.isArray(data.participants) && data.sessions && Array.isArray(data.sessions)) {
             const pH = simpleHash(data.participants);
             if (pH !== dashboardState.dataHashes.participants || hasChanged || forceRefresh) {
                 if (typeof window.chartModule === 'object' && typeof window.chartModule.update === 'function') {
                    window.chartModule.update(data.sessions, data.participants).catch(e => console.error("Chart update error via chartModule:", e));
                 } else {
                    updateChartsFallback(data.sessions, data.participants);
                 }
                 dashboardState.dataHashes.participants = pH;
                 if (pH !== dashboardState.dataHashes.participants && !hasChanged) hasChanged = true; 
             }
        } else if (forceRefresh) { /* Optionally clear charts */ }
        
        if (data.activites && Array.isArray(data.activites)) {
            const aH = simpleHash(data.activites);
            if (aH !== dashboardState.dataHashes.activites || forceRefresh) {
                if (typeof window.refreshRecentActivity === 'function') {
                    window.refreshRecentActivity(data.activites).catch(e => console.error("Activity refresh error via global func:", e));
                } else {
                    updateActivityFeed(data.activites);
                }
                dashboardState.dataHashes.activites = aH; hasChanged = true;
            }
        } else if (forceRefresh) { /* Optionally clear activities */ }

        if (hasChanged) setTimeout(() => { fixDataIssues(); enhanceBadgesAndLabels(); initTooltips(); errorHandler.checkAndFixBrokenElements(); }, 150);
        return hasChanged;
    }

    function updateSessionTable(sessions) {
        if (!sessions || !Array.isArray(sessions)) return;
        const sTB = document.querySelector('.session-table tbody, #sessions-table tbody'); if (!sTB) return;
        sTB.innerHTML = ''; if (sessions.length === 0) { const c = sTB.closest('table')?.querySelectorAll('thead th').length || 6; sTB.innerHTML = `<tr class="no-data-row"><td colspan="${c}" class="text-center p-4 text-muted">Aucune session.</td></tr>`; return; }
        sessions.forEach(s => {
            const mP=parseInt(s.max_participants)||0; const pR=parseInt(s.places_restantes); let pC='text-secondary',pI='fa-question-circle';
            if(typeof pR==='number'&&!isNaN(pR)){if(pR<=0){pC='text-danger';pI='fa-times-circle';}else if(pR<=Math.floor(mP*0.3)){pC='text-warning';pI='fa-exclamation-triangle';}else{pC='text-success';pI='fa-check-circle';}}
            const pendingCount = parseInt(s.pending_count) || 0;
            const pendingBadge = pendingCount > 0 ? `<span class="validation-badge bg-warning text-dark"><i class="fas fa-exclamation-circle"></i>${pendingCount}</span>` : `<span class="text-muted">-</span>`;
            const rH=`<tr class="session-row" data-session-id="${s.id}" data-theme="${s.theme||'N/A'}" data-full="${pR<=0?'1':'0'}"><td><span class="fw-bold d-block">${s.date||'N/A'}</span><small class="text-secondary">${s.horaire||'N/A'}</small></td><td class="theme-cell"><span class="theme-badge" data-theme="${s.theme||'N/A'}" title="${(window.themesDataForChart&&window.themesDataForChart[s.theme])?escapeHtml(window.themesDataForChart[s.theme].description):''}" data-bs-toggle="tooltip">${s.theme||'N/A'}</span></td><td class="places-dispo text-nowrap ${pC}"><i class="fas ${pI} me-1"></i> ${typeof pR==='number'&&!isNaN(pR)?pR:'?'} / ${mP}</td><td>${pendingBadge}</td><td class="js-salle-cell">${s.salle||'<span class="badge bg-light text-dark">Non définie</span>'}</td><td class="text-nowrap text-center"><div class="btn-group btn-group-sm" role="group"><button type="button" class="btn btn-outline-primary" data-bs-toggle="modal" data-bs-target="#viewParticipantsModal${s.id}" title="Voir participants"><i class="fas fa-users"></i></button><button type="button" class="btn btn-outline-success" data-bs-toggle="modal" data-bs-target="#inscriptionModal_${s.id}" title="Inscrire"><i class="fas fa-plus-circle"></i></button>${(typeof current_user !== 'undefined' && current_user.is_authenticated && current_user.role === 'admin') ? `<button type="button" class="btn btn-outline-secondary" data-bs-toggle="modal" data-bs-target="#attribuerSalleModal${s.id}" title="Attribuer salle"><i class="fas fa-door-open"></i></button>` : ''}</div></td></tr>`;
            sTB.insertAdjacentHTML('beforeend',rH);
        });
        enhanceBadgesAndLabels(); initTooltips();
    }

    function updateStatisticsCounters(sessions) {
        let stats={totalInscriptions:0,totalEnAttente:0,totalSessions:0,totalSessionsCompletes:0};
        if(!sessions||!Array.isArray(sessions)){updateCounter('total-inscriptions',0);updateCounter('total-en-attente',0);updateCounter('total-sessions',0);updateCounter('total-sessions-completes',0);return stats;}
        stats.totalSessions=sessions.length;
        sessions.forEach(sess=>{
            const i=parseInt(sess.inscrits)||0;
            const pR=parseInt(sess.places_restantes);
            const pending = parseInt(sess.pending_count) || 0; // Utiliser pending_count pour totalEnAttente
            stats.totalInscriptions+=i;
            stats.totalEnAttente+=pending; // Mettre à jour ici
            if((!isNaN(pR)&&pR<=0)||(isNaN(pR)&&(parseInt(sess.max_participants)||0)-i<=0))stats.totalSessionsCompletes++;
        });
        updateCounter('total-inscriptions',stats.totalInscriptions);updateCounter('total-en-attente',stats.totalEnAttente);updateCounter('total-sessions',stats.totalSessions);updateCounter('total-sessions-completes',stats.totalSessionsCompletes);
        return stats;
    }

    function updateCounter(id,val){const el=document.getElementById(id);if(!el)return;const cV=parseInt(el.textContent.replace(/[^\d-]/g,''))||0;const nV=parseInt(val)||0;if(cV!==nV||el.textContent==='—'||el.textContent.trim()===''){el.textContent=nV.toLocaleString();el.classList.remove('text-muted');el.classList.add('updated');setTimeout(()=>el.classList.remove('updated'),500);}}
    
    function escapeHtml(unsafe){
        if(typeof unsafe !== 'string') return unsafe === null || typeof unsafe === 'undefined' ? '' : String(unsafe);
        return unsafe
             .replace(/&/g, "&")
             .replace(/</g, "<")
             .replace(/>/g, ">")
             .replace(/"/g, """)
             .replace(/'/g, "'");
    }

    function updateActivityFeed(activities){if(activities===null){fetch(`${config.baseApiUrl}/activites?limit=5`).then(r=>r.ok?r.json():Promise.reject(r)).then(d=>updateActivityFeed(d)).catch(e=>{const c=document.getElementById('recent-activity');if(c)c.innerHTML='<div class="list-group-item text-center p-3 text-danger"><i class="fas fa-exclamation-triangle me-1"></i>Err load activités.</div>';});return Promise.reject("Fetching");} const c=document.getElementById('recent-activity');if(!c)return Promise.resolve(false); const s=c.querySelector('.loading-spinner');if(s)s.remove(); if(!activities||!Array.isArray(activities)||activities.length===0){c.innerHTML='<div class="list-group-item text-center p-3 text-muted">Aucune activité.</div>';return Promise.resolve(true);} let h='';activities.forEach(a=>{const i=getActivityIcon(a.type);const u=a.user?`<span class="text-primary fw-bold ms-1">(${escapeHtml(a.user)})</span>`:'';const d=escapeHtml(a.description||'Activité');const dt=a.details?`<p class="mb-1 activity-details"><small>${escapeHtml(a.details)}</small></p>`:'';h+=`<a href="${config.baseApiUrl}/../activites_journal?type=${encodeURIComponent(a.type||'default')}" class="list-group-item list-group-item-action activity-item type-${a.type||'default'}" data-activity-id="${a.id}"><div class="d-flex w-100 justify-content-between"><h6 class="mb-1 activity-title"><i class="${i} me-2 activity-icon"></i>${d} ${u}</h6><small class="text-muted activity-time">${a.date_relative||''}</small></div>${dt}</a>`;});c.innerHTML=h;return Promise.resolve(true);}
    function getActivityIcon(type){const m={'connexion':'fas fa-sign-in-alt text-success','deconnexion':'fas fa-sign-out-alt text-warning','inscription':'fas fa-user-plus text-primary','validation':'fas fa-check-circle text-success','refus':'fas fa-times-circle text-danger','annulation':'fas fa-ban text-danger','ajout_participant':'fas fa-user-plus text-primary','suppression_participant':'fas fa-user-minus text-danger','modification_participant':'fas fa-user-edit text-warning','reinscription':'fas fa-redo text-info','liste_attente':'fas fa-clock text-warning','ajout_theme':'fas fa-folder-plus text-primary','ajout_service':'fas fa-building text-primary','ajout_salle':'fas fa-door-open text-primary','attribution_salle':'fas fa-map-marker-alt text-info','systeme':'fas fa-cog text-secondary','notification':'fas fa-bell text-warning','telecharger_invitation':'fas fa-file-download text-info','ajout_document':'fas fa-file-upload text-info','suppression_document':'fas fa-file-excel text-danger','default':'fas fa-info-circle text-secondary'};return m[type]||m.default;}
    function enhanceUI(){initTooltips();enhanceBadgesAndLabels();fixDataIssues();enhanceAccessibility();}
    function initTooltips(){if(typeof bootstrap==='undefined'||typeof bootstrap.Tooltip!=='function')return;document.querySelectorAll('.tooltip').forEach(t=>t.remove());[...document.querySelectorAll('[data-bs-toggle="tooltip"], [title]:not(iframe):not(script):not(style)')].map(el=>{const i=bootstrap.Tooltip.getInstance(el);if(i)i.dispose();try{return new bootstrap.Tooltip(el,{container:'body',boundary:document.body});}catch(e){return null;}});}
    function enhanceBadgesAndLabels(){if(typeof window.enhanceThemeBadgesGlobally==='function')window.enhanceThemeBadgesGlobally();else{document.querySelectorAll('.theme-badge').forEach(b=>{if(b.dataset.enhanced==='true')return;const tN=b.dataset.theme||b.textContent.trim();b.textContent=tN;b.classList.remove('theme-comm','theme-planner','theme-onedrive','theme-sharepoint','bg-secondary');let iC='fa-tag';if(tN.includes('Teams')&&tN.includes('Communiquer')){b.classList.add('theme-comm');iC='fa-comments';}else if(tN.includes('Planner')){b.classList.add('theme-planner');iC='fa-tasks';}else if(tN.includes('OneDrive')||tN.includes('fichiers')){b.classList.add('theme-onedrive');iC='fa-file-alt';}else if(tN.includes('Collaborer')){b.classList.add('theme-sharepoint');iC='fa-users';}else b.classList.add('bg-secondary');if(!b.querySelector('i.fas')&&iC)b.insertAdjacentHTML('afterbegin',`<i class="fas ${iC} me-1"></i>`);b.dataset.enhanced='true';});}document.querySelectorAll('.js-salle-cell').forEach(c=>{const tC=c.textContent.trim();if(!c.querySelector('.salle-badge')&&tC)c.innerHTML=(tC==='Non définie'||tC==='N/A'||tC==='')?'<span class="badge bg-light text-dark salle-badge">Non définie</span>':`<span class="badge bg-info text-dark salle-badge">${escapeHtml(tC)}</span>`;});}
    function fixDataIssues(){document.querySelectorAll('.places-dispo').forEach(el=>{const txt=el.textContent.trim();if(txt.includes('/')){const p=txt.split('/');const a=parseInt(p[0].trim()),t=parseInt(p[1].trim());if(isNaN(a)||isNaN(t)){el.className='places-dispo text-nowrap text-secondary';el.innerHTML='<i class="fas fa-question-circle me-1"></i> ? / ?';el.title='Données indisponibles';return;}let i,c;if(a<=0){i='fa-times-circle';c='text-danger';}else if(a<=0.2*t){i='fa-exclamation-circle';c='text-danger';}else if(a<=0.4*t){i='fa-exclamation-triangle';c='text-warning';}else{i='fa-check-circle';c='text-success';}const cI=el.querySelector('.fas');if(!cI||!cI.classList.contains(i)||!el.classList.contains(c)){el.className=`places-dispo text-nowrap ${c}`;el.innerHTML=`<i class="fas ${i} me-1"></i> ${a} / ${t}`;}}else if(txt==='NaN / NaN'||txt.includes('undefined')||txt==='/ '||txt===' / '||txt.includes('null')||txt==='? / ?'||txt.trim()===''){if(!el.innerHTML.includes('fa-question-circle')){el.className='places-dispo text-nowrap text-secondary';el.innerHTML='<i class="fas fa-question-circle me-1"></i> ? / ?';el.title='Données indisponibles';}}});document.querySelectorAll('.counter-value, .badge-count').forEach(c=>{const t=c.textContent.trim();if(t===''||t==='undefined'||t==='null'||t==='NaN'||t==='—'){c.textContent='—';c.classList.add('text-muted');c.title='Valeur indisponible';}else if(c.classList.contains('counter-value')&&!isNaN(parseInt(t)))c.textContent=(parseInt(t)).toLocaleString();});document.querySelectorAll('table tbody').forEach(tb=>{if(!tb.querySelector('tr')||(tb.children.length===1&&tb.firstElementChild.classList.contains('no-data-row'))){if(!tb.querySelector('tr.no-data-row')){const co=tb.closest('table')?.querySelectorAll('thead th').length||5;tb.innerHTML=`<tr class="no-data-row"><td colspan="${co}" class="text-center p-3 text-muted"><i class="fas fa-info-circle me-2"></i>Aucune donnée.`+(typeof window.forcePollingUpdate==='function'?'<button class="btn btn-sm btn-outline-secondary ms-3" onclick="window.forcePollingUpdate(true);"><i class="fas fa-sync me-1"></i>Actualiser</button>':'')+'</td></tr>';}}else if(tb.querySelector('tr.no-data-row')&&tb.children.length>1){const ndr=tb.querySelector('tr.no-data-row');if(ndr)ndr.remove();}});checkAndFixHangingModals();}
    function checkAndFixHangingModals(){const b=document.querySelector('.modal-backdrop.show, .portal-backdrop[style*="display: block"]'),vM=document.querySelector('.modal.show, .portal-modal[style*="display: block"]');if(b&&!vM){b.remove();document.body.classList.remove('modal-open');document.body.style.overflow='';document.body.style.paddingRight='';}const vMs=document.querySelectorAll('.modal.show');if(vMs.length>0&&!document.querySelector('.modal-backdrop.show')){}}
    function enhanceAccessibility(){document.querySelectorAll('img:not([alt])').forEach(i=>{const fN=i.src.split('/').pop().split('?')[0],n=fN.split('.')[0].replace(/[_-]/g,' ');i.setAttribute('alt',n||'Image');});document.querySelectorAll('button:not([type])').forEach(b=>b.setAttribute('type',b.closest('form')?'submit':'button'));}
    function showErrorWarning(show){let eD=document.getElementById('backend-error-warning');if(show&&!eD){eD=document.createElement('div');eD.id='backend-error-warning';eD.className='alert alert-danger alert-dismissible fade show small p-2 mt-2 mx-auto text-center';eD.style.maxWidth='800px';eD.setAttribute('role','alert');eD.innerHTML='<i class="fas fa-ethernet me-2"></i> Problème communication serveur. Rafraîchissement auto en pause. <button type="button" class="btn-link text-decoration-underline p-0 ms-2 fw-bold" onclick="document.getElementById(\'refresh-dashboard\')?.click(); this.closest(\'.alert\').remove();">Réessayer</button> <button type="button" class="btn-close p-2" data-bs-dismiss="alert" aria-label="Close"></button>';const mCA=document.querySelector('.container-fluid#main-content, main.content-wrapper, #dashboard-content');if(mCA)mCA.insertBefore(eD,mCA.firstChild);else document.body.insertBefore(eD,document.body.firstChild);}else if(!show&&eD)eD.remove();}
    function setupValidationListeners(){document.body.addEventListener('click',function(event){const b=event.target.closest('.validation-ajax');if(!b)return;const iId=b.getAttribute('data-inscription-id'),act=b.getAttribute('data-action');if(!iId||!act)return;b.disabled=true;const oT=b.innerHTML;b.innerHTML='<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';fetch('/validation_inscription_ajax',{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':getCsrfToken()},body:JSON.stringify({inscription_id:iId,action:act})}).then(r=>(!r.ok)?r.json().then(eD=>Promise.reject({status:r.status,data:eD})):r.json()).then(d=>{if(d.success){if(typeof window.showToast==='function')window.showToast(d.message,'success');debouncedFetchDashboardData(true);setTimeout(()=>{const m=b.closest('.modal, .portal-modal');if(m){if(m.classList.contains('portal-modal')&&window.portalModal)window.portalModal.hideModal(m.id);else if(typeof bootstrap!=='undefined'&&bootstrap.Modal.getInstance(m))bootstrap.Modal.getInstance(m).hide();}},1000);}else{if(typeof window.showToast==='function')window.showToast(d.message||'Erreur validation','danger');}}).catch(e=>{const eM=(e.data&&e.data.message)?e.data.message:'Erreur communication validation.';if(typeof window.showToast==='function')window.showToast(eM,'danger');}).finally(()=>{const cB=document.querySelector(`.validation-ajax[data-inscription-id="${iId}"][data-action="${act}"]`);if(cB){cB.disabled=false;cB.innerHTML=oT;}});});}
    
    function initializeChartsFallback(){if(config.chartRendering==='none')return Promise.resolve();renderStaticChartsJS(null,null);return Promise.resolve();}
    function updateChartsFallback(sessions,participants){if(config.chartRendering==='none')return Promise.resolve();const vS=sessions||dashboardState.rawData.sessions||[];const vP=participants||dashboardState.rawData.participants||[];renderStaticChartsJS(vS,vP);return Promise.resolve();}
    function renderStaticChartsJS(sessions,participants){const tC=document.getElementById('themeChartStatic'),sC=document.getElementById('serviceChartStatic');if(tC){if(sessions&&Array.isArray(sessions)&&sessions.length>0)renderThemeDistributionChartJS(sessions);else if(!tC.querySelector('.static-chart-legend')&&!tC.querySelector('.no-data-message'))tC.innerHTML='<div class="loading-spinner"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Chargement...</span></div><p>Chargement données thèmes...</p></div>';}if(sC){if(participants&&Array.isArray(participants)&&participants.length>0)renderParticipantByServiceChartJS(participants);else if(!sC.querySelector('.static-chart-bars')&&!sC.querySelector('.no-data-message'))sC.innerHTML='<div class="loading-spinner"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Chargement...</span></div><p>Chargement données services...</p></div>';}}
    function renderThemeDistributionChartJS(sessionsData) {
    const chartContainer = document.getElementById('themeChartStatic');
    if (!chartContainer) return;

    if (!sessionsData || !Array.isArray(sessionsData)) {
        chartContainer.innerHTML = '<div class="no-data-message text-center p-3"><i class="fas fa-exclamation-triangle me-2"></i>Données de session invalides pour le graphique.</div>';
        return;
    }

    const themeInscriptionCounts = sessionsData.reduce((acc, session) => {
        const themeName = session.theme || 'Non défini';
        const inscrits = parseInt(session.inscrits) || 0;
        acc[themeName] = (acc[themeName] || 0) + inscrits;
        return acc;
    }, {});

    const totalInscriptionsTheme = Object.values(themeInscriptionCounts).reduce((sum, count) => sum + count, 0);

    if (totalInscriptionsTheme === 0) {
        chartContainer.innerHTML = '<div class="no-data-message text-center p-3"><i class="fas fa-info-circle me-2"></i>Aucune inscription pour afficher la répartition par thème.</div>';
        return;
    }

    let legendHtml = '';
    let svgSegmentsHtml = '';
    const themesConfig = window.themesDataForChart || {}; // S'assurer que c'est bien défini globalement
    const sortedThemes = Object.entries(themeInscriptionCounts).sort(([, countA], [, countB]) => countB - countA);
    
    const radius = 15.9154943092; 
    const strokeWidth = 5; 
    let currentRotationAngle = 0; // Angle de rotation pour chaque segment

    sortedThemes.forEach(([themeName, count], index) => {
        if (count === 0) return;

        const percentage = (count / totalInscriptionsTheme) * 100;
        const themeConfig = themesConfig[themeName] || {};
        const color = themeConfig.color || getRandomColor(index); // getRandomColor doit être définie
        const description = themeConfig.description || themeName;

        // Le stroke-dashoffset est toujours 0 pour cette méthode de dessin de segments avec rotation
        // Chaque segment est un cercle complet, mais seulement une portion est visible grâce à stroke-dasharray
        // et il est tourné pour se positionner correctement.
        svgSegmentsHtml += `
            <circle class="donut-svg-segment"
                    cx="21" cy="21" r="${radius}"
                    fill="transparent"
                    stroke="${color}"
                    stroke-width="${strokeWidth}"
                    stroke-dasharray="${percentage} ${100 - percentage}"
                    transform="rotate(${currentRotationAngle} 21 21)">
                <title>${escapeHtml(themeName)}: ${count} (${percentage.toFixed(1)}%)</title>
            </circle>`;
        currentRotationAngle += (percentage * 3.6); // Mettre à jour l'angle pour le prochain segment

        legendHtml += `
            <div class="legend-item" title="${escapeHtml(description)}">
                <span class="legend-color" style="background-color: ${color};"></span>
                <span class="legend-label">${escapeHtml(themeName)}</span>
                <span class="legend-value">${count}</span>
            </div>`;
    });
    
    const svgHtml = `
        <svg viewBox="0 0 42 42" class="donut-svg" width="160" height="160" aria-labelledby="chartTitle_themes_static_js" role="img">
            <title id="chartTitle_themes_static_js">Répartition des inscriptions par thème</title>
            ${svgSegmentsHtml}
            <g class="donut-svg-center-text" transform="rotate(90 21 21)">
                <text x="21" y="21" style="font-size:7px;">
                    <tspan class="donut-total" x="21" dy="-0.2em">${totalInscriptionsTheme}</tspan>
                    <tspan class="donut-label" x="21" dy="1.2em">INSCRITS</tspan>
                </text>
            </g>
        </svg>`;

    chartContainer.innerHTML = `
        <div class="static-chart-title">INSCRIPTIONS PAR THÈME</div>
        <div class="static-chart-donut-svg-container">${svgHtml}</div>
        <div class="static-chart-legend">${legendHtml}</div>`;
}

function renderParticipantByServiceChartJS(participantsData) {
    const chartContainer = document.getElementById('serviceChartStatic');
    if (!chartContainer) return;

    if (!participantsData || !Array.isArray(participantsData)) {
        chartContainer.innerHTML = '<div class="no-data-message text-center p-3"><i class="fas fa-exclamation-triangle me-2"></i>Données participants invalides pour le graphique.</div>';
        return;
    }
    
    const serviceCounts = participantsData.reduce((acc, participant) => {
        const serviceName = participant.service || 'Non défini';
        // Utiliser servicesDataForChart pour la couleur si disponible, sinon la couleur du participant, sinon gris
        const serviceConfig = (window.servicesDataForChart && window.servicesDataForChart[serviceName]) ? window.servicesDataForChart[serviceName] : {};
        const color = serviceConfig.color || participant.service_color || '#6c757d';

        if (!acc[serviceName]) {
            acc[serviceName] = { count: 0, color: color };
        }
        acc[serviceName].count++;
        return acc;
    }, {});

    const totalParticipants = participantsData.length;

    if (totalParticipants === 0) {
        chartContainer.innerHTML = '<div class="no-data-message text-center p-3"><i class="fas fa-info-circle me-2"></i>Aucun participant pour afficher la distribution par service.</div>';
        return;
    }

    const sortedServices = Object.entries(serviceCounts).sort(([, dataA], [, dataB]) => dataB.count - dataA.count);
    let barsHtml = '';
    const maxCount = Math.max(1, ...sortedServices.map(([, data]) => data.count)); // Eviter division par zéro

    sortedServices.forEach(([serviceName, data], index) => {
        if (data.count === 0) return;
        const percentage = (data.count / maxCount) * 100;
        const serviceClass = serviceName.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'non-defini';
        
        barsHtml += `
            <div class="bar-item animate" style="--index:${index};">
                <div class="bar-header">
                    <span class="bar-label" title="${escapeHtml(serviceName)} (${data.count} participant(s))">
                       <span class="service-badge me-2" style="background-color:${data.color};"></span>
                       ${escapeHtml(serviceName)}
                    </span>
                    <span class="bar-total">${data.count}</span>
                </div>
                <div class="bar-container">
                    <div class="bar-value ${serviceClass}" style="width:${percentage}%; background-color:${data.color}; --percent:${percentage}%;"></div>
                </div>
            </div>`;
    });

    chartContainer.innerHTML = `
        <div class="static-chart-title">PARTICIPANTS PAR SERVICE</div>
        <div class="static-chart-bars">${barsHtml}</div>`;
}

// S'assurer que getRandomColor et escapeHtml sont définies si elles sont utilisées
function getRandomColor(index) {
    const colors = ['#4e73df','#1cc88a','#36b9cc','#f6c23e','#e74a3b','#858796','#5a5c69','#fd7e14','#6f42c1','#d63384'];
    return colors[index % colors.length];
}


    window.dashboardCore={initialize:initializeDashboard,fetchData:debouncedFetchDashboardData,updateCharts:updateChartsFallback,updateStatistics:updateStatisticsCounters,updateActivity:updateActivityFeed,getState:()=>JSON.parse(JSON.stringify(dashboardState)),getConfig:()=>JSON.parse(JSON.stringify(config)),renderThemeChart:renderThemeDistributionChartJS,renderServiceChart:renderParticipantByServiceChartJS,initializeCharts:initializeChartsFallback,startPolling:startPolling,stopPolling:()=>{dashboardState.pollingActive=false;if(dashboardState.pollingTimeout)clearTimeout(dashboardState.pollingTimeout);dashboardState.pollingTimeoutScheduled=false;}};
    
    // S'assurer que les fonctions sont bien exposées globalement AVANT que dashboard-init.js ne s'exécute
    if (typeof window.forcePollingUpdate === 'undefined') window.forcePollingUpdate = debouncedFetchDashboardData;
    if (typeof window.updateStatsCounters === 'undefined') window.updateStatsCounters = updateStatisticsCounters;
    if (typeof window.refreshRecentActivity === 'undefined') window.refreshRecentActivity = () => updateActivityFeed(null);
    if (typeof window.chartModule === 'undefined' || typeof window.chartModule.initialize !== 'function') {
        window.chartModule = { 
            initialize: initializeChartsFallback, 
            update: updateChartsFallback 
        };
    }
    
    initializeDashboard();
});
