using System.Text.Json;
using MediaBrowser.Common.Configuration;

namespace Jellyfin.Plugin.CommunityRating.Services;

/// <summary>Persists Community Rating votes separately from Jellyfin favorites and watchlists.</summary>
public sealed class CommunityVoteStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Dictionary<string, int>? _votes;

    /// <summary>Creates the vote store below Jellyfin's data directory.</summary>
    public CommunityVoteStore(IApplicationPaths paths) =>
        _path = Path.Combine(paths.DataPath, "CommunityRating", "votes.json");

    /// <summary>Reads all votes. Keys are encoded as user-id/item-id pairs.</summary>
    public async Task<IReadOnlyDictionary<string, int>> GetAllAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureLoadedAsync(cancellationToken).ConfigureAwait(false);
            return new Dictionary<string, int>(_votes!, StringComparer.OrdinalIgnoreCase);
        }
        finally { _gate.Release(); }
    }

    /// <summary>Reads the signed vote for one account and item.</summary>
    public async Task<int> GetAsync(Guid userId, Guid itemId, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureLoadedAsync(cancellationToken).ConfigureAwait(false);
            return _votes!.GetValueOrDefault(Key(userId, itemId));
        }
        finally { _gate.Release(); }
    }

    /// <summary>Sets or removes a vote and atomically saves the resulting store.</summary>
    public async Task SetAsync(Guid userId, Guid itemId, int? vote, CancellationToken cancellationToken)
    {
        if (vote is not null and not (-1 or 1)) throw new ArgumentOutOfRangeException(nameof(vote));
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureLoadedAsync(cancellationToken).ConfigureAwait(false);
            var key = Key(userId, itemId);
            var hadOldVote = _votes!.TryGetValue(key, out var oldVote);
            if (vote.HasValue) _votes![key] = vote.Value;
            else _votes!.Remove(key);
            try { await SaveAsync(cancellationToken).ConfigureAwait(false); }
            catch
            {
                if (hadOldVote) _votes[key] = oldVote;
                else _votes.Remove(key);
                throw;
            }
        }
        finally { _gate.Release(); }
    }

    private async Task EnsureLoadedAsync(CancellationToken cancellationToken)
    {
        if (_votes is not null) return;
        if (!File.Exists(_path)) { _votes = new(StringComparer.OrdinalIgnoreCase); return; }
        await using var stream = File.OpenRead(_path);
        _votes = await JsonSerializer.DeserializeAsync<Dictionary<string, int>>(stream, JsonOptions, cancellationToken).ConfigureAwait(false)
            ?? new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    }

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temporary = _path + ".tmp";
        await using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 65536, useAsync: true))
        {
            await JsonSerializer.SerializeAsync(stream, _votes, JsonOptions, cancellationToken).ConfigureAwait(false);
            await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
        File.Move(temporary, _path, overwrite: true);
    }

    private static string Key(Guid userId, Guid itemId) => $"{userId:N}/{itemId:N}";

    /// <summary>Builds the stable lookup key for a user's vote.</summary>
    public static string CreateKey(Guid userId, Guid itemId) => Key(userId, itemId);
}
