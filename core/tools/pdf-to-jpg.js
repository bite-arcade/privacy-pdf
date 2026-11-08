'use strict';
/**
 * PDF 转图片引擎。基于 pdf.js 渲染，输出整页位图。
 * 注意：这是光栅化，输出没有文字层——不能复制、不能搜索。
 * 页面上必须写清这一点，不要包装成"高质量转换"。
 */
const PDFToImage = {
    MAX_FILE_SIZE: 100 * 1024 * 1024,
    MAX_PAGES: 100,

    async convert(file, opts, onProgress) {
        if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js failed to load. Reload the page.');
        if (file.size > this.MAX_FILE_SIZE) throw new Error('File is over 100 MB. Convert it in smaller parts.');

        const o = opts || {};
        const scale = o.scale || 2;          // 2 ≈ 144 DPI, 3 ≈ 216 DPI
        const quality = o.quality || 0.92;
        const format = o.format === 'png' ? 'image/png' : 'image/jpeg';

        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        if (pdf.numPages > this.MAX_PAGES) {
            throw new Error('This PDF has ' + pdf.numPages + ' pages. The limit is ' + this.MAX_PAGES + '.');
        }

        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(vp.width);
            canvas.height = Math.round(vp.height);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;

            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('Page ' + i + ' could not be encoded.')),
                    format, format === 'image/png' ? undefined : quality);
            });
            const w = canvas.width, h = canvas.height;
            canvas.width = 0;
            canvas.height = 0;

            pages.push({
                blob: blob,
                label: 'page-' + String(i).padStart(2, '0'),
                width: w,
                height: h
            });

            page.cleanup();
            if (onProgress) onProgress(Math.round(i / pdf.numPages * 100));
        }
        return { pages: pages, totalPages: pdf.numPages, format: format };
    }
};
window.PDFToImage = PDFToImage;
