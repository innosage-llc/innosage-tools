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
        // 2. Fallback to Firebase Hosting (Landing Page)
        const firebaseHost = 'https://gen-lang-client-0078708184.web.app';
        const firebaseUrl = `${firebaseHost}${url.pathname}${url.search}`;
        // Clone headers and remove 'host' so fetch automatically sets the correct one
        const headers = new Headers(request.headers);
        headers.delete('host');
        return fetch(firebaseUrl, {
            headers,
            method: request.method,
            body: request.body,
            redirect: 'manual'
        });
    }
};
export default worker;
