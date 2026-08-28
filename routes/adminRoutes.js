const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const BlockedIP = require("../models/blockedIP");
const LoginLog = require("../models/LoginLog");
const Settings = require("../models/Settings");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");
const PRESETS = require("../config/themes");
const axios = require("axios");
const https = require("https");
const Item = require("../models/Item");
const Vinyl = require("../models/Vinyl");
const { listBackups } = require("../utils/backupScheduler");

/**
 * routes/adminRoutes.js
 *
 * Administration routes: user management, IP blocking and login logs.
 */

/**
 * Generate a random password.
 * @param {number} [length=12]
 * @returns {string}
 */
const createPassword = (length = 12) => {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

/**
 * Helper to escape regular expression special characters.
 * @param {string} string
 * @returns {string}
 */
const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Helper to load the common admin data used by the dashboard view.
 * Centralizing this avoids duplicating queries across handlers.
 */
async function loadAdminData() {
  const users = await User.find().sort({ lastChange: -1 });
  const blockedIps = await BlockedIP.find().sort({ createdAt: -1 });
  const logs = await LoginLog.find().sort({ timestamp: -1 }).limit(20);

  // Get distinct genres grouped by kind
  const admin = await User.findOne({ isAdmin: true }).select("_id");
  const adminId = admin ? admin._id : null;

  const pipeline = [
    { $match: { owner: adminId } },
    {
      $project: {
        kind: 1,
        allGenres: {
          $concatArrays: [
            { $cond: [{ $in: ["$genre", ["", null]] }, [], ["$genre"]] },
            { $ifNull: ["$genres", []] },
            { $ifNull: ["$styles", []] },
          ],
        },
      },
    },
    { $unwind: "$allGenres" },
    {
      $group: {
        _id: "$kind",
        genres: { $addToSet: "$allGenres" },
      },
    },
  ];

  const genreGroupsRaw = await Item.aggregate(pipeline);

  const allGenres = {};
  genreGroupsRaw.forEach((group) => {
    if (group._id && group.genres && group.genres.length > 0) {
      allGenres[group._id] = group.genres.filter(Boolean).sort();
    }
  });

  const visibilitySettings =
    (await Settings.findOne().populate("visibility.hiddenItems").lean()) || {};

  const backups = listBackups();
  const backupSettings = (visibilitySettings.backupSchedule) || {
    enabled: false, time: "03:00", intervalDays: 1, retention: 3, lastRunAt: null
  };

  const collectionCount = await Item.countDocuments({ owner: adminId, in_wishlist: false });
  const wishlistCount = await Item.countDocuments({ owner: adminId, in_wishlist: true });

  return { users, blockedIps, logs, allGenres, visibilitySettings, backups, backupSettings, collectionCount, wishlistCount };
}

// DASHBOARD (GET)
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = await loadAdminData();

    // Read optional message key from query and translate in the view.
    const msgKey = req.query.msg;

    res.render("admin", {
      ...data,
      user: res.locals.user,
      successMessage: msgKey ? req.t(`messages.${msgKey}`) : null,
      newPassword: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(req.t("errors.generic_server_error"));
  }
});

// Add user (POST)
router.post("/add-user", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, email } = req.body;
    const password = createPassword();
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user then force-update the stored password hash.
    const newUser = await User.create({
      username,
      email,
      password: password,
      lastChange: new Date(),
    });

    await User.updateOne(
      { _id: newUser._id },
      { $set: { password: hashedPassword } },
    );

    // Reload admin data (including logs) for the rendered view.
    const data = await loadAdminData();

    res.render("admin", {
      ...data,
      user: res.locals.user,
      successMessage: `Utilisateur ${username} créé !`,
      newPassword: password,
    });
  } catch (err) {
    console.error("Creation error:", err);
    res.redirect("/admin?msg=user_created");
  }
});

