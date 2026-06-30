![banner recordranger](./docs/img/banner.png)

---

**RecordRanger!** is a modern, self-hostable collection manager designed for physical media enthusiasts. From Vinyls and CDs to Books, Movies and Games, catalog, value, and organize your entire physical library through a single, customizable interface.

Built in JavaScript.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Self-Hosted](https://img.shields.io/badge/Self--Hosted-Yes-green.svg)](#)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](#)



## Overview

RecordRanger allows you to keep track of your physical music, books or even DVD collection. It uses the Discogs API, Hardcover API, IGDB API & TMDB API to retrieve important metadata and, for music, market valuations for your collection. This provides you with a convenient and full customizable dashboard for your home server.

## ✨ Key Features

### 📚 Universal Collection Management

   * **Multi-Format Support:** Manage your Music (Vinyls, CDs, Cassettes), Books (Manga, Comics, Hardcover), and Movies (Blu-ray, 4K, VHS, LaserDisc) and video games in one unified library.
   * **Smart Import:** Add items instantly using Discogs Release IDs or import your entire existing Discogs collection in one click.
   * **Physical Scanner:*** Scan your physical media to bridge the gap between your shelf and your digital database.
   * **Advanced Organization:** Easily track the physical location of every item in your home.

### 🎨 Fully Customizable Experience

   * **Tailored Interface:** Customize your navigation bar with shortcuts that matter to you.
   * **Personalized Analytics:** Build your dashboard with modular statistics widgets.
   * **Category Themes:** Apply unique visual themes to differentiate your music, book, and movie libraries.
   * **Native Design:** Optimized for mobile with seamless Dark & Light modes.

### 💎 Advanced Tools & Privacy

   * **Market Insights:** Get real-time value estimates (Low/Median/High) for your **music** collection.
   * **Wishlist System:** Keep track of your future finds.
   * **Secure Access:** Integrated authentication system for private viewing or sharing your collection with others.
   * **Multilingual:** Fully localized in English 🇬🇧, French 🇫🇷, German 🇩🇪, Spanish 🇪🇸 and Italian 🇮🇹.

## Documentation

To keep things organized, the documentation is split into specialized guides:

* 🏁 [**Getting Started**](./docs/getting-started.md) - Manual installation and requirements.
* 🐳 [**Docker Deployment**](./docs/docker.md) - Deploying via Docker Compose *(Recommended)*.
* 🔑 [**API Configuration**](./docs/api-keys.md) - How to obtain your Discogs, Hardcover and TMDB API keys.

---

## Quick Start (Docker)

The fastest way to run RecordRanger is using Docker. You only need a `docker-compose.yml` and a `.env` file.

1. **Create a `docker-compose.yml`** (see [Docker Deployment Guide](./docs/docker.md) for the full file).
2. **Setup your environment variables** in a `.env` file (go check how to get your [api keys](./docs/api-keys.md)).
3. **Run the application**:
   ```bash
   docker compose up -d
   ```

Access the application at `http://localhost:3099`.

# Tech stack

| **Component**    | **Technology**                    |
| :--------------- | :-------------------------------- |
| **Backend**      | Node.js / Express                 |
| **Database**     | MongoDB                           |
| **Frontend**     | EJS Templates                     |
| **Styling**      | Tailwind CSS                      |
| **Localization** | i18next                           |
| **API**          | Discogs / Hardcover / TMDB / IGDB |

# 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
