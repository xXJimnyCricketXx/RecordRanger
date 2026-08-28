# 🔑 API Configuration

RecordRanger relies on the Discogs API to fetch album metadata, tracklists, and market values.
> You can get this key for **free**.

## 🎵 Discogs API (Recommended)

*Used for fetching album metadata, tracklists, and market value estimates. The app works without it, but with reduced rate limits and no condition-based price suggestions.*

1.  Log in to [Discogs.com](https://www.discogs.com/).
2.  Go to **Settings > Developers**.
3.  Click **Generate new token**.
4.  Copy this token and paste it into your `.env` file as `DISCOGS_TOKEN`.

---

⚠️ **Security Note:** Never commit your `.env` file to GitHub. It contains sensitive credentials that should remain private.

[← Back to README](../README.md)  
