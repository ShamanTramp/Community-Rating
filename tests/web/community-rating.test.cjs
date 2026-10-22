const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../src/Jellyfin.Plugin.CommunityRating/Web/community-rating.js'), 'utf8');

function fixture({ admin = false, cards = ['movie-a'], counts = { 'movie-a': [3, 1] }, library = [], detail = false } = {}) {
    let writes = 0;
    const options = { Enabled: true, BadgeScale: 16, BadgeInsetX: 3, BadgeInsetY: 8, BackgroundOpacity: 45, StackCardBadges: false, AdminTooltipsEnabled: true };
    class Element {
        constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {}; this.isConnected = true; }
        appendChild(node) { writes++; this.children.push(node); node.parentElement = this; return node; }
        insertAdjacentElement(position, node) { this.parentElement.appendChild(node); }
        remove() { writes++; this.isConnected = false; this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
        setAttribute(name, value) { this[name] = value; }
        getAttribute(name) { return this[name]; }
        removeAttribute(name) { delete this[name]; }
        addEventListener(name, handler) { this.listeners[name] = handler; }
        querySelector(selector) {
            if (selector === '.cardScalable') return this;
            return this.children.find(node => selector === '.' + node.className) || null;
        }
        getBoundingClientRect() { return { top: 100, bottom: 200, left: 10 }; }
    }
    const head = new Element('head');
    const body = new Element('body');
    const cardNodes = cards.map(id => { const node = new Element(); node['data-id'] = id; return node; });
    const detailPage = new Element();
    const ratings = new Element();
    ratings.className = 'itemMiscInfo';
    detailPage.appendChild(ratings);
    const properties = {};
    const timers = [];
    const intervals = [];
    const observers = [];
    const calls = [];
    const events = {};
    const document = {
        head, body,
        documentElement: { lang: 'fr', style: { setProperty: (key, value) => { properties[key] = value; } } },
        createElement: tag => new Element(tag),
        getElementById: id => head.children.find(node => node.id === id),
        querySelector: selector => detail && selector === '.itemDetailPage' ? detailPage : null,
        querySelectorAll: selector => selector === '.card[data-id]' ? cardNodes
            : selector === '.cr-badge-stack,.cr-details-stack'
                ? cardNodes.flatMap(card => card.children.filter(child => ['cr-badge-stack', 'cr-details-stack'].includes(child.className))) : [],
        addEventListener: (name, callback) => { events[name] = callback; }
    };
    let menu;
    const sandbox = {
        document, console, URLSearchParams, Map, WeakMap, Set,
        location: { hash: detail ? '#/details?id=movie-a' : '#/movies', search: '' },
        getComputedStyle: () => ({ position: 'static' }),
        MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} disconnect() {} },
        ApiClient: {
            getUrl: route => 'https://example.invalid/' + route,
            getCurrentUserId: () => 'user',
            getCurrentUser: async () => ({ Policy: { IsAdministrator: admin } }),
            getJSON: async url => {
                calls.push(url);
                const ids = new URL(url).searchParams.getAll('ids');
                if (url.includes('/Admin/')) return ids.map(ItemId => ({ ItemId, ViewedBy: ['Alpha', 'Beta'], LikedBy: ['Alpha'] }));
                return { Options: { ...options }, Items: ids.filter(id => counts[id]).map(ItemId => ({ ItemId, ViewCount: counts[ItemId][0], LikeCount: counts[ItemId][1] })) };
            },
            getItems: async (user, query) => ({ Items: library.slice(query.StartIndex, query.StartIndex + query.Limit), TotalRecordCount: library.length })
        },
        LibraryBrowser: { showSortMenu: value => { menu = value; } },
        innerWidth: 1000, innerHeight: 800,
        setTimeout: callback => { timers.push(callback); },
        setInterval: callback => { intervals.push(callback); },
        addEventListener() {}
    };
    sandbox.window = sandbox;
    vm.runInNewContext(source, sandbox, { filename: 'community-rating.js' });
    async function settle() { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); }
    return { sandbox, options, counts, cardNodes, properties, calls, body, observers, events, intervals, detailPage, ratings,
        get writes() { return writes; }, get menu() { return menu; },
        settle, async flush() { const batch = timers.splice(0); batch.forEach(callback => callback()); await settle(); } };
}

test('cards retain their DOM and focus when counts have not changed', async () => {
    const f = fixture({ admin: true });
    await f.settle();
    const stack = f.cardNodes[0].children[0];
    assert.equal(stack.children.length, 2);
    assert.match(stack.children[0].innerHTML, /<span>3<\/span>/);
    assert.match(stack.children[1].innerHTML, /<span>1<\/span>/);
    assert.equal(stack.children[0].tabIndex, 0);
    const writes = f.writes;
    f.observers[0]();
    await f.flush();
    f.observers[0]();
    await f.flush();
    assert.equal(f.writes, writes);
    assert.equal(f.cardNodes[0].children[0], stack);
});

