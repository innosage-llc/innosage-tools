const worker = {
    async fetch(request) {
        const url = new URL(request.url);

        // proxy /tools path to Cloudflare Pages
        if (url.pathname.startsWith('/tools')) {
            // Strip the '/tools' prefix when proxying to Cloudflare Pages 
            // because the build output sits at the root of the Pages domain.
            const proxiedPath = url.pathname.replace('/tools', '');
            const pagesUrl = `https://innosage-tools.pages.dev${proxiedPath}${url.search}`;

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
