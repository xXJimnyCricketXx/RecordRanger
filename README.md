<p align="center">
  <img src="./docs/img/banner.png" alt="RecordRanger banner" width="100%">
</p>

<p align="center">
  A modern, self-hostable collection manager for vinyl record enthusiasts.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License">
  <img src="https://img.shields.io/badge/Self--Hosted-Yes-green.svg" alt="Self-hosted">
  <img src="https://img.shields.io/badge/Docker-Ready-blue.svg" alt="Docker ready">
  <a href="https://github.com/xXJimnyCricketXx/RecordRanger/actions/workflows/docker-publish.yml">
    <img src="https://github.com/xXJimnyCricketXx/RecordRanger/actions/workflows/docker-publish.yml/badge.svg" alt="Build status">
  </a>
</p>

## Overview

RecordRanger allows you to keep track of your vinyl record collection. It uses the Discogs API to retrieve metadata, tracklists, and market valuations for your collection, providing a convenient and fully customizable dashboard for your home server.

## Contents

- [Features](#features)
- [Quick Start (Docker Compose)](#quick-start-docker-compose)
- [Unraid](#unraid)
- [Configuration](#configuration)
- [Tech Stack](#tech-stack)
- [Documentation](#documentation)
- [License](#license)

## Features

- **Smart Import** — Add records by searching Discogs, scanning a barcode, or entering them manually; import your entire existing Discogs collection or wishlist in one click.
- **Duplicate Detection** — Flags matching entries when adding a record you may already own, letting you bump the quantity instead of creating a duplicate.
- **Advanced Organization** — Track the physical shelf location of every record, and optionally distinguish specific formats like SACD and CDr.
- **Market Insights** — Real-time value estimates (Low/Median/High) based on Discogs market data, converted into your preferred currency.
- **Statistics** — Dedicated statistics page (genre distribution, sleeve condition, value trends, top valuable records, and more) plus modular dashboard widgets.
- **Wishlist** — Keep track of future finds and move them into your collection once received.
- **Print / PDF Export** — Export your collection or wishlist as a printable list.
- **Secure Access** — Authentication with IP blocking, plus visibility controls to hide specific records, genres, or types from guests.
- **Backups** — Manual and scheduled automatic database backups, with restore support.
- **Color Themes** — Several built-in visual themes, including light and dark mode.
- **Multilingual** — Fully localized in English 🇬🇧, French 🇫🇷, German 🇩🇪, Spanish 🇪🇸 and Italian 🇮🇹.

## Quick Start (Docker Compose)

```bash
git clone https://github.com/xXJimnyCricketXx/RecordRanger.git
cd RecordRanger
cp .env.example .env
# edit .env and set at least PASSJWT and SESSION_SECRET (see Configuration below)
docker compose up -d
```

The app is then available at `http://localhost:3099`. See the [Docker Deployment Guide](./docs/docker.md) for the pre-built image option and troubleshooting.

## Unraid

A ready-made template is available at [`unraid-template/recordranger.xml`](unraid-template/recordranger.xml). In Unraid, go to **Docker → Add Container**, paste the raw GitHub URL of that file into the **Template** field, and port, paths, and variables will be pre-filled. See the [Docker Deployment Guide](./docs/docker.md#option-3-unraid) for details.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URL` | yes | Connection string for your MongoDB instance |
| `PASSJWT` | yes | Complex password used for JWT token encryption |
| `SESSION_SECRET` | yes | Complex secret used for session encryption |
| `PROD` | no | Set to `true` **only** if serving over HTTPS via a reverse proxy; otherwise leave `false` |
| `VINYL_PORT` | no | Port the app listens on inside the container (default: `3099`) |
| `BASE_URL` | no | Base path for serving on a sub-path, leave empty to serve from root |
| `DISCOGS_TOKEN` | no | Discogs API token — the app works without it, but with lower rate limits and no condition-based price suggestions. See [API Configuration](./docs/api-keys.md) |

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Node.js / Express |
| Database | MongoDB |
| Frontend | EJS Templates |
| Styling | Tailwind CSS |
| Localization | i18next |
| API | Discogs |

## Documentation

- 🏁 [**Getting Started**](./docs/getting-started.md) - Manual installation and requirements.
- 🐳 [**Docker Deployment**](./docs/docker.md) - Docker Compose, pre-built image, and Unraid.
- 🔑 [**API Configuration**](./docs/api-keys.md) - How to obtain your Discogs API key.

## License

Distributed under the MIT License. See [`LICENSE`](./LICENSE) for more information.