test('zero views remain visible, zero favorites are hidden, and layout updates existing cards', async () => {
    const f = fixture({ counts: { 'movie-a': [0, 0] } });
    await f.settle();
    const stack = f.cardNodes[0].children[0];
    assert.equal(stack.children.length, 1);
    assert.match(stack.children[0].innerHTML, /<span>0<\/span>/);
    assert.equal(f.properties['--cr-card-direction'], 'row');
    f.options.StackCardBadges = true;
    f.intervals[0]();
    await f.settle();
    assert.equal(f.properties['--cr-card-direction'], 'column');
    assert.equal(f.cardNodes[0].children[0], stack);
});

test('ordinary accounts receive label tooltips without requesting member names', async () => {
    const f = fixture();
    await f.settle();
    const badge = f.cardNodes[0].children[0].children[0];
    assert.equal(badge.tabIndex, 0);
    await badge.listeners.focus({ currentTarget: badge });
    assert.equal(f.body.children[0].textContent, 'Vu par les membres');
    assert.ok(Number.parseFloat(f.body.children[0].style.top) < badge.getBoundingClientRect().top);
    assert.equal(f.calls.some(url => url.includes('/Admin/')), false);
});

test('detail pages retain ratings and show both zero counters regardless of card layout', async () => {
    const f = fixture({ cards: [], detail: true, counts: { 'movie-a': [0, 0] } });
    await f.settle();
    const stack = f.detailPage.querySelector('.cr-details-stack');
    assert.equal(f.detailPage.children[0], f.ratings);
    assert.equal(stack.children.length, 2);
    assert.match(stack.children[1].innerHTML, /<span>0<\/span>/);
    f.options.StackCardBadges = true;
    f.intervals[0]();
    await f.settle();
    assert.equal(f.detailPage.querySelector('.cr-details-stack'), stack);
    assert.equal(stack.className, 'cr-details-stack');
});

test('administrator tooltips show names and do not reopen after the pointer leaves', async () => {
    const f = fixture({ admin: true });
    await f.settle();
    const badge = f.cardNodes[0].children[0].children[0];
    const event = { currentTarget: badge };
    const pending = badge.listeners.mouseenter(event);
    event.currentTarget = null;
    badge.listeners.mouseleave();
    await pending;
    assert.equal(f.body.children[0].hidden, true);
    await badge.listeners.focus({ currentTarget: badge });
    assert.equal(f.body.children[0].textContent, 'Vu par les membres\nAlpha\nBeta');
    assert.equal(f.body.children[0].hidden, false);
});

test('community sorting ranks the entire filtered list before pagination and refreshes changed counts', async () => {
    const library = Array.from({ length: 501 }, (_, index) => ({ Id: `movie-${index}`, Name: `Movie ${index}` }));
    const counts = Object.fromEntries(library.map(item => [item.Id, [0, 0]]));
    counts['movie-500'] = [9, 1];
    counts['movie-1'] = [2, 5];
    const f = fixture({ cards: [], library, counts });
    const query = { IncludeItemTypes: 'Movie', SortBy: 'SortName', SortOrder: 'Ascending', StartIndex: 0, Limit: 1 };
    f.sandbox.LibraryBrowser.showSortMenu({ query, items: [], callback() {} });
    assert.deepEqual(Array.from(f.menu.items, item => item.name), ['Vus par les membres', 'Aimés par les membres']);
    query.SortBy = 'CommunityRatingViews';
    f.menu.callback();
    await f.settle();
    let result = await f.sandbox.ApiClient.getItems('user', query);
    assert.equal(result.TotalRecordCount, 501);
    assert.equal(result.Items[0].Id, 'movie-500');
    query.StartIndex = 1;
    result = await f.sandbox.ApiClient.getItems('user', query);
    assert.equal(result.Items[0].Id, 'movie-1');
    counts['movie-0'] = [20, 0];
    f.intervals[0]();
    query.StartIndex = 0;
    result = await f.sandbox.ApiClient.getItems('user', query);
    assert.equal(result.Items[0].Id, 'movie-0');
    f.sandbox.LibraryBrowser.showSortMenu({ query, items: [], callback() {} });
    query.SortBy = 'CommunityRatingLikes';
    f.menu.callback();
    await f.settle();
    result = await f.sandbox.ApiClient.getItems('user', query);
    assert.equal(result.Items[0].Id, 'movie-1');
});
