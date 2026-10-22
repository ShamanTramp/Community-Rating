namespace Jellyfin.Plugin.CommunityRating.Core;

/// <summary>Aggregated community activity for a Jellyfin media item.</summary>
public sealed record CommunityItemStats(
    Guid ItemId,
    int ViewCount,
    int LikeCount,
    IReadOnlyList<string> ViewedBy,
    IReadOnlyList<string> LikedBy);
