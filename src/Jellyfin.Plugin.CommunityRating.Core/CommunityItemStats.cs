namespace Jellyfin.Plugin.CommunityRating.Core;

/// <summary>Aggregated community activity for a Jellyfin media item.</summary>
public sealed record CommunityItemStats(
    Guid ItemId,
    int ViewCount,
    int LikeCount,
    IReadOnlyList<string> ViewedBy,
    IReadOnlyList<string> LikedBy,
    IReadOnlyList<string>? RecommendedBy = null,
    IReadOnlyList<string>? DiscouragedBy = null)
{
    /// <summary>Gets the number of included members recommending this item.</summary>
    public int RecommendationCount => RecommendedBy?.Count ?? 0;

    /// <summary>Gets the number of included members discouraging this item.</summary>
    public int DiscouragementCount => DiscouragedBy?.Count ?? 0;
}
