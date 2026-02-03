const worker = {
    async fetch(request) {
        const url = new URL(request.url);

        // proxy /tools path to Cloudflare Pages
        if (url.pathname.startsWith('/tools')) {
            // Assuming the Cloudflare Pages deployment is at innosage-tools.pages.dev
            const pagesUrl = `https://innosage-tools.pages.dev${url.pathname}${url.search}`;
            return fetch(pagesUrl, {
                headers: request.headers,
                method: request.method,
                body: request.body,
                redirect: 'manual'
            });
        }

        // fallback to Firebase Hosting
        // Assuming Firebase Hosting is at innosage-llc.web.app or similar
        const firebaseHost = 'https://innosage-llc.web.app';
        const firebaseUrl = `${firebaseHost}${url.pathname}${url.search}`;

        return fetch(firebaseUrl, {
            headers: request.headers,
            method: request.method,
            body: request.body,
            redirect: 'manual'
        });
    }
};

export default worker;
