// Sets pdf.js worker path. Loaded with defer, immediately after pdf.min.js,
// so the order that used to be guaranteed by synchronous scripts is preserved.
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/lib/pdf.worker.min.js';
} else {
    console.warn('Critical: pdfjs library load failed, image compression mode disabled');
}
