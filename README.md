# Community Rating

![Community Rating illustration](assets/community-rating-cover.png)

**Community Rating** aggregates member views, favorites, recommendations, and negative recommendations for Jellyfin movies, series, and episodes. The server stores the data and provides native ranking collections; JavaScript Injector adds interactive counters and voting to Jellyfin Web.

## Features

- Counts each active, included account once for played and favorite markers. Repeated playback does not increase the count.
- Counts a series as viewed when a member has played at least one episode; counts a favorite only when the series itself is a favorite.
- Lets each account recommend or discourage a movie, series, or episode. Clicking the active vote again removes it; clicking the other thumb switches direction.
- Stores votes separately from Jellyfin's native `Likes` marker, so Kefin Tweaks' **Watchlist** does not add or remove recommendations.
- Aggregates episode votes into their series. Each member contributes at most once to each of the positive and negative series scores, even when voting on multiple episodes and the series itself.
- Excludes disabled, deleted, and configured accounts. Administrator tooltips can show included member names when enabled.
- Shows views, favorites, recommendations, and negative recommendations on cards and details. Views stay visible at zero; card favorites hide at zero; zero-count thumbs are white and show no number.
- Colors thumbs green and red on hover, keyboard focus, and after a vote. The member's own vote is exposed accessibly.
- Provides automatic, one-line, and one-column card layouts. Automatic mode reserves space for Jellyfin's watched marker in the upper-right corner and stacks the counters vertically whenever they do not fit on one line.
- Shows count-aware French and English tooltips, with English fallback, and adds four community sorts to supported library lists.
- Creates eight visible native Jellyfin collections: views, favorites, recommendations, and negative recommendations, each for movies and series. Episode votes contribute to series collections; episodes are not added directly.
- Adapts Kefin Tweaks collection sections to preserve Community Rating ranking. Other compatible clients, including Wholfin, can use the native collections without JavaScript injection.

Community sorts rank the complete filtered result before pagination. The first sort can take longer on large libraries. Vote, played, and favorite changes refresh affected totals; collection membership and order are reconciled in the background and by the scheduled task.

## Installation

Install [JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector) for the Jellyfin Web interface. Community Rating registers its bundled script automatically when Jellyfin starts. Kefin Tweaks is optional.

In Jellyfin, open **Dashboard → Plugins → Repositories**, then add this manifest:

```text
https://raw.githubusercontent.com/ShamanTramp/Community-Rating/main/manifest.json
```

Save the repository, open the plugin catalog, select **Available** if needed, and install **Community Rating**. Restart Jellyfin and reload the Web client. The [latest plugin package](https://github.com/ShamanTramp/Community-Rating/releases/latest) is also available directly. After upgrading, fully reload the page to replace any script left running by the previous version.

## Configuration

Open **Dashboard → Plugins → Community Rating**:

| Option | Default | Description |
| --- | --- | --- |
| Show counters | Enabled | Shows aggregate views, favorites, recommendations, and negative recommendations. |
| Excluded accounts | Empty | Comma-separated Jellyfin user names. Disabled accounts are always excluded. |
| Administrator tooltips | Disabled | Lets administrators see included member names in tooltips. The server protects the names endpoint. |
| Card layout | Automatic | Uses one line when the counters fit; otherwise stacks them in one column. Manual one-line and one-column modes are also available. |
| Ranking collections | Enabled | Creates and synchronizes eight visible movie and series collections. Use **Synchronize collections now** for a manual refresh. |
| Icon and counter size | 16 px | Base size from 12 to 28 px. |
| Detail enlargement factor | 1 | Multiplies the base size on detail pages, from 1 to 3. |
| Horizontal and vertical inset | 3 px / 8 px | Positions the card indicators from the upper-left corner. |
| Background opacity | 45% | Sets badge background opacity from 0% to 90%. |
| Full reconciliation | Every 6 hours | Use hourly if a full rebuild takes less than five minutes; otherwise use six hours. |

Run **Rebuild Community Rating statistics** from **Dashboard → Scheduled Tasks** to rebuild aggregates and reconcile native collections. The task supports progress reporting and cancellation.

### Ranking collections and Kefin Tweaks

The four recommendation collections use these exact names:

- Films recommandés par les membres
- Films déconseillés par les membres
- Séries recommandées par les membres
- Séries déconseillées par les membres

The other four collections cover views and favorites for films and series. They are ordinary, visible Jellyfin collections, so clients such as Wholfin can add them to home pages. Items with zero matching markers stay at the bottom: Jellyfin removes empty collections during library cleanup, so retaining titles keeps all eight collections available. In Kefin Tweaks, add each collection as a collection-based custom home section. Community Rating keeps these sections ordered by the corresponding member total. The Web script is needed only for Kefin's ranking integration; collection membership is stored by Jellyfin.

### Vote storage

Community votes are stored separately at `CommunityRating/votes.json` under Jellyfin's data directory. Back up Jellyfin's data directory to preserve votes during server migrations. The file stores Jellyfin user and media IDs with vote direction, not authentication tokens.

## Compatibility

Targets Jellyfin **10.11.11** and **.NET 9**. JavaScript Injector is required for Web badges, vote buttons, tooltips, custom sorts, and Kefin Tweaks ranking integration. Vote storage, aggregates, and native collections are maintained by the server and available to other compatible clients.

## Development

```sh
dotnet restore Jellyfin.Plugin.CommunityRating.sln
dotnet build Jellyfin.Plugin.CommunityRating.sln -c Release --no-restore -m:1
dotnet test Jellyfin.Plugin.CommunityRating.sln -c Release --no-build --no-restore -m:1
npm ci --ignore-scripts
npm test
```

The web tests use Node.js 22 and jsdom fixtures for voting, rendering, and Jellyfin and Kefin Tweaks sorts. CI builds and runs both test suites on pushes to `main` and pull requests. Publishing a GitHub release verifies the tag version, produces the installable ZIP, calculates its checksum, and updates `manifest.json`.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
