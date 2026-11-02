// Preloaded into the app under test: answers calls to Discogs and the exchange
// rate API, so the tests need no network and always see the same data.
const axios = require('axios');

const release = (id, title, artist) => ({
    basic_information: {
        id,
        title,
        artists: [{ name: artist }],
        year: 2000,
        labels: [{ name: 'Label', catno: 'CAT' }],
        formats: [{ name: 'Vinyl' }],
        genres: ['Rock'],
        styles: []
    }
});

const realGet = axios.get.bind(axios);
axios.get = (url, config) => {
    if (url.includes('api.frankfurter.dev')) {
        if (config.params.base === 'USD') return Promise.resolve({ data: { rates: { EUR: 0.5 } } });
        return Promise.reject(new Error('unknown currency'));
    }
    if (url.includes('/users/mockuser/collection')) {
        const releases = config.params.page === 1
            ? [release(5001, 'Twin', 'X'), release(5002, 'Idless Match', 'Y'), release(5003, 'Other Pressing', 'Z')]
            : [release(5001, 'Twin', 'X')];
        return Promise.resolve({ data: { releases, pagination: { items: 4, pages: 2 } } });
    }
    return realGet(url, config);
};

const realFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
    if (String(url).includes('api.discogs.com/marketplace/stats/')) {
        return Promise.resolve(new Response(JSON.stringify({
            num_for_sale: 3,
            lowest_price: { value: 12, currency: 'EUR' }
        }), { status: 200 }));
    }
    return realFetch(url, options);
};
