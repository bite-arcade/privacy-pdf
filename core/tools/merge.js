'use strict';
/**
 * 多 PDF 合并引擎。
 * 页面搬运：copyPages 只复制页面对象、不重新编码，
 * 矢量文字、字体、链接、表单字段在合成后仍然保留。
 * 唯一的硬前提是所有输入都不能加密。
 */
const PDFMerger = {
    MAX_FILES: 20,
    MAX_TOTAL_BYTES: 200 * 1024 * 1024,

    validate(files) {
        if (!files || files.length < 2) return 'Select at least 2 PDF files.';
        if (files.length > this.MAX_FILES) return 'Up to ' + this.MAX_FILES + ' files at a time.';
        const total = files.reduce((s, f) => s + f.size, 0);
        if (total > this.MAX_TOTAL_BYTES) return 'Total size is over 200 MB. Merge in smaller batches.';
        return null;
    },

    async merge(files, onProgress, onFile) {
        if (typeof PDFLib === 'undefined') throw new Error('pdf-lib failed to load. Reload the page.');
        const out = await PDFLib.PDFDocument.create();
        let merged = 0;

        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            let src;
            try {
                const buf = await f.arrayBuffer();
                src = await PDFLib.PDFDocument.load(buf, { updateMetadata: false });
            } catch (e) {
                throw new Error('"' + f.name + '" could not be opened. Encrypted PDFs must be unlocked first.');
            }
            const indices = src.getPageIndices();
            const copied = await out.copyPages(src, indices);
            copied.forEach(p => out.addPage(p));
            merged += indices.length;
            if (onFile) onFile(i + 1, files.length, f.name, merged);
            if (onProgress) onProgress(Math.round((i + 1) / files.length * 92));
        }

        const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false });
        if (onProgress) onProgress(100);
        return { blob: new Blob([bytes], { type: 'application/pdf' }), pages: merged };
    }
};
window.PDFMerger = PDFMerger;
