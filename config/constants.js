module.exports = {
  STANDARD_FORMAT_TERMS: [
    'Vinyl', 'LP', 'Album', 'Reissue', 'Repress', 'Stereo', 'Gatefold',
    '12"', '7"', 'Limited Edition', 'Compilation', 'Deluxe Edition', 'Numbered', 'Promo'
  ],
  BOOK_GENRES_WHITELIST: [
    'Fiction', 'Non-Fiction', 'Fantasy', 'Sci-Fi', 'Science Fiction', 'Mystery',
    'Thriller', 'Horror', 'Historical', 'Romance', 'Comedy', 'Young Adult',
    'Children', 'Biography', 'Autobiography', 'Memoir', 'Poetry', 'Essay',
    'Self Help', 'Yuri', 'Slice of life', 'Adventure', 'Action', 'Drama', 'Crime',
    'LGBTQ', 'LGBTQIA', 'LGBTQIA+'
  ],
  BASE_URL: process.env.BASE_URL
    ? (process.env.BASE_URL.startsWith('/') ? process.env.BASE_URL : `/${process.env.BASE_URL}`)
    : '',
  TMDB_LANG_MAP: {
    fr: "fr-FR",
    en: "en-US",
    es: "es-ES",
    it: "it-IT",
    de: "de-DE"
  }
};
