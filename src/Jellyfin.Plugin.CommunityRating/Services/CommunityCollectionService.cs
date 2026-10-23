using System.Threading.Channels;
using Jellyfin.Data.Enums;
using Jellyfin.Data.Events;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.CommunityRating.Core;
using MediaBrowser.Controller.Collections;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CommunityRating.Services;

/// <summary>Maintains eight native Jellyfin collections from Community Rating aggregates.</summary>
public sealed class CommunityCollectionService : BackgroundService
{
    private const string ProviderKey = "CommunityRatingCollection";
    private readonly ICollectionManager _collectionManager;
    private readonly ILibraryManager _libraryManager;
    private readonly IUserDataManager _userDataManager;
    private readonly CommunityStatsService _statsService;
    private readonly ILogger<CommunityCollectionService> _logger;
    private readonly Channel<bool> _requests = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
    {
        FullMode = BoundedChannelFullMode.DropWrite,
        SingleReader = true,
        SingleWriter = false
    });
    private readonly SemaphoreSlim _syncLock = new(1, 1);

    /// <summary>Initializes native collection management and subscribes to marker changes.</summary>
    public CommunityCollectionService(
        ICollectionManager collectionManager,
        ILibraryManager libraryManager,
        IUserDataManager userDataManager,
        CommunityStatsService statsService,
        ILogger<CommunityCollectionService> logger)
    {
        _collectionManager = collectionManager;
        _libraryManager = libraryManager;
        _userDataManager = userDataManager;
        _statsService = statsService;
        _logger = logger;
        userDataManager.UserDataSaved += OnUserDataSaved;
        if (Plugin.Instance is not null) Plugin.Instance.ConfigurationChanged += OnConfigurationChanged;
    }

    /// <summary>Queues a coalesced reconciliation after a vote or configuration update.</summary>
    public void RequestSync() => _requests.Writer.TryWrite(true);

    /// <summary>Returns the identifiers and labels for plugin-managed native collections.</summary>
    public IReadOnlyList<ManagedCommunityCollection> GetManagedCollections()
    {
        return _libraryManager.GetItemList(new InternalItemsQuery { IncludeItemTypes = [BaseItemKind.BoxSet], EnableTotalRecordCount = false })
            .OfType<BoxSet>()
            .Where(box => box.ProviderIds.ContainsKey(ProviderKey))
            .Select(box => new ManagedCommunityCollection(box.ProviderIds[ProviderKey], box.Id, box.Name))
            .OrderBy(collection => collection.Key, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    /// <summary>Rebuilds the eight collections immediately.</summary>
    public async Task SyncNowAsync(CancellationToken cancellationToken) =>
        await SyncAllAsync(cancellationToken).ConfigureAwait(false);

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Jellyfin's startup task removes empty BoxSets; run after its initial cleanup.
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken).ConfigureAwait(false);
        if (Plugin.Instance?.Configuration.RankingCollectionsEnabled == true) RequestSync();
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _requests.Reader.ReadAsync(stoppingToken).ConfigureAwait(false);
                await Task.Delay(TimeSpan.FromMilliseconds(750), stoppingToken).ConfigureAwait(false);
                while (_requests.Reader.TryRead(out _)) { }
                if (Plugin.Instance?.Configuration.RankingCollectionsEnabled == true)
                    await SyncAllAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception) { _logger.LogError(exception, "Community Rating native collection sync failed."); }
        }
    }

    /// <inheritdoc />
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _userDataManager.UserDataSaved -= OnUserDataSaved;
        if (Plugin.Instance is not null) Plugin.Instance.ConfigurationChanged -= OnConfigurationChanged;
        await base.StopAsync(cancellationToken).ConfigureAwait(false);
    }

    private void OnUserDataSaved(object? sender, UserDataSaveEventArgs args)
    {
        if (args?.Item is not null && args.SaveReason is UserDataSaveReason.PlaybackFinished
            or UserDataSaveReason.TogglePlayed or UserDataSaveReason.UpdateUserRating or UserDataSaveReason.UpdateUserData)
            RequestSync();
    }

    private void OnConfigurationChanged(object? sender, MediaBrowser.Model.Plugins.BasePluginConfiguration configuration)
    {
        if (configuration is Jellyfin.Plugin.CommunityRating.Configuration.PluginConfiguration { RankingCollectionsEnabled: true }) RequestSync();
    }

    private async Task SyncAllAsync(CancellationToken cancellationToken)
    {
        if (Plugin.Instance?.Configuration.RankingCollectionsEnabled != true) return;
        await _syncLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var stats = await _statsService.GetAllMovieAndSeriesStatsAsync(cancellationToken).ConfigureAwait(false);
            var definitions = new (string Key, string Name, bool Series, Func<CommunityItemStats, int> Count)[]
            {
                ("movie-views", "Films vus par les membres", false, item => item.ViewCount),
                ("movie-likes", "Films aimés par les membres", false, item => item.LikeCount),
                ("movie-recommended", "Films recommandés par les membres", false, item => item.RecommendationCount),
                ("movie-discouraged", "Films déconseillés par les membres", false, item => item.DiscouragementCount),
                ("series-views", "Séries vues par les membres", true, item => item.ViewCount),
                ("series-likes", "Séries aimées par les membres", true, item => item.LikeCount),
                ("series-recommended", "Séries recommandées par les membres", true, item => item.RecommendationCount),
                ("series-discouraged", "Séries déconseillées par les membres", true, item => item.DiscouragementCount)
            };
            var collections = _libraryManager.GetItemList(new InternalItemsQuery { IncludeItemTypes = [BaseItemKind.BoxSet], EnableTotalRecordCount = false }).OfType<BoxSet>()
                .Where(box => box.ProviderIds.ContainsKey(ProviderKey)).ToDictionary(box => box.ProviderIds[ProviderKey], StringComparer.OrdinalIgnoreCase);
            foreach (var definition in definitions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var collection = collections.GetValueOrDefault(definition.Key);
                if (collection is null)
                {
                    collection = await _collectionManager.CreateCollectionAsync(new CollectionCreationOptions
                    {
                        Name = definition.Name,
                        IsLocked = true,
                        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { [ProviderKey] = definition.Key }
                    }).ConfigureAwait(false);
                    collection.DisplayOrder = "Default";
                    await collection.UpdateToRepositoryAsync(ItemUpdateType.MetadataEdit, cancellationToken).ConfigureAwait(false);
                    collections[definition.Key] = collection;
                }

                var desired = stats.Where(entry =>
                        entry.ItemId != Guid.Empty
                        && definition.Count(entry) > 0
                        && (definition.Series
                            ? _libraryManager.GetItemById(entry.ItemId) is MediaBrowser.Controller.Entities.TV.Series
                            : _libraryManager.GetItemById(entry.ItemId) is Movie))
                    .OrderByDescending(definition.Count)
                    .ThenBy(entry => _libraryManager.GetItemById(entry.ItemId)?.SortName ?? string.Empty, StringComparer.OrdinalIgnoreCase)
                    .Select(entry => entry.ItemId).ToArray();
                var current = collection.LinkedChildren.Where(child => child.ItemId.HasValue).Select(child => child.ItemId!.Value).ToArray();
                if (current.SequenceEqual(desired)) continue;
                if (current.Length > 0) await _collectionManager.RemoveFromCollectionAsync(collection.Id, current).ConfigureAwait(false);
                if (desired.Length > 0) await _collectionManager.AddToCollectionAsync(collection.Id, desired).ConfigureAwait(false);
                collection = _libraryManager.GetItemById(collection.Id) as BoxSet ?? collection;
                collection.DisplayOrder = "Default";
                await collection.UpdateToRepositoryAsync(ItemUpdateType.MetadataEdit, cancellationToken).ConfigureAwait(false);
                _logger.LogInformation("Synchronized Community Rating collection {Name} with {ItemCount} items.", definition.Name, desired.Length);
            }
        }
        finally { _syncLock.Release(); }
    }
}

/// <summary>Public identity of a Community Rating collection; contains no member information.</summary>
public sealed record ManagedCommunityCollection(string Key, Guid Id, string Name);
