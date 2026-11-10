'use strict';
/**
 * 元数据读取与清除。两条通道分开处理：
 *  - Info 字典（Title / Author / Subject / Keywords / Creator / Producer / 日期）
 *  - XMP 包（catalog 里的 /Metadata 流），常见作者、软件、时间戳都藏在这里
 * 现有压缩引擎只清了 Info 字典，XMP 原样保留。这个模块把两条都清掉，并在清除前把字段列给用户看。
 */
const PDFMetadata = {
    MAX_FILE_SIZE: 100 * 1024 * 1024,

    _info(doc) {
        const pick = (fn) => {
            try { const v = doc[fn](); return v === undefined || v === null ? null : v; }
            catch (e) { return null; }
        };
        // 日期统一成 UTC ISO。直接用 Date 对象会被页面按本地时区渲染成
        // "GMT+0800 (中国标准时间)" 这种中文本地化串，英文站点上不该出现。
        const pickDate = (fn) => {
            const v = pick(fn);
            if (!(v instanceof Date)) return v;
            const t = v.getTime();
            return isNaN(t) ? null : v.toISOString();
        };
        return {
            Title: pick('getTitle'),
            Author: pick('getAuthor'),
            Subject: pick('getSubject'),
            Keywords: pick('getKeywords'),
            Creator: pick('getCreator'),
            Producer: pick('getProducer'),
            CreationDate: pickDate('getCreationDate'),
            ModificationDate: pickDate('getModificationDate')
        };
    },

    _xmp(doc) {
        const PDFName = PDFLib.PDFName;
        const ref = doc.catalog.get(PDFName.of('Metadata'));
        if (!ref) return { present: false, raw: null, compressed: false, fields: [] };

        let stream;
        try { stream = doc.context.lookup(ref); } catch (e) { return { present: true, raw: null, compressed: true, fields: [] }; }
        if (!stream || !stream.contents) return { present: true, raw: null, compressed: true, fields: [] };

        const filter = stream.dict && stream.dict.get && stream.dict.get(PDFName.of('Filter'));
        const filtered = !!filter;

        let text = null;
        if (!filtered) {
            try { text = new TextDecoder('utf-8').decode(stream.contents); } catch (e) { text = null; }
        }

        return {
            present: true,
            raw: text,
            compressed: filtered,
            byteLength: stream.contents.length,
            fields: text ? this._parseXmp(text) : []
        };
    },

    _parseXmp(text) {
        const fields = [];
        const re = /<([A-Za-z][A-Za-z0-9_.-]*:[A-Za-z][A-Za-z0-9_.-]*)\b[^>]*>([^<]{1,300})<\/\1>/g;
        const PARENTS = ['dc:creator', 'dc:title', 'dc:subject', 'dc:description', 'pdf:Keywords'];
        let m;
        const seen = {};
        while ((m = re.exec(text)) !== null) {
            const key = m[1];
            const value = m[2].trim();
            if (!value) continue;
            if (/^(rdf|xmlns)/i.test(key) && key !== 'rdf:li' && key !== 'rdf:value') continue;

            let label = key;
            if (key === 'rdf:li' || key === 'rdf:value') {
                // 嵌在 dc:creator / dc:title 这类容器里的值，用容器名做标签更好读
                let best = null;
                let bestPos = -1;
                PARENTS.forEach(function (p) {
                    const pos = text.lastIndexOf('<' + p, m.index);
                    if (pos > bestPos) { bestPos = pos; best = p; }
                });
                label = best ? best + ' (item)' : key;
            }

            const id = label + '|' + value;
            if (seen[id]) continue;
            seen[id] = true;
            fields.push({ key: label, value: value });
        }
        return fields;
    },

    async inspect(file) {
        if (file.size > this.MAX_FILE_SIZE) throw new Error('File is over 100 MB.');
        const buf = await file.arrayBuffer();
        const doc = await PDFLib.PDFDocument.load(buf, { updateMetadata: false });
        const info = this._info(doc);
        const xmp = this._xmp(doc);
        return {
            info: info,
            xmp: xmp,
            pageCount: doc.getPageCount()
        };
    },

    /** 清掉 Info 字典字段与整个 XMP 包 */
    async strip(file) {
        if (file.size > this.MAX_FILE_SIZE) throw new Error('File is over 100 MB.');
        const buf = await file.arrayBuffer();
        const doc = await PDFLib.PDFDocument.load(buf, { updateMetadata: false });
        const PDFName = PDFLib.PDFName;

        doc.setTitle('');
        doc.setAuthor('');
        doc.setSubject('');
        doc.setKeywords([]);
        doc.setCreator('');
        doc.setProducer('');

        // 日期不覆盖成 1970（那只是留了个假值），直接从 Info 字典删键
        try {
            const infoRef = doc.context.trailerInfo && doc.context.trailerInfo.Info;
            if (infoRef) {
                const info = doc.context.lookup(infoRef);
                if (info && typeof info.delete === 'function') {
                    ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'].forEach(function (k) {
                        try { info.delete(PDFName.of(k)); } catch (e) { /* 键不存在 */ }
                    });
                }
            }
        } catch (e) { /* 结构异常时保留 setter 的结果 */ }

        // 只删 catalog 里的 /Metadata 引用是不够的。PDFContext 里那条 stream 对象仍然注册着，
        // save() 会把没被引用的对象一并写回文件，于是 XMP 原文照样留在字节里 ——
        // 引用没了、数据还在，任何能扫全部对象的解析器或 strings 都能读出来。
        // 必须把引用和对象本体一起删掉。
        const xmpRef = doc.catalog.get(PDFName.of('Metadata'));
        if (xmpRef) {
            try { doc.catalog.delete(PDFName.of('Metadata')); } catch (e) { /* ignore */ }
            try {
                if (typeof doc.context.delete === 'function') doc.context.delete(xmpRef);
            } catch (e) { /* ignore */ }
        }

        const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
        return { blob: new Blob([bytes], { type: 'application/pdf' }), bytes: bytes };
    },

    /** 打开输出，确认字段确实没了 */
    async verify(blob) {
        const buf = await blob.arrayBuffer();
        const doc = await PDFLib.PDFDocument.load(buf, { updateMetadata: false });
        const info = this._info(doc);
        const xmp = this._xmp(doc);
        const remaining = [];
        Object.keys(info).forEach(function (k) {
            const v = info[k];
            if (v === null || v === undefined || v === '') return;
            if (k === 'CreationDate' || k === 'ModificationDate') {
                const d = new Date(v);
                if (!isNaN(d.getTime()) && d.getFullYear() <= 1970) return;
            }
            if (Array.isArray(v) && v.length === 0) return;
            remaining.push(k + ': ' + v);
        });
        // catalog 里没有 /Metadata 不代表文件里就没有 XMP 数据。
        // 枚举所有间接对象，把已经没有引用、内容却仍是 XMP 的残留流找出来。
        // 压缩过的流也要解一次再看，否则压缩残留会漏过去 —— 那正是最容易骗过自己的情况。
        let orphanXmp = 0;
        let unscanned = 0;
        try {
            const pairs = doc.context.enumerateIndirectObjects();
            for (let i = 0; i < pairs.length; i++) {
                const obj = pairs[i][1];
                const content = obj && obj.contents;
                if (!content || !content.length) continue;
                if (content.length > 5 * 1024 * 1024) { unscanned++; continue; }
                let text = null;
                try { text = await this._streamText(obj); } catch (e) { text = null; }
                if (text === null) { unscanned++; continue; }
                if (text.indexOf('x:xmpmeta') !== -1 || text.indexOf('xpacket begin') !== -1) orphanXmp++;
            }
        } catch (e) { /* 结构异常时这一项不可用 */ }

        if (xmp.present) remaining.push('XMP packet still present');
        if (orphanXmp > 0) remaining.push(orphanXmp + ' orphan XMP stream(s) still in the file');
        return { remaining: remaining, hasXmp: xmp.present, orphanXmp: orphanXmp, unscanned: unscanned, pageCount: doc.getPageCount() };
    },

    /** 把一个 stream 还原成可读文本；解不开返回 null */
    async _streamText(obj) {
        const content = obj && obj.contents;
        if (!content || !content.length) return null;

        let text = null;
        try { text = new TextDecoder('utf-8').decode(content); } catch (e) { text = null; }
        // 未压缩的流直接就读到了
        if (text && (text.indexOf('x:xmpmeta') !== -1 || text.indexOf('xpacket begin') !== -1)) return text;

        const dict = obj.dict;
        const filter = dict && dict.get && dict.get(PDFLib.PDFName.of('Filter'));
        if (!filter || typeof DecompressionStream === 'undefined') return text;

        // PDF 的 FlateDecode 是 zlib 包装；少数产出方写的是裸 deflate，两种都试
        for (let i = 0; i < 2; i++) {
            const fmt = i === 0 ? 'deflate' : 'deflate-raw';
            try {
                const inflated = await new Response(
                    new Blob([content]).stream().pipeThrough(new DecompressionStream(fmt))
                ).arrayBuffer();
                const out = new TextDecoder('utf-8').decode(inflated);
                if (out) return out;
            } catch (e) { /* 换下一种格式 */ }
        }
        return text;
    }
};
window.PDFMetadata = PDFMetadata;
