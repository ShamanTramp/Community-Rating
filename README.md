# Community Rating

![Community Rating illustration](assets/community-rating-cover.png)

**Community Rating** is a Jellyfin plugin that shows how many members have watched or favorited each movie, series, or episode. It adds view and favorite counters to media cards and detail pages in Jellyfin Web.

## Features

- Counts each active, included account once, using Jellyfin's **played** and **favorite** markers. Repeated playback does not increase the count.
- Counts a series as viewed by a member when that member has watched at least one episode. Watching more episodes does not add more series views.
- Counts favorites on the movie, episode, or series itself.
- Ignores disabled accounts and user names listed in the exclusions.
- Shows white view and favorite icons in the upper-left corner of media cards, either on one line or stacked vertically. Views always appear first, including zero; favorites are hidden when their count is zero.
- Adds both counters after the existing rating information on detail pages, including zero favorites.
- Adds **Vus par les membres** (member views) and **Aimés par les membres** (member favorites) to supported library sort menus. Both default to descending order.
- Offers optional administrator-only tooltips listing the member names behind each counter, with one name per line. Tooltips are disabled by default; the names endpoint requires administrator access.
- Recalculates affected aggregates after played or favorite markers change, with a full reconciliation available as a scheduled task.

The server updates its cache when markers change. Open web pages refresh counters every 30 seconds and shortly after local marker actions. Community sorting fetches the full filtered list before applying pagination, so the first sort can take longer on large libraries.

## Installation

Install [JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector) first. Community Rating registers its bundled script with JavaScript Injector automatically when Jellyfin starts.

In Jellyfin, open **Dashboard → Plugins → Repositories**, then add the repository manifest:

```text
https://raw.githubusercontent.com/ShamanTramp/Community-Rating/main/manifest.json
```

Save the repository, open the plugin catalog, select **Available** if needed, then install **Community Rating**. Restart Jellyfin and reload the web client when installation is complete. The [0.1.0.0 plugin package](https://raw.githubusercontent.com/ShamanTramp/Community-Rating/main/packages/community-rating-0.1.0.0.zip) is also available directly.

Jellyfin must be able to access the manifest and package files on GitHub to install and update the plugin.

## Configuration and usage

Open **Dashboard → Plugins → Community Rating**:

| Option | Default | Description |
| --- | --- | --- |
| Show counters | Enabled | Displays member view and favorite counters. |
| Excluded accounts | Empty | Jellyfin user names separated by commas. Spaces around names and letter case are ignored. Disabled accounts are always excluded. |
| Administrator tooltips | Disabled | Lets administrators hover over or focus a counter to see the included member names. Names are never included in the public counter response. |
| Card counter layout | One line | Choose one line or vertically stacked counters. Views come first, favorites second. |
| Icon and counter size | 16 px | Adjusts the size from 12 to 28 px. |
| Horizontal inset | 8 px | Sets the distance from the left edge of a card, from 0 to 32 px. |
| Vertical inset | 8 px | Sets the distance from the top edge of a card, from 0 to 32 px. |
| Background opacity | 45% | Adjusts the counter background from 0% to 90%. |
| Full reconciliation | Every 6 hours | Choose hourly if a complete rebuild takes less than five minutes; otherwise use six hours. Changing this setting updates the task's interval trigger. |

To rebuild the statistics manually, run **Rebuild Community Rating statistics** from **Dashboard → Scheduled Tasks**. The task supports progress reporting and cancellation. The cache is also initialized at startup; uncached media are calculated when requested.

The web client picks up display changes on its next refresh. Exclusion changes rebuild the server cache.

## Compatibility

Targets Jellyfin **10.11.11** and **.NET 9**. The web interface requires JavaScript Injector; the integration was tested with JavaScript Injector **3.1.0.0**. Card overlays and custom sort menus apply to Jellyfin Web. Native clients do not load the injected script.

## Development

```sh
dotnet restore Jellyfin.Plugin.CommunityRating.sln
dotnet build Jellyfin.Plugin.CommunityRating.sln -c Release --no-restore -m:1
dotnet test Jellyfin.Plugin.CommunityRating.sln -c Release --no-build --no-restore -m:1
node tests/web/community-rating.test.cjs
```

The web tests use Node.js 22 and a local DOM fixture; they do not require a running Jellyfin server. CI builds and runs both test suites on pushes to `main` and pull requests. Publishing a GitHub release verifies the version tag, produces the installable ZIP, computes its checksum, and updates `manifest.json`.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
