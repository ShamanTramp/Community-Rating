using System.Reflection;
using System.Runtime.Loader;
using System.Text;
using System.Security.Claims;
using Jellyfin.Plugin.CommunityRating.Configuration;
using Jellyfin.Plugin.CommunityRating.Services;
using MediaBrowser.Common.Api;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.CommunityRating.Api;

/// <summary>Endpoints for aggregate community markers and the client-side renderer.</summary>
[ApiController]
[Route("CommunityRating")]
public sealed class CommunityRatingController(CommunityStatsService statsService, CommunityCollectionService? collectionService = null) : ControllerBase
{
    private const int MaximumBatchSize = 100;

    /// <summary>Gets aggregate counters for movies, series, and episodes.</summary>
    /// <param name="ids">The requested Jellyfin item identifiers.</param>
    /// <param name="cancellationToken">The request cancellation token.</param>
    /// <returns>Counts and safe presentation settings.</returns>
    [HttpGet("Items")]
    [Authorize]
    [ProducesResponseType<CommunityStatsResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<CommunityStatsResponse>> GetItems([FromQuery(Name = "ids")] Guid[]? ids, CancellationToken cancellationToken)
    {
        if (ids is null || ids.Length == 0 || ids.Length > MaximumBatchSize)
        {
            return BadRequest("Request between 1 and 100 item ids.");
        }

        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var items = await statsService.GetStatsAsync(ids, cancellationToken).ConfigureAwait(false);
        return Ok(new CommunityStatsResponse(items.Select(CommunityItemCounts.FromStats).ToArray(), ToDisplayOptions(config)));
    }

    /// <summary>Reads the signed-in member's own vote state for a batch of media items.</summary>
    [HttpGet("Me/Votes")]
    [Authorize]
    public async Task<IActionResult> GetMyVotes([FromQuery(Name = "ids")] Guid[]? ids, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (ids is null || ids.Length == 0 || ids.Length > MaximumBatchSize) return BadRequest("Request between 1 and 100 item ids.");
        var votes = await statsService.GetUserVotesAsync(userId, ids, cancellationToken).ConfigureAwait(false);
        return Ok(votes.Select(pair => new { ItemId = pair.Key, Vote = pair.Value }).ToArray());
    }

    /// <summary>Sets the signed-in member's vote for an accessible media item.</summary>
    [HttpPut("Me/Votes/{id:guid}")]
    [Authorize]
    public async Task<IActionResult> SetMyVote(Guid id, [FromBody] SetCommunityVoteRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (request.Vote is not (1 or -1)) return BadRequest("Vote must be 1 or -1.");
        var result = await statsService.SetVoteAsync(userId, id, request.Vote, cancellationToken).ConfigureAwait(false);
        if (result is not null) collectionService?.RequestSync();
        return result is null ? NotFound() : Ok(new
        {
            Item = CommunityItemCounts.FromStats(result.ItemStats),
            Vote = request.Vote,
            ParentSeries = result.ParentSeriesStats is null ? null : CommunityItemCounts.FromStats(result.ParentSeriesStats)
        });
    }

    /// <summary>Clears the signed-in member's vote for an accessible media item.</summary>
    [HttpDelete("Me/Votes/{id:guid}")]
    [Authorize]
    public async Task<IActionResult> DeleteMyVote(Guid id, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var result = await statsService.SetVoteAsync(userId, id, null, cancellationToken).ConfigureAwait(false);
        if (result is not null) collectionService?.RequestSync();
        return result is null ? NotFound() : Ok(new
        {
            Item = CommunityItemCounts.FromStats(result.ItemStats),
            Vote = (int?)null,
            ParentSeries = result.ParentSeriesStats is null ? null : CommunityItemCounts.FromStats(result.ParentSeriesStats)
        });
    }

    /// <summary>Queues or runs native ranking collection synchronization.</summary>
    [HttpPost("Admin/Collections/Rebuild")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public IActionResult RebuildCollections()
    {
        if (Plugin.Instance?.Configuration.RankingCollectionsEnabled != true) return BadRequest("Enable ranking collections in plugin settings first.");
        collectionService?.RequestSync();
        return Accepted();
    }

    /// <summary>Gets public IDs for the native collections managed by the plugin.</summary>
    [HttpGet("Collections")]
    [Authorize]
    public IActionResult GetCollections() => Ok(collectionService?.GetManagedCollections() ?? []);

    /// <summary>Gets the client renderer for JavaScript Injector.</summary>
    /// <returns>JavaScript source.</returns>
    [HttpGet("client.js")]
    [AllowAnonymous]
    [Produces("application/javascript")]
    public IActionResult GetClientScript()
    {
        const string resourceName = "Jellyfin.Plugin.CommunityRating.Web.community-rating.js";
        using var stream = typeof(CommunityRatingController).Assembly.GetManifestResourceStream(resourceName);
        if (stream is null)
        {
            return NotFound();
        }

        using var reader = new StreamReader(stream, Encoding.UTF8);
        return Content(reader.ReadToEnd(), "application/javascript", Encoding.UTF8);
    }

    /// <summary>Gets per-account marker names for administrator-only tooltips.</summary>
    /// <param name="ids">The requested Jellyfin item identifiers.</param>
    /// <param name="cancellationToken">The request cancellation token.</param>
    /// <returns>Names associated with the requested view and favorite markers.</returns>
    [HttpGet("Admin/Items")]
    [Authorize(Policy = Policies.RequiresElevation)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetAdminItems([FromQuery(Name = "ids")] Guid[]? ids, CancellationToken cancellationToken)
    {
        if (Plugin.Instance?.Configuration.EnableAdminTooltips != true)
        {
            return Forbid();
        }

        if (ids is null || ids.Length == 0 || ids.Length > MaximumBatchSize)
        {
            return BadRequest("Request between 1 and 100 item ids.");
        }

        var items = await statsService.GetAdminStatsAsync(ids, cancellationToken).ConfigureAwait(false);
        return Ok(items);
    }

    private static CommunityDisplayOptions ToDisplayOptions(PluginConfiguration config) => new(
        config.EnableBadges,
        Math.Clamp(config.BadgeScale, 12, 28),
        Math.Clamp(config.BadgeInsetX, 0, 32),
        Math.Clamp(config.BadgeInsetY, 0, 32),
        Math.Clamp(config.BackgroundOpacity, 0, 90),
        config.EnableAdminTooltips,
        config.StackCardBadges,
        double.IsFinite(config.DetailScaleFactor) ? Math.Clamp(config.DetailScaleFactor, 1, 3) : 1,
        config.StackCardBadges && config.CardLayout == "auto" ? "column"
            : config.CardLayout is "row" or "column" or "auto" ? config.CardLayout : "auto",
        config.RankingCollectionsEnabled);

    private bool TryGetUserId(out Guid userId)
    {
        var value = User.FindFirst("Jellyfin-UserId")?.Value
            ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return Guid.TryParse(value, out userId);
    }
}

/// <summary>A signed-in member's explicit positive or negative vote.</summary>
public sealed record SetCommunityVoteRequest(int Vote);
