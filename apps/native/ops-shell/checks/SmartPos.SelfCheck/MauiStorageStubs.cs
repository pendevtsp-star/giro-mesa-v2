global using Microsoft.Maui.Storage;

namespace Microsoft.Maui.Storage;

public interface ISecureStorage
{
    Task SetAsync(string key, string value);
    Task<string?> GetAsync(string key);
    bool Remove(string key);
}

public static class SecureStorage
{
    public static ISecureStorage Default { get; } = new InMemorySecureStorage();

    private sealed class InMemorySecureStorage : ISecureStorage
    {
        private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);

        public Task SetAsync(string key, string value)
        {
            _values[key] = value;
            return Task.CompletedTask;
        }

        public Task<string?> GetAsync(string key) =>
            Task.FromResult(_values.TryGetValue(key, out var value) ? value : null);

        public bool Remove(string key) => _values.Remove(key);
    }
}
