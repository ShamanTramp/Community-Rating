using System.Reflection;
using Jellyfin.Plugin.CommunityRating.Services;
using MediaBrowser.Common.Configuration;

namespace Jellyfin.Plugin.CommunityRating.Tests;

public sealed class CommunityVoteStoreTests
{
    [Fact]
    public async Task VotesPersistAcrossStoreInstancesAndCanBeRemoved()
    {
        var dataPath = Path.Combine(Path.GetTempPath(), "community-rating-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dataPath);
        try
        {
            var paths = DispatchProxy.Create<IApplicationPaths, TestApplicationPaths>();
            ((TestApplicationPaths)(object)paths).DataDirectory = dataPath;
            var userId = Guid.NewGuid();
            var itemId = Guid.NewGuid();
            var first = new CommunityVoteStore(paths);
            await first.SetAsync(userId, itemId, 1, CancellationToken.None);

            var afterRestart = new CommunityVoteStore(paths);
            Assert.Equal(1, await afterRestart.GetAsync(userId, itemId, CancellationToken.None));
            await afterRestart.SetAsync(userId, itemId, -1, CancellationToken.None);
            Assert.Equal(-1, await new CommunityVoteStore(paths).GetAsync(userId, itemId, CancellationToken.None));
            await afterRestart.SetAsync(userId, itemId, null, CancellationToken.None);
            Assert.Equal(0, await new CommunityVoteStore(paths).GetAsync(userId, itemId, CancellationToken.None));
        }
        finally
        {
            Directory.Delete(dataPath, recursive: true);
        }
    }

    public class TestApplicationPaths : DispatchProxy
    {
        public string DataDirectory { get; set; } = string.Empty;

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) =>
            targetMethod?.Name == "get_DataPath" ? DataDirectory : throw new NotSupportedException(targetMethod?.Name);
    }
}
