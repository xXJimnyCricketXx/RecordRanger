# 🐳 Docker Deployment

The recommended way to run RecordRanger is using Docker. You have two options depending on your needs.

## Option 1: Using Pre-built Image (Recommended)

Best for: Most users who just want to run the app. No need to clone the full repository or install Node.js.

### 1. Setup

Create a new folder and a `docker-compose.yml` file with this content:

```yaml
version: '3.8'
services:
  recordranger-app:
    image: ghcr.io/xxjimnycricketxx/recordranger:latest
    container_name: recordranger_app
    restart: unless-stopped
    ports:
      - "3099:3099"
    volumes:
      - ./public/uploads:/app/public/uploads
    env_file:
      - .env
    depends_on:
      - mongodb

  mongodb:
    image: mongo:latest
    container_name: recordranger_db
    restart: unless-stopped
    volumes:
      - ./mongo_data:/data/db

volumes:
  mongo_data:
```

If you are stuggling with the deploy, you can try this config (thank you @mistic100) :

```yaml
services:
  recordranger-app:
    image: ghcr.io/xxjimnycricketxx/recordranger:latest
    pull_policy: missing
    container_name: recordranger_app
    restart: unless-stopped
    depends_on:
      - mongodb
    environment:
      - MONGODB_URL=mongodb://mongodb:27017/recordranger
      - VINYL_PORT=80
      - BASE_URL=
      - PROD=false
      - PASSJWT=<something>
      - SESSION_SECRET=<something>
      - DISCOGS_TOKEN=<something>
    ports:
      - '<external_port>:80'
    volumes:
      - /mnt/<uploads_dataset>:/app/public/uploads

  mongodb:
    image: mongo:latest
    pull_policy: missing
    container_name: recordranger_db
    restart: unless-stopped
    volumes:
      - /mnt/<mongo_dataset>:/data/db
```

> Note: If you're using a **Raspberry Pi** and MongoDB keeps restarting, try a different version of MongoDB, such as:
> ```yaml
> mongodb:
>   image: mongo:4.4.18
> ```
> Thank you @oliverjunker for this!

### 2. Prepare Environment

If you don't use `environment` in your conf file, ensure you have a `.env` file in the root directory.  
For both case, you can use the provided `.env.example` as a starting point.

[Get your API keys here.](./api-keys.md)

### 3. Launch

```bash
docker compose up -d
```

## Option 2: Build from Source

Best for: Developers or those who want to customize the code.

1. **Clone the repo**: `git clone https://github.com/xXJimnyCricketXx/RecordRanger.git`
2. **Make your `.env` file** using `.env.example` and [api keys page](./api-keys.md).
3. **Build and start**:

```bash
docker compose up --build -d
```

## Option 3: Unraid

Best for: Unraid users. RecordRanger isn't (yet) listed in Community Applications, but you can add it manually:

1. Install a MongoDB container first (any MongoDB template works), and note its container IP or hostname.
2. Go to **Docker → Add Container**.
3. In the **Template** field at the top, paste this URL and hit Tab/Enter to load it:
   ```
   https://raw.githubusercontent.com/xXJimnyCricketXx/RecordRanger/main/unraid-template/recordranger.xml
   ```
4. All fields (port, paths, variables) will auto-fill. Adjust the `MongoDB URL`, `JWT Password`, `Session Secret` and `Discogs API Token` fields, then click **Apply**.

> Applying the template once saves a local copy to `/boot/config/plugins/dockerMan/templates-user/`, so RecordRanger will also show up under **Add Container → Select a template** for future re-installs.

## 🔄 Updating

### Updating (Pre-built Image)

If you are using the GHCR image (Option 1):

```bash
docker compose pull
docker compose up -d
```

### Updating (Manual Build)

If you cloned the repository (Option 2):

```bash
git pull
docker compose up --build -d
```


## 💾 Persistence

By default, the database data is stored in a Docker volume named mongo-data. This ensures your collection is not lost when you stop or update the containers.

## 🗑️ Full reset & Data loss

If you have made significant changes and need to rebuild the application from a clean slate, follow the steps below.

> [!IMPORTANT]
> This procedure will permanently delete all local data. If you have data you wish to keep, export your database before proceeding.

```bash
# Stop containers and remove volumes (-v)
sudo docker compose down -v

# Delete local database files
sudo rm -rf ./mongo_data

# Rebuild and restart the services
sudo docker compose up -d
```

[← Back to README](../README.md)  
[Get your API keys →](./api-keys.md)
