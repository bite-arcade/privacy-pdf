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
        // 原始每页文本层字符数（1-based 索引）。报告要用它和输出后的数字对账。
        const srcCharsByPage = {};

        for (let i = 1; i <= pdf.numPages; i++) {
            if (!marked[i]) {
                // 未标记页会被原样复制，文本层一个字符都不动。
                // 这里仍然测一次原始字符数，是为了让报告的「Chars before」两列都是真实读数，
                // 而不是在被复制页上留一个「-」，被读者误当成「这页本来就没有文字」。
                const p0 = await pdf.getPage(i);
                const tc0 = await p0.getTextContent();
                let srcCharsCopy = 0;
                tc0.items.forEach(function (it) {
                    if (it.str) srcCharsCopy += it.str.trim().length;
                });
                srcCharsByPage[i] = srcCharsCopy;
                const [p] = await out.copyPages(originals, [i - 1]);
                out.addPage(p);
                copied++;
            } else {
                const page = await pdf.getPage(i);
                const base = page.getViewport({ scale: 1 });

                // 光栅化前先确认这一页原本有没有文本层。没有的话，
                // 导出后的「0 个可提取字符」并不构成任何清理证据。
                const tc = await page.getTextContent();
                let srcChars = 0;
                tc.items.forEach(function (it) {
                    if (it.str) srcChars += it.str.trim().length;
                });
                srcCharsByPage[i] = srcChars;
                const hadText = srcChars > 0;
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
            rasteredWithText: rasteredWithText,
            srcCharsByPage: srcCharsByPage
        };
    },

    /** 打开刚生成的输出，统计还能提取到多少字符。perPage 逐页给出，便于用户自己核对。 */
    async verify(blob) {
        const buf = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        let chars = 0;
        let pagesWithText = 0;
        const perPage = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            let pageChars = 0;
            for (const item of tc.items) {
                if (item.str) pageChars += item.str.trim().length;
            }
            if (pageChars > 0) pagesWithText++;
            chars += pageChars;
            perPage.push(pageChars);
            page.cleanup();
        }
        return { chars: chars, pagesWithText: pagesWithText, pageCount: pdf.numPages, perPage: perPage };
    },

    /**
     * 生成脱敏报告 PDF（单页或多页，A4）。
     * 报告只写本次真实测到的数字，没测到的写 "not measured"，不推断、不补值。
     */
    async buildReport(data) {
        const PAGE_W = 595.28;
        const PAGE_H = 841.89;
        const M = 48;
        const BODY = 9.5;
        const doc = await PDFLib.PDFDocument.create();
        const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);

        // pdf-lib 的内置字体只有 WinAnsi，非 ASCII 会抛错。文件名可能含中文。
        // 少数排版符号先映射成 ASCII 近形，剩下的才退化成 ?
        const REPL = {
            '\u00b7': '|', '\u2014': '-', '\u2013': '-', '\u2192': '->',
            '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2026': '...'
        };
        const safe = function (v) {
            var s = String(v === null || v === undefined ? '' : v);
            s = s.replace(/[\u00b7\u2014\u2013\u2192\u2019\u201c\u201d\u2026]/g, function (c) {
                return REPL[c];
            });
            return s.replace(/[^\x20-\x7E]/g, '?');
        };

        let page = doc.addPage([PAGE_W, PAGE_H]);
        let y = PAGE_H - M;

        const ink = PDFLib.rgb(0.13, 0.15, 0.18);
        const grey = PDFLib.rgb(0.45, 0.48, 0.52);
        const blue = PDFLib.rgb(0.145, 0.388, 0.922);
        const red = PDFLib.rgb(0.72, 0.15, 0.15);
        const green = PDFLib.rgb(0.09, 0.45, 0.24);
        const lineCol = PDFLib.rgb(0.85, 0.87, 0.90);

        const ensure = function (need) {
            if (y - need < M) {
                page = doc.addPage([PAGE_W, PAGE_H]);
                y = PAGE_H - M;
                page.drawText(safe('Redaction Report (continued)'), { x: M, y: y, size: 9, font: bold, color: grey });
                y -= 22;
            }
        };

        const wrapLines = function (str, maxW, size, f) {
            const words = safe(str).split(' ');
            const out = [];
            let cur = '';
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                const cand = cur ? cur + ' ' + w : w;
                if (f.widthOfTextAtSize(cand, size) <= maxW || !cur) {
                    cur = cand;
                } else {
                    out.push(cur);
                    cur = w;
                }
            }
            if (cur) out.push(cur);
            return out.length ? out : [''];
        };

        const text = function (str, opts) {
            opts = opts || {};
            const size = opts.size || BODY;
            const f = opts.bold ? bold : font;
            const x = opts.x === undefined ? M : opts.x;
            const maxW = opts.maxW || (PAGE_W - M - x);
            const lines = wrapLines(str, maxW, size, f);
            const hanging = /^- /.test(safe(str));
            lines.forEach(function (ln, idx) {
                ensure(size + 4);
                page.drawText(safe(idx > 0 && hanging ? '  ' + ln : ln), {
                    x: x, y: y, size: size, font: f, color: opts.color || ink
                });
                y -= idx === lines.length - 1
                    ? (opts.gap === undefined ? size + 5 : opts.gap)
                    : size + 2;
            });
        };

        const sectionHead = function (str) {
            ensure(26);
            y -= 6;
            page.drawText(safe(str), { x: M, y: y, size: 11, font: bold, color: ink });
            y -= 6;
            page.drawLine({
                start: { x: M, y: y }, end: { x: PAGE_W - M, y: y },
                thickness: 0.7, color: lineCol
            });
            y -= 14;
        };

        // ---------- 头部 ----------
        page.drawText(safe('Redaction Report'), { x: M, y: y - 4, size: 22, font: bold, color: ink });
        y -= 32;
        page.drawText(safe('Generated by PrivacyPDF  |  privacypdf.org/redact-pdf'), { x: M, y: y, size: 9, font: font, color: grey });
        y -= 13;
        page.drawText(safe('Generated at: ' + data.generatedAt), { x: M, y: y, size: 9, font: font, color: grey });
        y -= 20;
        page.drawLine({ start: { x: M, y: y }, end: { x: PAGE_W - M, y: y }, thickness: 1.2, color: blue });
        y -= 18;

        // ---------- 输入文件 ----------
        sectionHead('1. File');
        text('Name:   ' + safe(data.fileName), { gap: 14 });
        text('Size:   ' + (data.fileSizeBefore / 1024).toFixed(0) + ' KB in, ' + (data.fileSizeAfter / 1024).toFixed(0) + ' KB out', { gap: 14 });
        text('Pages:  ' + data.pageCount, { gap: 14 });

        // ---------- 做了什么 ----------
        sectionHead('2. What was done');
        text('Pages rebuilt as images (text layer destroyed): ' + data.rastered, { gap: 13 });
        text('Pages copied unchanged (text layer intact):        ' + data.copied, { gap: 13 });
        var pagesStr = data.markedPages.length
            ? '  (page' + (data.markedPages.length === 1 ? ' ' : 's ') + data.markedPages.join(', ') + ')'
            : '';
        text('Pages where at least one rectangle was drawn:      ' + data.markedPages.length + pagesStr, { gap: 13 });
        if (data.rastered > 0) {
            text('A rebuilt page is a JPEG. Nothing on it can be selected, searched or extracted - including text that was not inside a box.', { size: 8.5, color: grey, gap: 12 });
        }

        // ---------- 逐页核对（核心） ----------
        sectionHead('3. Page-by-page check');
        text('The output file was opened again and its text layer was read page by page. The After column is what a reader could still copy out of that page.', { size: 8.5, color: grey, gap: 12 });

        const headers = ['Page', 'Chars before', 'Boxes', 'In boxes', 'After', 'Status'];
        // 固定列锚点：右对齐列锚右边界，左对齐列锚左边界，表头与数字因此落在同一位置
        const COLS = [
            { x: 48, align: 'left' },
            { x: 190, align: 'right' },
            { x: 262, align: 'right' },
            { x: 356, align: 'right' },
            { x: 442, align: 'right' },
            { x: 458, align: 'left' }
        ];

        const drawRow = function (vals, isHead, color) {
            ensure(14);
            for (let i = 0; i < vals.length; i++) {
                const s = safe(String(vals[i]));
                const spec = COLS[i];
                const f = isHead ? bold : font;
                const px = spec.align === 'right'
                    ? spec.x - f.widthOfTextAtSize(s, 8.5)
                    : spec.x;
                page.drawText(s, {
                    x: px, y: y, size: 8.5,
                    font: f,
                    color: color || (isHead ? grey : ink)
                });
            }
            y -= 12;
        };

        drawRow(headers, true);
        ensure(14);
        page.drawLine({ start: { x: M, y: y + 3 }, end: { x: PAGE_W - M, y: y + 3 }, thickness: 0.5, color: lineCol });
        y -= 6;

        const rows = [];
        for (let i = 1; i <= data.pageCount; i++) {
            const marked = data.markedPages.indexOf(i) !== -1;
            const before = data.srcCharsByPage && data.srcCharsByPage[i] !== undefined ? data.srcCharsByPage[i] : null;
            const after = data.verify && data.verify.perPage ? data.verify.perPage[i - 1] : null;
            const boxCount = data.analysis ? data.analysis.boxes.filter(function (b) { return b.page === i; }).length : null;
            const boxChars = data.analysis ? data.analysis.boxes
                .filter(function (b) { return b.page === i; })
                .reduce(function (n, b) { return n + b.chars; }, 0) : null;

            let status;
            let color;
            if (!marked) {
                status = 'copied';
                color = grey;
            } else if (before === 0) {
                status = 'no text layer';
                color = grey;
            } else if (after === 0) {
                status = 'cleared';
                color = green;
            } else if (after === null) {
                status = 'not measured';
                color = grey;
            } else {
                status = 'STILL READABLE';
                color = red;
            }

            rows.push({
                page: String(i),
                before: before === null ? '-' : String(before),
                boxes: boxCount === null ? '-' : String(boxCount),
                boxChars: boxChars === null ? '-' : String(boxChars),
                after: after === null ? '-' : String(after),
                status: status,
                color: color
            });
        }

        rows.forEach(function (r) {
            drawRow([r.page, r.before, r.boxes, r.boxChars, r.after, r.status], false, r.color);
        });

        // ---------- 合计 ----------
        y -= 4;
        sectionHead('4. Totals');
        var totalBeforeMarked = 0, totalAfterAll = 0, totalBoxChars = 0, clearedPages = 0, scanPages = 0, failedPages = 0;
        data.markedPages.forEach(function (p) {
            var b = data.srcCharsByPage ? data.srcCharsByPage[p] : null;
            if (b) totalBeforeMarked += b;
            var a = data.verify && data.verify.perPage ? data.verify.perPage[p - 1] : null;
            if (b === 0) scanPages++;
            else if (a === 0) clearedPages++;
            else if (a !== null && a > 0) failedPages++;
        });
        if (data.analysis) totalBoxChars = data.analysis.totalChars;
        if (data.verify) totalAfterAll = data.verify.chars;

        text('Characters on marked pages before: ' + totalBeforeMarked, { gap: 13 });
        text('Characters inside drawn boxes:      ' + (data.analysis ? totalBoxChars : 'not measured'), { gap: 13 });
        text('Characters extractable afterwards:  ' + (data.verify ? totalAfterAll : 'not measured') +
             ' (whole file, all ' + data.pageCount + ' pages)', { gap: 13 });
        text('Marked pages with a text layer that is now empty: ' + clearedPages + ' of ' + (data.markedPages.length - scanPages) + ' measurable', { gap: 13 });

        // ---------- 结论 ----------
        y -= 6;
        var verdict, verdictColor, verdictNote;
        if (failedPages > 0) {
            verdict = 'NOT REDACTED';
            verdictColor = red;
            verdictNote = failedPages + ' marked page(s) still hand back extractable text. The file went through the tool, but it is not redacted. Treat it like the original.';
        } else if (clearedPages > 0) {
            verdict = 'CLEARED';
            verdictColor = green;
            verdictNote = 'Every marked page that had a text layer before now returns 0 extractable characters.';
        } else if (scanPages > 0) {
            verdict = 'NOTHING TO MEASURE';
            verdictColor = grey;
            verdictNote = 'These marked pages never had a text layer. The 0 is the absence of a result, not a clean result. Mark the right page, or use a file that carries text.';
        } else {
            verdict = 'NOT MEASURED';
            verdictColor = grey;
            verdictNote = 'No page-by-page check ran for the marked pages. The 0s below are not evidence of anything.';
        }

        ensure(78);
        page.drawRectangle({
            x: M, y: y - 50, width: PAGE_W - M * 2, height: 58,
            color: PDFLib.rgb(0.972, 0.978, 0.984), borderColor: lineCol, borderWidth: 0.7
        });
        page.drawText(safe('VERDICT: ' + verdict), { x: M + 12, y: y - 8, size: 12, font: bold, color: verdictColor });
        page.drawText(safe(verdictNote), { x: M + 12, y: y - 25, size: 8.5, font: font, color: ink, maxWidth: PAGE_W - M * 2 - 24, lineHeight: 11 });
        y -= 68;

        // ---------- 三种「没通过」的原因 ----------
        sectionHead('5. Three ways this fails, and how to tell them apart');
        text('A page can come back empty for several different reasons, and the numbers above are what tells them apart:', { size: 8.5, color: grey, gap: 12 });
        text('- The page never had a text layer (a scan). 0 is not evidence of removal; nothing was there to remove.', { size: 8.5, gap: 11 });
        text('- A rectangle was drawn on empty space, or too small to cover the words. Chars in boxes is 0 while Chars before is not.', { size: 8.5, gap: 11 });
        text('- The rectangle covered the words but the page was copied rather than rebuilt. Status reads copied.', { size: 8.5, gap: 11 });
        text('- If Status reads STILL READABLE, the page was rebuilt and text is still extractable. That is a failure, not a pass.', { size: 8.5, gap: 11 });

        // ---------- 边界 ----------
        sectionHead('6. What this report does not cover');
        text('- It reports the text layer only. Text living in annotations, form fields, attachments or the XMP metadata block is a separate channel and is not counted here.', { size: 8.5, gap: 11 });
        text('- It is a measurement, not a legal opinion. It does not certify compliance with HIPAA, FOIA, GDPR or any evidentiary standard, and it is not a substitute for a compliance review.', { size: 8.5, gap: 11 });
        text('- It describes this one file after this one operation. Editing the file again invalidates these numbers.', { size: 8.5, gap: 11 });

        y -= 6;
        ensure(30);
        page.drawLine({ start: { x: M, y: y }, end: { x: PAGE_W - M, y: y }, thickness: 0.7, color: lineCol });
        y -= 14;
        page.drawText(safe('This report was generated on your device. The PDF was opened, rebuilt and measured by the browser; no copy was uploaded.'), { x: M, y: y, size: 8.5, font: font, color: grey });
        y -= 11;
        page.drawText(safe('PrivacyPDF  |  privacypdf.org  |  felix@hearthveilpress.com'), { x: M, y: y, size: 8.5, font: font, color: grey });

        var bytes = await doc.save();
        return new Blob([bytes], { type: 'application/pdf' });
    }
};
window.PDFRedactor = PDFRedactor;
