global using Microsoft.Maui.ApplicationModel;

namespace Android.App
{
    public enum Result
    {
        Canceled = 0,
        Ok = -1,
    }

    public class Activity
    {
        public void StartActivityForResult(Android.Content.Intent intent, int requestCode)
        {
        }
    }
}

namespace Android.Content
{
    public sealed class Intent : IDisposable
    {
        public const string ActionView = "android.intent.action.VIEW";
        public const string CategoryBrowsable = "android.intent.category.BROWSABLE";

        public Intent(string action, Android.Net.Uri uri)
        {
        }

        public void SetPackage(string packageName)
        {
        }

        public void AddCategory(string category)
        {
        }

        public void Dispose()
        {
        }
    }

    public sealed class ActivityNotFoundException : Exception
    {
    }
}

namespace Android.Net
{
    public sealed class Uri
    {
        public static Uri? Parse(string value) => new();
    }
}

namespace Java.Lang
{
    public sealed class SecurityException : Exception
    {
    }
}

namespace Microsoft.Maui.ApplicationModel
{
    public static class Platform
    {
        public static Android.App.Activity? CurrentActivity { get; set; } = new();
    }

    public static class MainThread
    {
        public static Task InvokeOnMainThreadAsync(Action action)
        {
            action();
            return Task.CompletedTask;
        }
    }
}
