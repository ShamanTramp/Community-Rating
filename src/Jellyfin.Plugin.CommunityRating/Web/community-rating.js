(function () {
    'use strict';

    if (window.__communityRatingLoaded) return;
    window.__communityRatingLoaded = true;

    const styleId = 'communityRatingStyles';
    const cache = new Map();
    const tooltipCache = new Map();
    let options = null;
    let isAdmin;
    let isAdminPromise;
    let refreshQueued = false;
    let scanning = false;
    let cacheRevision = 0;
    const customSortStates = new Map();
    const managedCollections = new Map();
    let collectionDiscovery = null;
    let collectionDiscoveryTime = 0;
    let lastSortContext = null;
    let pendingSortSelection = null;
    const sortModeIds = { views: 'CommunityRatingViews', likes: 'CommunityRatingLikes', recommendations: 'CommunityRatingRecommendations', discouragements: 'CommunityRatingDiscouragements' };
    const personalVotes = new Map();
    const translations = {
        en: {
            viewLabel: count => `Viewed by ${count} member${count === 1 ? '' : 's'}`,
            likeLabel: count => `Liked by ${count} member${count === 1 ? '' : 's'}`,
            recommendLabel: count => `Recommended by ${count} member${count === 1 ? '' : 's'}`,
            discourageLabel: count => `Discouraged by ${count} member${count === 1 ? '' : 's'}`,
            sortViews: 'Viewed by members', sortLikes: 'Liked by members', sortRecommendations: 'Recommended by members', sortDiscouragements: 'Discouraged by members', noMembers: 'No members', voteError: 'Could not save your vote.'
        },
        fr: {
            viewLabel: count => `Vu par ${count} membre${count === 1 ? '' : 's'}`,
            likeLabel: count => `Aimé par ${count} membre${count === 1 ? '' : 's'}`,
            recommendLabel: count => `Recommandé par ${count} membre${count === 1 ? '' : 's'}`,
            discourageLabel: count => `Déconseillé par ${count} membre${count === 1 ? '' : 's'}`,
            sortViews: 'Vus par les membres', sortLikes: 'Aimés par les membres', sortRecommendations: 'Recommandés par les membres', sortDiscouragements: 'Déconseillés par les membres', noMembers: 'Aucun membre', voteError: 'Impossible d’enregistrer votre vote.'
        }
    };

    function uiLanguage() {
        const locale = document.documentElement.lang || (typeof navigator !== 'undefined' && navigator.language) || 'en';
        return String(locale).toLowerCase().split(/[-_]/)[0];
    }

    function translate(key, ...args) {
        const value = translations[uiLanguage()]?.[key] ?? translations.en[key] ?? key;
        return typeof value === 'function' ? value(...args) : value;
    }

    const styles = `
        .cr-badge-stack{display:flex;flex-direction:var(--cr-card-direction,row);align-items:flex-start;gap:4px;position:absolute;z-index:5;top:var(--cr-inset-y,8px);left:var(--cr-inset-x,3px);max-width:calc(100% - var(--cr-inset-x,3px) - var(--cr-reserved-right,32px));pointer-events:none}
        .cr-badge{align-items:center;display:inline-flex;gap:.25em;padding:.12em .4em;border-radius:999px;background:rgba(0,0,0,var(--cr-bg-opacity,.45));color:#fff;font-size:var(--cr-size,16px);font-weight:600;line-height:1.3;text-shadow:0 1px 2px rgba(0,0,0,.8);white-space:nowrap;pointer-events:auto;cursor:default}
        .cr-badge svg{width:1em;height:1em;flex:none;fill:currentColor}
        .cr-badge .cr-count{color:#fff}
        .cr-badge:focus-visible{outline:2px solid var(--accent-color,#00a4dc);outline-offset:2px}
        .cr-badge.cr-vote{border:0;font:inherit;cursor:pointer;transition:color .12s ease,background-color .12s ease}
        .cr-badge.cr-vote[data-kind="recommend"]{color:var(--cr-recommend-color,#fff)}
        .cr-badge.cr-vote[data-kind="discourage"]{color:var(--cr-discourage-color,#fff)}
        .cr-badge.cr-vote[data-kind="recommend"][data-count]:not([data-count="0"]){color:#43d17b}
        .cr-badge.cr-vote[data-kind="discourage"][data-count]:not([data-count="0"]){color:#ff5a62}
        .cr-badge.cr-vote[data-count="0"]::after{content:"0";visibility:hidden;pointer-events:none}
        .cr-badge.cr-vote[data-kind="recommend"]:hover,.cr-badge.cr-vote[data-kind="recommend"]:focus-visible{color:#43d17b}
        .cr-badge.cr-vote[data-kind="discourage"]:hover,.cr-badge.cr-vote[data-kind="discourage"]:focus-visible{color:#ff5a62}
        .cr-badge.cr-vote[aria-pressed="true"][data-kind="recommend"]{color:#43d17b}
        .cr-badge.cr-vote[aria-pressed="true"][data-kind="discourage"]{color:#ff5a62}
        .cr-badge-stack.cr-layout-grid{display:grid;grid-template-columns:repeat(2,max-content);}
        .cr-badge-stack.cr-layout-column{display:flex;flex-direction:column;}
        .detailPagePrimaryContent.cr-details-top-host{padding-top:0}
        .cr-details-stack{display:flex;flex-wrap:wrap;align-items:flex-start;align-self:flex-start;justify-content:center;gap:.65em;order:-1;flex:0 0 auto;width:100%;max-width:100%;box-sizing:border-box;clear:none;margin:0 0 .5em}
        .cr-details-stack .cr-badge{font-size:var(--cr-detail-size,var(--cr-size,16px))}
        .cr-tooltip{position:fixed;z-index:99999;max-width:min(320px,80vw);max-height:40vh;overflow:auto;padding:.65em .85em;border:1px solid var(--card-bracket-color,rgba(255,255,255,.16));border-radius:.55em;background:var(--card-background-color,rgba(25,25,25,.96));color:var(--primary-text-color,#fff);box-shadow:0 8px 24px rgba(0,0,0,.35);font-size:.9rem;line-height:1.5;white-space:pre-line;pointer-events:none}
        .cr-tooltip[hidden]{display:none}
    `;

    const eyeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5.5 0-9.7 4.1-11 7 1.3 2.9 5.5 7 11 7s9.7-4.1 11-7c-1.3-2.9-5.5-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z"/></svg>';
    const heartIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8.5-5.1-10.5-10C-1 4.9 6.5 1 12 7c5.5-6 13-2.1 10.5 4C20.5 15.9 12 21 12 21Z"/></svg>';

    function apiUrl(path, ids) {
        const base = ApiClient.getUrl('CommunityRating/' + path);
        return base + (base.includes('?') ? '&' : '?') + 'ids=' + ids.map(encodeURIComponent).join('&ids=');
    }

    function communitySortMode(sortBy) {
        const first = (Array.isArray(sortBy) ? sortBy.join(',') : String(sortBy || '')).split(',')[0];
        return Object.keys(sortModeIds).find(mode => sortModeIds[mode] === first) || null;
    }

    async function loadManagedCollections() {
        if (collectionDiscovery || Date.now() - collectionDiscoveryTime < 30000) return collectionDiscovery || managedCollections;
        collectionDiscoveryTime = Date.now();
        collectionDiscovery = ApiClient.getJSON(ApiClient.getUrl('CommunityRating/Collections'))
            .then(rows => {
                managedCollections.clear();
                for (const row of rows || []) managedCollections.set(String(row.Id).toLowerCase(), row.Key);
                return managedCollections;
            })
            .catch(() => managedCollections)
            .finally(() => { collectionDiscovery = null; });
        return collectionDiscovery;
    }

    async function rankKefinCollection(items, key) {
        if (!Array.isArray(items) || !items.length) return items;
        const counts = new Map();
        for (let start = 0; start < items.length; start += 100) {
            const response = await ApiClient.getJSON(apiUrl('Items', items.slice(start, start + 100).map(item => item.Id)));
            for (const item of response.Items || []) counts.set(item.ItemId.toLowerCase(), item);
        }
        const metric = key.split('-').at(-1);
        const property = { views: 'ViewCount', likes: 'LikeCount', recommended: 'RecommendationCount', discouraged: 'DiscouragementCount' }[metric];
        return items.map(item => {
            const rating = counts.get(item.Id.toLowerCase())?.[property] || 0;
            item.__communityRatingCollection = key;
            item.__communityRatingRank = rating;
            item.CommunityRating = rating;
            return item;
        }).sort((left, right) => right.__communityRatingRank - left.__communityRatingRank
            || (left.SortName || left.Name || '').localeCompare(right.SortName || right.Name || '', undefined, { sensitivity: 'base' }));
    }

    function installKefinCollectionAdapter() {
        loadManagedCollections();
        const helper = window.apiHelper;
        if (helper?.getItems && !helper.getItems.__communityRatingInstalled) {
            const getItems = helper.getItems;
            const wrapped = async function (query = {}, useCache, ...rest) {
                let collectionKey = managedCollections.get(String(query.ParentId || '').toLowerCase());
                if (!collectionKey && query.ParentId && collectionDiscovery) {
                    await collectionDiscovery;
                    collectionKey = managedCollections.get(String(query.ParentId).toLowerCase());
                }
                if (!collectionKey) return getItems.call(this, query, useCache, ...rest);
                const response = await getItems.call(this, { ...query, SortBy: 'Default', StartIndex: 0 }, false, ...rest);
                response.Items = await rankKefinCollection(response.Items || [], collectionKey);
                response.TotalRecordCount = response.TotalRecordCount ?? response.Items.length;
                return response;
            };
            wrapped.__communityRatingInstalled = true;
            helper.getItems = wrapped;
        }

        const builder = window.cardBuilder;
        if (!builder || builder.__communityRatingCollectionsInstalled) return;
        const rankItems = items => [...items].sort((left, right) => right.__communityRatingRank - left.__communityRatingRank
            || (left.SortName || left.Name || '').localeCompare(right.SortName || right.Name || '', undefined, { sensitivity: 'base' }));
        if (typeof builder.sortItems === 'function') {
            const sortItems = builder.sortItems;
            builder.sortItems = function (items, ...rest) {
                if (Array.isArray(items) && items.some(item => item.__communityRatingCollection)) return rankItems(items);
                return sortItems.call(this, items, ...rest);
            };
        }
        for (const method of ['renderCards', 'renderSpotlightSection']) {
            if (typeof builder[method] !== 'function') continue;
            const original = builder[method];
            builder[method] = function (items, ...rest) {
                if (Array.isArray(items) && items.some(item => item.__communityRatingCollection)) items = rankItems(items);
                return original.call(this, items, ...rest);
            };
        }
        builder.__communityRatingCollectionsInstalled = true;
    }

    function querySignature(query) {
        return JSON.stringify(Object.keys(query)
            .filter(key => !['StartIndex', 'Limit', 'SortBy', 'SortOrder'].includes(key))
            .sort()
            .map(key => [key, query[key]]));
    }

    function supportedItemTypes(query) {
        const types = (Array.isArray(query?.IncludeItemTypes) ? query.IncludeItemTypes
            : String(query?.IncludeItemTypes || '').split(',')).filter(Boolean);
        return types.some(type => ['Movie', 'Series', 'Episode'].includes(type));
    }

    function supportedSortPage() {
        if (lastSortContext?.route === location.hash && supportedItemTypes(lastSortContext.query)) return true;
        const route = location.hash.split('?')[0];
        if (/^#\/(movies|tv|tvshows|shows)(?:\.html)?$/.test(route)) return true;
        const type = new URLSearchParams(location.hash.split('?')[1] || location.search).get('type');
        if (type) return ['Movie', 'Series', 'Episode', 'favoritemovies'].includes(type);
        return Array.from(document.querySelectorAll('.page:not(.hide) .card[data-type], .page:not(.hide) .listItem[data-type]'))
            .some(item => ['Movie', 'Series', 'Episode'].includes(item.getAttribute('data-type')));
    }

    async function getCommunityCounts(items) {
        const counts = new Map();
        for (let start = 0; start < items.length; start += 100) {
            const ids = items.slice(start, start + 100).map(item => item.Id);
            const response = await ApiClient.getJSON(apiUrl('Items', ids));
            for (const item of response.Items || []) counts.set(item.ItemId.toLowerCase(), item);
        }
        return counts;
    }

    function orderCommunityItems(state, sortOrder) {
        const key = { views: 'ViewCount', likes: 'LikeCount', recommendations: 'RecommendationCount', discouragements: 'DiscouragementCount' }[state.mode];
        const direction = sortOrder === 'Ascending' ? 1 : -1;
        return [...state.items].sort((left, right) => {
            const leftCount = state.counts.get(left.Id.toLowerCase())?.[key] || 0;
            const rightCount = state.counts.get(right.Id.toLowerCase())?.[key] || 0;
            const countOrder = (leftCount - rightCount) * direction;
            if (countOrder !== 0) return countOrder;
            return (left.SortName || left.Name || '').localeCompare(right.SortName || right.Name || '', undefined, { sensitivity: 'base' });
        });
    }

    function prepareCommunitySort(query, state, userId, client, getItems) {
        if (state.pending) return state.pending;
        const request = {
            ...query,
            SortBy: 'SortName',
            SortOrder: 'Ascending',
            StartIndex: 0,
            Limit: 500,
            EnableTotalRecordCount: true
        };
        state.pending = (async () => {
            const allItems = [];
            let total = 0;
            do {
                const result = await getItems.call(client, userId, request);
                const page = result.Items || [];
                if (page.length === 0) break;
                allItems.push(...page);
                total = result.TotalRecordCount ?? allItems.length;
                request.StartIndex = allItems.length;
            } while (allItems.length < total);
            state.items = allItems;
            state.totalCount = allItems.length;
            state.counts = await getCommunityCounts(allItems);
        })();
        return state.pending;
    }

    function setDescending(dialog) {
        const select = dialog?.querySelector('.selectSortOrder');
        if (select) select.value = 'Descending';
        dialog?.querySelectorAll('.menuSortOrder').forEach(input => { input.checked = input.value === 'Descending'; });
    }

    function installCommunitySortSupport() {
        // Install independently of LibraryBrowser: generic lists use a different menu
        // and recreate their query object for every page.
        if (ApiClient.getItems && !ApiClient.getItems.__communityRatingSortInstalled) {
            const getItems = ApiClient.getItems;
            const wrapped = function (userId, query) {
                if (!query) return getItems.apply(this, arguments);
                const mode = communitySortMode(query.SortBy);
                if (supportedItemTypes(query) || mode) lastSortContext = { route: location.hash, query };
                if (!mode) return getItems.apply(this, arguments);
                if (pendingSortSelection?.route === location.hash && pendingSortSelection.mode === mode) {
                    query.SortOrder = 'Descending';
                    pendingSortSelection = null;
                }
                const snapshot = { ...query };
                const cacheKey = JSON.stringify([ApiClient.getUrl('Items'), userId, mode, querySignature(snapshot), cacheRevision]);
                let state = customSortStates.get(cacheKey);
                if (!state) {
                    state = { mode, items: [], counts: new Map(), totalCount: 0, pending: null };
                    if (customSortStates.size >= 8) customSortStates.delete(customSortStates.keys().next().value);
                    customSortStates.set(cacheKey, state);
                }
                return prepareCommunitySort(snapshot, state, userId, this, getItems).then(() => {
                    const start = Math.max(0, Number(snapshot.StartIndex) || 0);
                    const limit = snapshot.Limit > 0 ? Number(snapshot.Limit) : state.totalCount;
                    return {
                        Items: orderCommunityItems(state, snapshot.SortOrder).slice(start, start + limit),
                        TotalRecordCount: state.totalCount,
                        StartIndex: start
                    };
                }).catch(error => {
                    customSortStates.delete(cacheKey);
                    throw error;
                });
            };
            wrapped.__communityRatingSortInstalled = true;
            ApiClient.getItems = wrapped;
        }

        const libraryBrowser = window.LibraryBrowser;
        if (!libraryBrowser || libraryBrowser.__communityRatingSortInstalled || typeof libraryBrowser.showSortMenu !== 'function') return;
        const showSortMenu = libraryBrowser.showSortMenu;
        libraryBrowser.showSortMenu = function (menuOptions) {
            if (!menuOptions?.query || !Array.isArray(menuOptions.items)
                || (menuOptions.query.IncludeItemTypes ? !supportedItemTypes(menuOptions.query) : !supportedSortPage())) {
                return showSortMenu.apply(this, arguments);
            }
            const query = menuOptions.query;
            lastSortContext = { route: location.hash, query };
            for (const [mode, key] of [['views', 'sortViews'], ['likes', 'sortLikes'], ['recommendations', 'sortRecommendations'], ['discouragements', 'sortDiscouragements']]) {
                const name = translate(key);
                const existing = menuOptions.items.find(item => item.id === sortModeIds[mode]);
                if (existing) existing.name = name;
                else {
                    menuOptions.items.push({ name, id: sortModeIds[mode] });
                }
            }
            let previousMode = communitySortMode(query.SortBy);
            const callback = menuOptions.callback;
            menuOptions.callback = function () {
                const mode = communitySortMode(query.SortBy);
                if (mode && mode !== previousMode) {
                    query.SortOrder = 'Descending';
                    setDescending(document.querySelector('.formDialog'));
                }
                previousMode = mode;
                return callback?.apply(this, arguments);
            };
            return showSortMenu.apply(this, arguments);
        };
        libraryBrowser.__communityRatingSortInstalled = true;
    }

    function extendSortMenus() {
        if (!supportedSortPage()) return;
        // The select menu persists its values and creates a fresh API query later.
        document.querySelectorAll('.formDialog .selectSortBy').forEach(select => {
            if (select.dataset.crSortExtended) {
                for (const [mode, key] of [['views', 'sortViews'], ['likes', 'sortLikes'], ['recommendations', 'sortRecommendations'], ['discouragements', 'sortDiscouragements']]) {
                    const option = select.querySelector('option[value="' + sortModeIds[mode] + '"]');
                    if (option && option.textContent !== translate(key)) option.textContent = translate(key);
                }
                return;
            }
            select.dataset.crSortExtended = 'true';
            const selected = select.value || (lastSortContext?.route === location.hash ? lastSortContext.query.SortBy : '');
            for (const [mode, key] of [['views', 'sortViews'], ['likes', 'sortLikes'], ['recommendations', 'sortRecommendations'], ['discouragements', 'sortDiscouragements']]) {
                if (select.querySelector('option[value="' + sortModeIds[mode] + '"]')) continue;
                const option = document.createElement('option');
                option.value = sortModeIds[mode];
                option.textContent = translate(key);
                select.appendChild(option);
            }
            if (communitySortMode(selected)) select.value = selected;
            let previousMode = communitySortMode(select.value);
            select.addEventListener('change', () => {
                const mode = communitySortMode(select.value);
                if (mode && mode !== previousMode) setDescending(select.closest('.formDialog'));
                previousMode = mode;
            });
        });

        // A DOM fallback also covers radio menus loaded before LibraryBrowser is
        // available globally. Native radio handlers keep saving and refreshing.
        document.querySelectorAll('.formDialog').forEach(dialog => {
            const native = dialog.querySelector('input.menuSortBy');
            if (!native) return;
            if (dialog.querySelector('input.menuSortBy[value="' + sortModeIds.views + '"]')) {
                for (const [mode, key] of [['views', 'sortViews'], ['likes', 'sortLikes'], ['recommendations', 'sortRecommendations'], ['discouragements', 'sortDiscouragements']]) {
                    const input = dialog.querySelector('input.menuSortBy[value="' + sortModeIds[mode] + '"]');
                    const label = input?.closest('label')?.lastElementChild;
                    if (label?.tagName === 'SPAN' && label.textContent !== translate(key)) label.textContent = translate(key);
                }
                return;
            }
            const parent = native.closest('label')?.parentElement;
            if (!parent) return;
            const selected = lastSortContext?.route === location.hash ? lastSortContext.query.SortBy : '';
            for (const [mode, key] of [['views', 'sortViews'], ['likes', 'sortLikes'], ['recommendations', 'sortRecommendations'], ['discouragements', 'sortDiscouragements']]) {
                const label = document.createElement('label');
                label.className = 'radio-label-block';
                const input = document.createElement('input', { is: 'emby-radio' });
                input.type = 'radio';
                input.name = native.name;
                input.className = 'menuSortBy';
                input.value = sortModeIds[mode];
                input.setAttribute('is', 'emby-radio');
                input.dataset.id = input.value;
                input.checked = communitySortMode(selected) === mode;
                input.addEventListener('change', () => {
                    if (!input.checked) return;
                    if (lastSortContext?.route === location.hash) lastSortContext.query.SortOrder = 'Descending';
                    pendingSortSelection = { route: location.hash, mode };
                    setDescending(dialog);
                    const originalValue = native.value;
                    // Reuse the existing native handler with the new sort key.
                    native.value = input.value;
                    native.checked = true;
                    try {
                        native.dispatchEvent(new Event('change', { bubbles: true }));
                    } finally {
                        native.value = originalValue;
                        native.checked = false;
                        input.checked = true;
                    }
                });
                const text = document.createElement('span');
                text.textContent = translate(key);
                label.appendChild(input);
                label.appendChild(text);
                parent.appendChild(label);
            }
        });
    }

    function currentUserIsAdmin() {
        if (isAdmin !== undefined) return Promise.resolve(isAdmin);
        if (!isAdminPromise) {
            isAdminPromise = ApiClient.getCurrentUser()
                .then(user => { isAdmin = user?.Policy?.IsAdministrator === true; return isAdmin; })
                .catch(() => { isAdmin = false; return false; });
        }
        return isAdminPromise;
    }

    function ensureStyle() {
        if (document.getElementById(styleId)) return;
        const node = document.createElement('style');
        node.id = styleId;
        node.textContent = styles;
        document.head.appendChild(node);
    }

    function itemIdFromDetails() {
        const hashQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
        const hashId = new URLSearchParams(hashQuery).get('id');
        return hashId || new URLSearchParams(location.search).get('id');
    }

    function getDetailsPage() {
        return document.querySelector('.itemDetailPage');
    }

    function collectCards() {
        return Array.from(document.querySelectorAll('.card[data-id]'))
            .map(card => ({ id: card.getAttribute('data-id'), element: card }))
            .filter(entry => {
                if (!entry.id) return false;
                const rect = entry.element.getBoundingClientRect();
                return rect.bottom >= -200 && rect.top <= window.innerHeight + 200;
            });
    }

    function collectTargets() {
        const entries = collectCards();
        const detailPage = getDetailsPage();
        const detailId = detailPage && itemIdFromDetails();
        if (detailId) entries.push({ id: detailId, element: detailPage, detail: true });
        return entries;
    }

    function queueScan() {
        if (refreshQueued) return;
        refreshQueued = true;
        window.setTimeout(() => {
            refreshQueued = false;
            scan();
        }, 120);
    }

    async function scan() {
        installCommunitySortSupport();
        installKefinCollectionAdapter();
        extendSortMenus();
        if (scanning) return;
        ensureStyle();
        const targets = collectTargets();
        if (!targets.length) return;
        scanning = true;
        try {
            const ids = [...new Set(targets.map(entry => entry.id))]
                .filter(id => !cache.has(id.toLowerCase()));
            for (let index = 0; index < ids.length; index += 100) {
                const response = await ApiClient.getJSON(apiUrl('Items', ids.slice(index, index + 100)));
                options = response.Options;
                applyOptions();
                if (!options || !options.Enabled) {
                    document.querySelectorAll('.cr-badge-stack,.cr-details-stack').forEach(element => element.remove());
                    document.querySelectorAll('.cr-details-top-host').forEach(element => element.classList.remove('cr-details-top-host'));
                    return;
                }
                response.Items.forEach(item => cache.set(item.ItemId.toLowerCase(), item));
                ids.slice(index, index + 100).forEach(id => {
                    if (!cache.has(id.toLowerCase())) cache.set(id.toLowerCase(), null);
                });
            }
            if (!options || !options.Enabled) return;
            const voteIds = [...new Set(targets.map(entry => entry.id))].filter(id => !personalVotes.has(id.toLowerCase()));
            if (voteIds.length) await fetchUserVotes(voteIds);
            if (options.AdminTooltipsEnabled) await currentUserIsAdmin();
            for (const target of targets) {
                const item = cache.get(target.id.toLowerCase());
                if (item) render(target, item);
            }
        } catch (error) {
            console.debug('Community Rating counters are temporarily unavailable.', error);
        } finally {
            scanning = false;
        }
    }

    function applyOptions() {
        if (!options) return;
        const size = Number.isFinite(options.BadgeScale) ? options.BadgeScale : 16;
        const factor = Number.isFinite(options.DetailScaleFactor) ? Math.min(3, Math.max(1, options.DetailScaleFactor)) : 1;
        document.documentElement.style.setProperty('--cr-size', `${size}px`);
        document.documentElement.style.setProperty('--cr-detail-size', `${Math.round(size * factor * 100) / 100}px`);
        document.documentElement.style.setProperty('--cr-inset-x', `${Number.isFinite(options.BadgeInsetX) ? options.BadgeInsetX : 3}px`);
        document.documentElement.style.setProperty('--cr-inset-y', `${Number.isFinite(options.BadgeInsetY) ? options.BadgeInsetY : 8}px`);
        document.documentElement.style.setProperty('--cr-bg-opacity', String(options.BackgroundOpacity / 100));
        const layout = options.CardLayout || (options.StackCardBadges === true ? 'column' : 'row');
        document.documentElement.style.setProperty('--cr-card-layout', layout);
    }

    const thumbUpIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 21h4V9H1v12zM23 10c0-1.1-.9-2-2-2h-6.3l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.48.14-.73v-2z"/></svg>';
    const thumbDownIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22L1.14 11.27c-.09.23-.14.48-.14.73v2c0 1.1.9 2 2 2h6.3l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.58-6.59c.37-.36.59-.86.59-1.41V5c0-1.1-.9-2-2-2zM19 3v12h4V3h-4z"/></svg>';

    const badgeMeta = {
        view: ['ViewedBy', 'viewLabel', 'ViewCount', eyeIcon],
        like: ['LikedBy', 'likeLabel', 'LikeCount', heartIcon],
        recommend: ['RecommendedBy', 'recommendLabel', 'RecommendationCount', thumbUpIcon],
        discourage: ['DiscouragedBy', 'discourageLabel', 'DiscouragementCount', thumbDownIcon]
    };

    function makeBadge(kind, count, itemId) {
        const [namesKey, labelKey, , icon] = badgeMeta[kind];
        const isVote = kind === 'recommend' || kind === 'discourage';
        const row = document.createElement(isVote ? 'button' : 'span');
        row.className = 'cr-badge' + (isVote ? ' cr-vote' : '');
        if (!isVote) row.tabIndex = 0;
        row.dataset.crItemId = itemId;
        row.dataset.crKind = kind;
        row.dataset.count = String(count);
        row.dataset.crLabelKey = labelKey;
        row.dataset.crNamesKey = namesKey;
        const label = translate(labelKey, count);
        row.dataset.crLabel = label;
        row.setAttribute('aria-label', label);
        row.innerHTML = `${icon}${count > 0 || !isVote ? `<span class="cr-count">${count}</span>` : ''}`;
        if (isVote) {
            row.type = 'button';
            row.dataset.kind = kind;
            const current = personalVotes.get(itemId.toLowerCase()) || 0;
            row.setAttribute('aria-pressed', String(current === (kind === 'recommend' ? 1 : -1)));
            row.title = label;
            row.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                submitVote(itemId, kind === 'recommend' ? 1 : -1, row);
            });
            row.addEventListener('keydown', event => event.stopPropagation());
        }
        row.addEventListener('mouseenter', showTooltip);
        row.addEventListener('focus', showTooltip);
        row.addEventListener('mouseleave', hideTooltip);
        row.addEventListener('blur', hideTooltip);
        return row;
    }

    async function fetchUserVotes(ids) {
        for (let start = 0; start < ids.length; start += 100) {
            const response = await ApiClient.getJSON(apiUrl('Me/Votes', ids.slice(start, start + 100)));
            for (const entry of response || []) personalVotes.set(entry.ItemId.toLowerCase(), entry.Vote || 0);
        }
    }

    async function submitVote(itemId, vote, button) {
        if (button.dataset.pending === 'true') return;
        const key = itemId.toLowerCase();
        const previous = personalVotes.get(key) || 0;
        const remove = previous === vote;
        const url = ApiClient.getUrl('CommunityRating/Me/Votes/' + encodeURIComponent(itemId));
        button.dataset.pending = 'true';
        button.disabled = true;
        try {
            const response = await ApiClient.ajax({
                url,
                type: remove ? 'DELETE' : 'PUT',
                data: remove ? undefined : JSON.stringify({ Vote: vote }),
                contentType: 'application/json'
            });
            personalVotes.set(key, response.Vote || 0);
            invalidateCounts();
            const changed = [response.Item, response.ParentSeries].filter(Boolean);
            for (const item of changed) cache.set(item.ItemId.toLowerCase(), item);
            queueScan();
        } catch (error) {
            console.warn('Community Rating vote could not be saved.', error);
            if (window.Dashboard?.alert) window.Dashboard.alert(translate('voteError'));
        } finally {
            button.dataset.pending = 'false';
            button.disabled = false;
        }
    }

    function observeCardLayout(stack, host) {
        if (!window.ResizeObserver || stack._crResizeObserver) return;
        const update = () => {
            const configured = options?.CardLayout || (options?.StackCardBadges ? 'column' : 'row');
            stack.classList.remove('cr-layout-grid', 'cr-layout-column');
            if (configured === 'column') { stack.classList.add('cr-layout-column'); return; }
            if (configured === 'row') return;
            const badges = [...stack.querySelectorAll('.cr-badge')];
            const available = Math.max(0, host.clientWidth - (options?.BadgeInsetX || 3) - 32);
            const rowWidth = badges.reduce((sum, badge) => sum + badge.getBoundingClientRect().width, 0) + Math.max(0, badges.length - 1) * 4;
            if (rowWidth <= available) return;
            const columnWidth = Math.max(...badges.map(badge => badge.getBoundingClientRect().width));
            if (columnWidth * 2 + 4 <= available) stack.classList.add('cr-layout-grid');
            else stack.classList.add('cr-layout-column');
        };
        stack._crUpdateLayout = update;
        stack._crResizeObserver = new ResizeObserver(update);
        stack._crResizeObserver.observe(host);
        stack._crResizeObserver.observe(stack);
        update();
    }

    function render(target, item) {
        const primaryContent = target.detail && target.element.querySelector('.detailPagePrimaryContent');
        const ratingBlock = target.detail && (target.element.querySelector('.itemMiscInfo-secondary') || target.element.querySelector('.itemMiscInfo'));
        const host = target.detail
            ? (primaryContent || target.element.querySelector('.infoWrapper') || ratingBlock?.parentElement)
            : (target.element.querySelector('.cardScalable') || target.element.querySelector('.cardImageContainer') || target.element);
        if (!host) return;
        const existing = target.element.querySelector(target.detail ? '.cr-details-stack' : '.cr-badge-stack');
        const signature = JSON.stringify([item.ItemId, item.ViewCount, item.LikeCount, item.RecommendationCount, item.DiscouragementCount, personalVotes.get(item.ItemId.toLowerCase()), options.AdminTooltipsEnabled, isAdmin, uiLanguage()]);
        if (existing?.dataset.crSignature === signature) {
            if (!target.detail) existing._crUpdateLayout?.();
            if (primaryContent) {
                host.classList.add('cr-details-top-host');
                if (host.firstElementChild !== existing) host.prepend(existing);
            }
            return;
        }
        if (existing) {
            if (tooltipBadge?.dataset.crItemId === item.ItemId) hideTooltip();
            existing.remove();
        }

        const stack = document.createElement('div');
        stack.className = target.detail ? 'cr-details-stack' : 'cr-badge-stack';
        stack.dataset.crSignature = signature;
        if (!target.detail) {
            if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        }
        stack.appendChild(makeBadge('view', item.ViewCount, item.ItemId));
        if (target.detail || item.LikeCount > 0) stack.appendChild(makeBadge('like', item.LikeCount, item.ItemId));
        stack.appendChild(makeBadge('recommend', item.RecommendationCount || 0, item.ItemId));
        stack.appendChild(makeBadge('discourage', item.DiscouragementCount || 0, item.ItemId));

        if (target.detail) {
            // Sit directly below the header, before the content sections, while
            // retaining Jellyfin's horizontal content padding and poster offset.
            if (primaryContent) {
                host.classList.add('cr-details-top-host');
                host.prepend(stack);
            }
            else if (ratingBlock?.parentElement === host) ratingBlock.insertAdjacentElement('afterend', stack);
            else host.appendChild(stack);
        } else {
            host.appendChild(stack);
            observeCardLayout(stack, host);
        }
    }

    let tooltipElement;
    let tooltipRequest = 0;
    let tooltipBadge;
    function getTooltip() {
        if (tooltipElement) return tooltipElement;
        tooltipElement = document.createElement('div');
        tooltipElement.id = 'communityRatingTooltip';
        tooltipElement.className = 'cr-tooltip';
        tooltipElement.hidden = true;
        tooltipElement.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltipElement);
        return tooltipElement;
    }

    function displayTooltip(badge, text) {
        const tip = getTooltip();
        if (tooltipBadge && tooltipBadge !== badge) tooltipBadge.removeAttribute('aria-describedby');
        tooltipBadge = badge;
        tip.textContent = text;
        tip.hidden = false;
        badge.setAttribute('aria-describedby', tip.id);
        const rect = badge.getBoundingClientRect();
        const width = tip.offsetWidth || 0;
        const height = tip.offsetHeight || 0;
        const badgeWidth = rect.width ?? Math.max(0, (rect.right ?? rect.left) - rect.left);
        const left = rect.left + badgeWidth / 2 - width / 2;
        const above = rect.top - height - 8;
        const top = above >= 8 ? above : rect.bottom + 8;
        tip.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
        tip.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
    }

    async function showTooltip(event) {
        const badge = event.currentTarget;
        const request = ++tooltipRequest;
        if (!badge.isConnected) return;
        const label = badge.dataset.crLabel;
        displayTooltip(badge, label);
        if (!options?.AdminTooltipsEnabled || !await currentUserIsAdmin()) return;
        if (request !== tooltipRequest || !badge.isConnected || !options.AdminTooltipsEnabled) return;
        const itemId = badge.dataset.crItemId;
        const key = badge.dataset.crNamesKey;
        const cacheKey = itemId.toLowerCase();
        let names = tooltipCache.get(cacheKey);
        if (!names) {
            try {
                const result = await ApiClient.getJSON(apiUrl('Admin/Items', [itemId]));
                if (request !== tooltipRequest || !badge.isConnected || !options.AdminTooltipsEnabled) return;
                const entry = result.find(item => item.ItemId.toLowerCase() === cacheKey);
                names = entry ? {
                    ViewedBy: entry.ViewedBy || [], LikedBy: entry.LikedBy || [],
                    RecommendedBy: entry.RecommendedBy || [], DiscouragedBy: entry.DiscouragedBy || []
                } : { ViewedBy: [], LikedBy: [], RecommendedBy: [], DiscouragedBy: [] };
                tooltipCache.set(cacheKey, names);
            } catch (_) {
                return;
            }
        }
        if (request !== tooltipRequest || !badge.isConnected || !options.AdminTooltipsEnabled) return;
        const people = names[key] || [];
        displayTooltip(badge, label + '\n' + (people.length ? people.join('\n') : translate('noMembers')));
    }

    function hideTooltip() {
        tooltipRequest++;
        if (tooltipElement) tooltipElement.hidden = true;
        if (tooltipBadge) tooltipBadge.removeAttribute('aria-describedby');
        tooltipBadge = null;
    }

    function invalidateCounts() {
        cacheRevision++;
        customSortStates.clear();
        cache.clear();
        tooltipCache.clear();
        hideTooltip();
    }

    ensureStyle();
    const observer = new MutationObserver(queueScan);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['lang'] });
    window.addEventListener('hashchange', queueScan);
    window.addEventListener('popstate', queueScan);
    window.addEventListener('scroll', queueScan, { passive: true });
    window.addEventListener('scroll', hideTooltip, { passive: true, capture: true });
    window.addEventListener('hashchange', hideTooltip);
    window.addEventListener('popstate', hideTooltip);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
    document.addEventListener('click', event => {
        if (event.target.closest('.btnSort')) installCommunitySortSupport();
        if (event.target.closest('.buttonUserData,.btnUserData,.itemAction,.cardOverlayButton')) {
            window.setTimeout(() => {
                invalidateCounts();
                queueScan();
            }, 700);
        }
    }, true);
    scan();
    window.setInterval(() => {
        installCommunitySortSupport();
        invalidateCounts();
        scan();
    }, 30000);
})();
