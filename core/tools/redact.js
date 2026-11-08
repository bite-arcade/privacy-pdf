'use strict';
/**
 * Redaction 引擎。两条路径：
 * 1) analyze —— 用 pdf.js 的文本层，算出每个框里还有多少可复制字符。导出前就能看。
 * 2) redact  —— 把被标记的页面整页光栅化，文字层随之消失；未标记的页原样复制。
 * 光栅化的代价是整页不可搜索、不可复制，这个代价必须在界面上讲明，不藏在脚注里。
 */
const PDFRedactor = {
    MAX_FILE_SIZE: 100 * 1024 * 1024,
    MAX_PAGES: 50,
    RENDER_SCALE: 2,        // 2 ≈ 144 DPI
    JPEG_QUALITY: 0.9,

    _load(file) {
        return file.arrayBuffer().then(buf => pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise);
    },

    /** 统计每个框内仍可被复制/提取的字符数 */
    async analyze(file, boxes) {
        const pdf = await this._load(file);
        if (pdf.numPages > this.MAX_PAGES) {
            throw new Error('This PDF has ' + pdf.numPages + ' pages. The limit is ' + this.MAX_PAGES + '.');
        }

        const byPage = {};
        boxes.forEach(b => {
            if (!byPage[b.page]) byPage[b.page] = [];
            byPage[b.page].push(b);
        });

        const results = [];
        let total = 0;
        const pageText = {};

        for (const pageNum of Object.keys(byPage)) {
            const page = await pdf.getPage(parseInt(pageNum, 10));
            const vp = page.getViewport({ scale: 1 });
            const tc = await page.getTextContent();
            const list = byPage[pageNum];

            // 这一页整页有多少个可提取字符。用来区分「框里是 0」和
            // 「这页根本没有文本层（扫描件）」——两者的安全含义完全相反。
            const pageChars = tc.items.reduce(function (n, it) {
                return n + (it.str ? it.str.trim().length : 0);
            }, 0);
            pageText[pageNum] = pageChars;

            for (let bi = 0; bi < list.length; bi++) {
                const box = list[bi];
                const bx = box.x * vp.width;
                const by = box.y * vp.height;
                const bw = box.w * vp.width;
                const bh = box.h * vp.height;

                let count = 0;
                let chars = 0;
                const found = [];

                for (const item of tc.items) {
                    if (!item.str || !item.str.trim()) continue;
                    const t = pdfjsLib.Util.transform(vp.transform, item.transform);
                    const h = item.height || 10;
                    const w = item.width || 0;
                    const x = t[4];
                    const yTop = t[5] - h;

                    // 矩形相交
                    if (x < bx + bw && x + w > bx && yTop < by + bh && yTop + h > by) {
                        count++;
                        chars += item.str.length;
                        if (found.length < 4 && item.str.trim().length > 1) {
                            found.push(item.str.trim().slice(0, 48));
                        }
                    }
                }

                total += chars;
                results.push({
                    page: parseInt(pageNum, 10),
                    boxIndex: bi,
                    items: count,
                    chars: chars,
                    samples: found,
                    pageTextChars: pageChars
                });
            }
            page.cleanup();
        }

        return {
            boxes: results,
            totalChars: total,
            pageCount: pdf.numPages,
            pageText: pageText,
            noTextPages: Object.keys(pageText).filter(function (k) {
                return pageText[k] === 0;
            }).map(function (k) { return parseInt(k, 10); })
        };
    },

    /** 对包含框的页面光栅化，其余页面原样复制 */
    async redact(file, boxes, onProgress) {
        const pdf = await this._load(file);
        if (pdf.numPages > this.MAX_PAGES) {
            throw new Error('This PDF has ' + pdf.numPages + ' pages. The limit is ' + this.MAX_PAGES + '.');
        }

        const marked = {};
        boxes.forEach(b => { marked[b.page] = true; });

        const out = await PDFLib.PDFDocument.create();
        const originals = await PDFLib.PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
        let rastered = 0;
        let copied = 0;
        let rasteredWithText = 0;

        for (let i = 1; i <= pdf.numPages; i++) {
            if (!marked[i]) {
                const [p] = await out.copyPages(originals, [i - 1]);
                out.addPage(p);
                copied++;
            } else {
                const page = await pdf.getPage(i);
                const base = page.getViewport({ scale: 1 });

                // 光栅化前先确认这一页原本有没有文本层。没有的话，
                // 导出后的「0 个可提取字符」并不构成任何清理证据。
                const tc = await page.getTextContent();
                const hadText = tc.items.some(function (it) {
                    return it.str && it.str.trim().length > 0;
                });
                if (hadText) rasteredWithText++;
                const vp = page.getViewport({ scale: this.RENDER_SCALE });
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(vp.width);
                canvas.height = Math.round(vp.height);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvasContext: ctx, viewport: vp }).promise;

                // 把每个框映射到本页 canvas 上并填黑
                const pageBoxes = boxes.filter(b => b.page === i);
                ctx.fillStyle = '#000000';
                pageBoxes.forEach(b => {
                    ctx.fillRect(
                        Math.round(b.x * canvas.width),
                        Math.round(b.y * canvas.height),
                        Math.max(1, Math.round(b.w * canvas.width)),
                        Math.max(1, Math.round(b.h * canvas.height))
                    );
                });

                const blob = await new Promise((resolve, reject) => {
                    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Page ' + i + ' could not be encoded.')),
                        'image/jpeg', this.JPEG_QUALITY);
                });
                canvas.width = 0;
                canvas.height = 0;

                const bytes = new Uint8Array(await blob.arrayBuffer());
                const img = await out.embedJpg(bytes);
                const newPage = out.addPage([base.width, base.height]);
                newPage.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });

                page.cleanup();
                rastered++;
            }
            if (onProgress) onProgress(Math.round(i / pdf.numPages * 100));
        }

        const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false });
        return {
            bytes: bytes,
            blob: new Blob([bytes], { type: 'application/pdf' }),
            rastered: rastered,
            copied: copied,
            pageCount: pdf.numPages,
            rasteredWithText: rasteredWithText
        };
    },

    /** 打开刚生成的输出，统计还能提取到多少字符 */
    async verify(blob) {
        const buf = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        let chars = 0;
        let pagesWithText = 0;
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            let pageChars = 0;
            for (const item of tc.items) {
                if (item.str) pageChars += item.str.trim().length;
            }
            if (pageChars > 0) pagesWithText++;
            chars += pageChars;
            page.cleanup();
        }
        return { chars: chars, pagesWithText: pagesWithText, pageCount: pdf.numPages };
    }
};
window.PDFRedactor = PDFRedactor;