// Reset password (POST)
router.post("/reset-password", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    const userToUpdate = await User.findById(userId);

    if (userToUpdate) {
      const password = createPassword();
      const hashedPassword = await bcrypt.hash(password, 10);

      await User.updateOne(
        { _id: userId },
        { $set: { password: hashedPassword, lastChange: new Date() } },
      );

      // Reload data for the view after change.
      const data = await loadAdminData();

      res.render("admin", {
        ...data,
        user: res.locals.user,
        successMessage: req.t("messages.password_reset_success", {
          name: userToUpdate.username,
        }),
        newPassword: password,
      });
    } else {
      res.redirect("/admin");
    }
  } catch (err) {
    console.error(err);
    res.redirect("/admin");
  }
});

// 4. Simple actions (redirects)
// These handlers redirect back to the admin root and therefore do not
// need to reload the logs.
router.post("/delete-user", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.body.userId === res.locals.user._id.toString())
      return res.redirect("/admin?msg=delete_self_error");
    await User.findByIdAndDelete(req.body.userId);
    res.redirect("/admin?msg=user_deleted");
  } catch (err) {
    res.redirect("/admin");
  }
});

router.post("/block-ip", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ipAddress } = req.body;
    const exists = await BlockedIP.findOne({ ip: ipAddress });
    if (!exists) await BlockedIP.create({ ip: ipAddress });
    res.redirect("/admin?msg=ip_blocked");
  } catch (err) {
    res.redirect("/admin");
  }
});

router.post("/unblock-ip", requireAuth, requireAdmin, async (req, res) => {
  try {
    await BlockedIP.findByIdAndDelete(req.body.ipId);
    res.redirect("/admin?msg=ip_unblocked");
  } catch (err) {
    res.redirect("/admin");
  }
});

router.get("/personnalisation", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.render("personnalisation", {
      presets: PRESETS,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("ERR");
  }
});

router.post(
  "/personnalisation/save",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const {
        preset,
        statsWidgets,
      } = req.body;

      const stats = Array.isArray(statsWidgets)
        ? statsWidgets
        : statsWidgets
          ? [statsWidgets]
          : [];

      const update = {
        "theme.preset": preset,
        statsWidgets: stats,
      };

      await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true });

      res.redirect("/admin/personnalisation?msg=saved");
    } catch (err) {
      console.error("[ERR] perso save", err);
      res.status(500).send("[ERR] perso save failed.");
    }
  },
);

router.post("/visibility/save", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { applyToAdmin, hiddenItems, hiddenGenres, hiddenTypes } = req.body;

    let parsedItems = [];
    if (hiddenItems) {
      try {
        parsedItems = JSON.parse(hiddenItems);
      } catch (e) {
        parsedItems = [];
      }
    }

    const applyToAdminVal =
      applyToAdmin === "on" || applyToAdmin === "true" || applyToAdmin === true;
    const update = {
      "visibility.applyToAdmin": applyToAdminVal,
      "visibility.hiddenItems": parsedItems,
      "visibility.hiddenGenres": Array.isArray(hiddenGenres)
        ? hiddenGenres
        : hiddenGenres
          ? [hiddenGenres]
          : [],
      "visibility.hiddenTypes": Array.isArray(hiddenTypes)
        ? hiddenTypes
        : hiddenTypes
          ? [hiddenTypes]
          : [],
    };

    await Settings.findOneAndUpdate({}, { $set: update }, { upsert: true });

    res.redirect("/admin?msg=saved");
  } catch (err) {
    console.error("[ERR] visibility save", err);
    res.status(500).send("[ERR] visibility save failed.");
  }
});

