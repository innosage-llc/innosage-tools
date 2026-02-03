"use client";

/**
 * Encapsulates the logic for opening a new window and printing the document.
 * Follows the high-fidelity strategy used in notion-editor.
 */
export const printDocument = (title: string, htmlContent: string) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Please allow popups to export PDF.');
        return;
    }

    const safeTitle = title || 'Document';

    // We define the styles here to ensure exact parity with the screen preview
    // and isolation from the app's UI elements.
    const styles = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>${safeTitle}</title>
            <style>
                /* System Fonts */
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    font-size: 11pt; 
                    line-height: 1.6; 
                    color: #18181b; /* zinc-900 */
                    margin: 0;
                    padding: 0;
                }

                /* A4 Positioning */
                .page {
                    width: 210mm;
                    margin: 0 auto;
                    padding: 20mm;
                    box-sizing: border-box;
                    background: white;
                }

                /* Typography (Manual Prose Implementation for Parity) */
                h1 { font-size: 2.25rem; font-weight: 800; margin-top: 0; margin-bottom: 0.88em; line-height: 1.1; letter-spacing: -0.025em; }
                h2 { font-size: 1.5rem; font-weight: 700; margin-top: 2em; margin-bottom: 1em; line-height: 1.33; }
                h3 { font-size: 1.25rem; font-weight: 600; margin-top: 1.6em; margin-bottom: 0.6em; line-height: 1.6; }
                p { margin-top: 1.25em; margin-bottom: 1.25em; }
                
                ul, ol { padding-left: 1.625em; margin-top: 1.25em; margin-bottom: 1.25em; }
                li { margin-top: 0.5em; margin-bottom: 0.5em; }
                
                blockquote { 
                    border-left: 0.25rem solid #e4e4e7; /* zinc-200 */
                    padding-left: 1rem;
                    color: #52525b; /* zinc-600 */
                    font-style: italic;
                    margin: 1.6em 0;
                }

                pre { 
                    background: #f4f4f5; /* zinc-100 */
                    padding: 1rem;
                    border-radius: 0.375rem;
                    overflow-x: auto;
                    font-size: 0.875em;
                }

                code { 
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
                    background: #f4f4f5;
                    padding: 0.2em 0.4em;
                    border-radius: 0.25rem;
                    font-size: 0.875em;
                }

                table { border-collapse: collapse; width: 100%; margin: 2em 0; }
                th, td { border: 1px solid #e4e4e7; padding: 0.75rem; text-align: left; }
                th { background-color: #f8fafc; font-weight: 600; }

                hr { border: 0; border-top: 1px solid #e4e4e7; margin: 3em 0; }

                img { max-width: 100%; height: auto; border-radius: 0.375rem; }

                /* Links */
                a { color: #2563eb; text-decoration: underline; text-underline-offset: 4px; }

                @media print {
                    body { background: white; }
                    .page { 
                        width: 100%; 
                        padding: 0; /* Let @page margins handle outer spacing */
                        margin: 0;
                    }
                    @page { 
                        size: A4;
                        margin: 20mm; 
                    }
                }
            </style>
        </head>
        <body>
            <div class="page">
                ${htmlContent}
            </div>
            <script>
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                        // window.close(); // Uncomment to auto-close after print
                    }, 250);
                }
            </script>
        </body>
        </html>
    `;

    printWindow.document.write(styles);
    printWindow.document.title = safeTitle;
    printWindow.document.close();
};
