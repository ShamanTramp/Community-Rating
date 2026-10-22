using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.CommunityRating.Configuration;

/// <summary>Settings for aggregated community view and favorite badges.</summary>
public sealed class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>Gets or sets whether community badges are displayed.</summary>
    public bool EnableBadges { get; set; } = true;

    /// <summary>Gets or sets excluded active user names as a comma-separated list.</summary>
    public string ExcludedUserNames { get; set; } = string.Empty;

    /// <summary>Gets or sets whether administrator-only name tooltips are enabled.</summary>
    public bool EnableAdminTooltips { get; set; }

    /// <summary>Gets or sets whether card counters are stacked vertically.</summary>
    public bool StackCardBadges { get; set; }

    /// <summary>Gets or sets the badge scale in CSS pixels.</summary>
    public int BadgeScale { get; set; } = 16;

    /// <summary>Gets or sets the horizontal inset from the upper-left corner.</summary>
    public int BadgeInsetX { get; set; } = 8;

    /// <summary>Gets or sets the vertical inset from the upper-left corner.</summary>
    public int BadgeInsetY { get; set; } = 8;

    /// <summary>Gets or sets the badge background opacity from 0 to 100.</summary>
    public int BackgroundOpacity { get; set; } = 45;

    /// <summary>Gets or sets the full-rebuild interval in hours (1 or 6).</summary>
    public int RefreshIntervalHours { get; set; } = 6;
}