router.post(
  "/batch-update-barcodes",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { barcodeList } = req.body;
      if (!barcodeList) return res.redirect("/admin?msg=error");

      const lines = barcodeList
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.includes(":"));
      let count = 0;

      for (const line of lines) {
        const [discogsId, barcode] = line.split(":").map((s) => s.trim());
        if (discogsId && barcode) {
          const result = await Item.updateMany(
            { discogs_id: parseInt(discogsId), kind: "Music" },
            { $set: { barcode: barcode, barcode_locked: true } },
          );
          count += result.modifiedCount;
        }
      }

      res.redirect(`/admin?msg=batch_barcode_success&count=${count}`);
    } catch (err) {
      console.error("[ERR] batch-update-barcodes", err);
      res.redirect("/admin?msg=error");
    }
  },
);

router.get(
  "/api/search-collection",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);

        const admin = await User.findOne({ isAdmin: true }).select('_id');
        const adminId = admin ? admin._id : null;

        const regex = new RegExp(escapeRegExp(q), 'i');
        const items = await Item.find({
            owner: adminId,
            $or: [{ title: regex }, { artist: regex }, { author: regex }, { director: regex }, { barcode: regex }]
        }).limit(10).select('_id title artist author director kind cover_image format format_type platform media_type').lean();

        res.json(items);
    } catch (err) {
      console.error("[ERR] search collection", err);
      res.status(500).json({ error: "Search failed" });
    }
  },
);

router.get(
  "/api/search-image-universal",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { q, type } = req.query;
    console.log(`[SEARCH] Query: "${q}" | Type: ${type}`);

    const axiosConfig = {
      headers: { "User-Agent": "RecordRangerApp/1.0" },
      timeout: 10000,
      httpsAgent: new https.Agent({ family: 4, keepAlive: true }),
    };

    try {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=album&limit=12`;
      const response = await axios.get(itunesUrl, axiosConfig);

      const results = (response.data.results || []).map((item) => {
        return item.artworkUrl100.replace("100x100bb.jpg", "600x600bb.jpg");
      });

      console.log(`[SEARCH] iTunes found: ${results.length}`);
      res.json(results);
    } catch (err) {
      console.error("[ERR] search image universal:", err.message);
      res.status(500).json({ error: "[ERR] connexion error" });
    }
  },
);

router.get(
  "/api/search-discogs-gallery",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { q } = req.query;
      const axiosConfig = {
        headers: {
          "User-Agent": "RecordRangerApp/1.0",
          Authorization: `Discogs token=${process.env.DISCOGS_TOKEN || ""}`,
        },
      };

      const searchRes = await axios.get(
        `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&per_page=3`,
        axiosConfig,
      );
      const results = searchRes.data.results || [];
      const galleryPromises = results.map(async (item) => {
        try {
          const detail = await axios.get(
            `https://api.discogs.com/releases/${item.id}`,
            axiosConfig,
          );
          return (detail.data.images || []).map((img) => img.resource_url);
        } catch (e) {
          return [];
        }
      });

      const allGalleries = await Promise.all(galleryPromises);

      const finalImages = [...new Set(allGalleries.flat())];

      res.json(finalImages);
    } catch (err) {
      console.error("[ERR] Discogs Global Gallery:", err.message);
      res.status(500).json({ error: "ERROR Discogs search" });
    }
  },
);

