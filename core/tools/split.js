'use strict';
/**
 * PDF 拆分引擎。三种模式共用 copyPages，不重新编码。
 *   each   —— 每页一个文件
 *   every  —— 每 N 页一段
 *   ranges —— 按 "1-3, 5, 8-10" 切段
 */
const PDFSplitter = {
    MAX_FILE_SIZE: 100 * 1024 * 1024,

    async split(file, opts, onProgress) {
        if (typeof PDFLib === 'undefined') throw new Error('pdf-lib failed to load. Reload the page.');
        if (file.size > this.MAX_FILE_SIZE) throw new Error('File is over 100 MB. Split it on your desktop first.');

        const buf = await file.arrayBuffer();
        let src;
        try {
            src = await PDFLib.PDFDocument.load(buf, { updateMetadata: false });
        } catch (e) {
            throw new Error('This PDF could not be opened. Encrypted PDFs must be unlocked first.');
        }

        const total = src.getPageCount();
        const segments = this._plan(total, opts || {});
        if (segments.length === 0) throw new Error('No valid page range matched. Check the format, e.g. 1-3, 5, 8-10.');
        if (segments.length > 50) throw new Error('That would create ' + segments.length + ' files. Narrow the range.');

        const results = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const out = await PDFLib.PDFDocument.create();
            const copied = await out.copyPages(src, seg.pages);
            copied.forEach(p => out.addPage(p));
            const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false });
            results.push({
                blob: new Blob([bytes], { type: 'application/pdf' }),
                label: seg.label,
                pages: seg.pages.length
            });
            if (onProgress) onProgress(Math.round((i + 1) / segments.length * 100));
        }
        return { parts: results, totalPages: total };
    },

    _plan(total, opts) {
        const mode = opts.mode || 'every';
        const result = [];

        if (mode === 'each') {
            if (total > 50) return [];
            for (let i = 0; i < total; i++) {
                result.push({ pages: [i], label: 'page-' + String(i + 1).padStart(2, '0') });
            }
            return result;
        }

        if (mode === 'ranges') {
            const spec = String(opts.ranges || '').split(',').map(s => s.trim()).filter(Boolean);
            spec.forEach((piece, idx) => {
                const m = piece.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
                if (!m) return;
                const a = parseInt(m[1], 10);
                const b = m[2] ? parseInt(m[2], 10) : a;
                const list = [];
                for (let p = Math.min(a, b); p <= Math.max(a, b); p++) {
                    if (p >= 1 && p <= total) list.push(p - 1);
                }
                if (list.length) result.push({ pages: list, label: 'part-' + (idx + 1) });
            });
            return result;
        }

        const n = Math.max(1, parseInt(opts.every || 5, 10));
        let start = 0, part = 1;
        while (start < total) {
            const end = Math.min(start + n, total);
            const list = [];
            for (let i = start; i < end; i++) list.push(i);
            result.push({ pages: list, label: 'part-' + part });
            start = end;
            part++;
        }
        return result;
    }
};
window.PDFSplitter = PDFSplitter;
