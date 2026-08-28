const mongoose = require('mongoose');
const Item = require('./Item');

const vinylSchema = new mongoose.Schema({
  artist: { type: String, required: true },
  label: String,
  catalog_number: String,
  genre: { type: String, default: '' },
  genres: { type: [String], default: [] },
  styles: { type: [String], default: [] },
  
  media_type: {
    type: String,
    enum: ['vinyl'],
    default: 'vinyl'
  },
  format_type: { type: String, default: 'Vinyl' },
  variant_color: String,
  sleeve_condition: { type: String, default: '' },
  discogs_id: Number,
  country: { type: String, default: '' },
  tracklist: [{ position: String, title: String, duration: String }],
  estimated_price: {
    value:      { type: Number, default: null },
    currency:   { type: String, default: null },
    source:     { type: String, default: null },
    updated_at: { type: Date,   default: null },
    // 'ok' | 'rate_limited' | 'no_data' — lets the UI tell "never checked"
    // apart from "checked but Discogs throttled us" so a retry can target
    // just the latter instead of re-scanning the whole collection.
    status:     { type: String, default: null }
  }
});

const Vinyl = Item.discriminator('Music', vinylSchema);

module.exports = Vinyl;