namespace Jellyfin.Plugin.CommunityRating.Core;

/// <summary>One active user's markers for one item.</summary>
public sealed record UserItemState(
    string UserName,
    bool IsDisabled,
    bool IsPlayed,
    bool IsFavorite);