router.post(
  "/delete-last-items",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { count, kind } = req.body;
    const n = parseInt(count);

    if (!n || n < 1) return res.status(400).json({ error: "Invalid count" });
    if (!["Music"].includes(kind))
      return res.status(400).json({ error: "Invalid kind" });

    try {
      const items = await Item.find({ owner: req.user._id, kind })
        .sort({ added_at: -1, _id: -1 })
        .limit(n)
        .select("_id");

      const ids = items.map((i) => i._id);
      const result = await Item.deleteMany({ _id: { $in: ids } });

      res.json({ deleted: result.deletedCount });
    } catch (err) {
      console.error("[ERR] delete-last-items:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// Danger Zone: wipe the entire collection or the entire wishlist. Both are
// full, unscoped deletes (unlike delete-last-items) so the frontend must
// require a typed confirmation before calling these.
router.post("/danger/wipe-collection", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await Item.deleteMany({ owner: req.user._id, in_wishlist: false });
    res.json({ deleted: result.deletedCount });
  } catch (err) {
    console.error("[ERR] wipe-collection:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/danger/wipe-wishlist", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await Item.deleteMany({ owner: req.user._id, in_wishlist: true });
    res.json({ deleted: result.deletedCount });
  } catch (err) {
    console.error("[ERR] wipe-wishlist:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/refresh-all-music-metadata",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { mode = "all" } = req.body;
    const token = process.env.DISCOGS_TOKEN;
    if (!token)
      return res.status(500).json({ error: "Discogs token not configured" });

    try {
      let query = {
        discogs_id: { $exists: true, $ne: null },
      };

      let conditions = [
        { $or: [{ kind: "Music" }, { kind: { $exists: false } }] },
      ];

      if (mode === "missing") {
        conditions.push({
          $or: [
            { genre: { $exists: false } },
            { genre: "" },
            { genre: null },
            { genres: { $exists: false } },
            { genres: { $size: 0 } },
            { styles: { $exists: false } },
            { styles: { $size: 0 } },
            { tracklist: { $exists: false } },
            { tracklist: { $size: 0 } },
          ],
        });
      }

      query.$and = conditions;

      const albums = await Item.find(query).select(
        "_id discogs_id title artist genre genres styles tracklist barcode_locked",
      );
      if (albums.length === 0) return res.json({ success: true, count: 0 });

      res.status(202).json({ success: true, total: albums.length });

      (async () => {
        const io = req.app.get("io");
        let current = 0;
        for (const album of albums) {
          current++;
          let success = false;
          let retries = 0;
          while (!success && retries < 3) {
            try {
              if (io && retries === 0) {
                io.emit("refresh_all_progress", {
                  current,
                  total: albums.length,
                  title: `${album.artist} - ${album.title}`,
                });
              }

              const response = await axios.get(
                `https://api.discogs.com/releases/${album.discogs_id}`,
                {
                  headers: {
                    "User-Agent": "RecordRangerApp/1.0",
                    Authorization: `Discogs token=${token}`,
                  },
                },
              );

              const {
                genres = [],
                styles = [],
                tracklist = [],
                identifiers = [],
              } = response.data;

              const updateObj = {};
              if (mode === "all" || !album.genres || album.genres.length === 0)
                updateObj.genres = genres;
              if (mode === "all" || !album.styles || album.styles.length === 0)
                updateObj.styles = styles;
              if (
                mode === "all" ||
                !album.tracklist ||
                album.tracklist.length === 0
              )
                updateObj.tracklist = tracklist;

              if (!album.barcode_locked) {
                const barcodeObj = identifiers.find(
                  (id) => id.type === "Barcode",
                );
                if (barcodeObj) {
                  updateObj.barcode = barcodeObj.value.replace(/\s/g, "");
                }
              }

              if (!album.genre || album.genre.trim() === "") {
                updateObj.genre = genres[0] || "";
              }

              await Item.updateOne({ _id: album._id }, { $set: updateObj });

              success = true;
              // Respect Discogs API limit (60 req/min)
              await new Promise((r) => setTimeout(r, 1500));
            } catch (err) {
              retries++;
              console.error(
                `[ERR] Refresh bulk ID ${album.discogs_id} (Attempt ${retries}):`,
                err.message,
              );
              if (err.response && err.response.status === 429) {
                // Wait longer if rate limited
                await new Promise((r) => setTimeout(r, 10000));
              } else {
                if (retries >= 3) {
                  await new Promise((r) => setTimeout(r, 1000));
                } else {
                  await new Promise((r) => setTimeout(r, 2000));
                }
              }
              if (retries >= 3 && err.response && err.response.status === 404) {
                success = true; // Break out if 404
              }
            }
          }
        }
        if (io) io.emit("refresh_all_finished", { count: current });
      })();
    } catch (err) {
      console.error("[ERR] Bulk refresh route:", err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  },
);

module.exports = router;
