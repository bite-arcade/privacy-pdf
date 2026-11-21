'use strict';
/**
 * Read-only PDF metadata checker. Seven checks:
 *   1 Info dictionary (read the way a viewer reads the last revision, via pdf.js)
 *   2 Info values in the bytes that differ from the ones a viewer shows
 *   3 XMP packet referenced by the catalog
 *   4 XMP left behind as an unreferenced stream (decompress every object)
 *   5 retained revisions (count %%EOF, with the linearized-file exception)
 *   6 /PieceInfo and /EmbeddedFiles in the raw bytes
 *   7 producer fingerprint in the current fields vs in the raw bytes
 * Nothing here writes to the file.
 */
const PDFMetaChecker = (function () {
    var MAX_SCAN = 64 * 1024 * 1024;

    var FINGERPRINTS = [
        ['Microsoft Word', 'Microsoft Word'],
        ['LibreOffice', 'LibreOffice'],
        ['OpenOffice', 'OpenOffice'],
        ['Ghostscript', 'Ghostscript'],
        ['Google Docs', 'Google Docs'],
        ['Skia/PDF', 'Chrome / Skia'],
        ['Chromium', 'Chromium'],
        ['Quartz', 'macOS Quartz'],
        ['pdfTeX', 'pdfTeX'],
        ['LaTeX', 'LaTeX'],
        ['iLovePDF', 'iLovePDF'],
        ['Smallpdf', 'Smallpdf'],
        ['Sejda', 'Sejda'],
        ['PDF24', 'PDF24'],
        ['PDF2Go', 'PDF2Go'],
        ['PDF Candy', 'PDF Candy'],
        ['Xodo', 'Xodo'],
        ['PDFgear', 'PDFgear'],
        ['Acrobat', 'Adobe Acrobat'],
        ['Adobe', 'Adobe'],
        ['Foxit', 'Foxit'],
        ['pdf-lib', 'pdf-lib'],
        ['ReportLab', 'ReportLab'],
        ['Privacy Index Test Harness', 'the test harness that made this probe']
    ];

    function pickInfo(doc) {
        function pick(fn) { try { var v = doc[fn](); return (v === undefined || v === null) ? null : v; } catch (e) { return null; } }
        function pickDate(fn) {
            var v = pick(fn);
            if (!(v instanceof Date)) return v;
            var t = v.getTime();
            return isNaN(t) ? null : v.toISOString();
        }
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
    }

    function normalizeInfo(info) {
        var out = {};
        ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModificationDate'].forEach(function (k) {
            var v = info ? info[k] : null;
            if (v === null || v === undefined) { out[k] = null; return; }
            if (typeof v === 'object' && v.value !== undefined) v = v.value;
            v = String(v).trim();
            if (v === '' || v === 'undefined' || v === 'null') { out[k] = null; return; }
            out[k] = v;
        });
        return out;
    }

    function parseXmp(text) {
        var fields = [];
        if (!text) return fields;
        var re = /<([A-Za-z][A-Za-z0-9_.-]*:[A-Za-z][A-Za-z0-9_.-]*)\b[^>]*>([^<]{1,300})<\/\1>/g;
        var m, seen = {};
        while ((m = re.exec(text)) !== null) {
            var key = m[1], value = m[2].trim();
            if (!value) continue;
            if (/^(rdf|xmlns)/i.test(key) && key !== 'rdf:li' && key !== 'rdf:value') continue;
            var id = key + '|' + value;
            if (seen[id]) continue;
            seen[id] = true;
            fields.push({ key: key, value: value });
        }
        return fields;
    }

    async function streamText(obj) {
        var content = obj && obj.contents;
        if (!content || !content.length) return null;
        var text = null;
        try { text = new TextDecoder('utf-8').decode(content); } catch (e) { text = null; }
        if (text && (text.indexOf('x:xmpmeta') !== -1 || text.indexOf('xpacket begin') !== -1)) return text;
        var filter = obj.dict && obj.dict.get && obj.dict.get(PDFLib.PDFName.of('Filter'));
        if (!filter || typeof DecompressionStream === 'undefined') return text;
        for (var i = 0; i < 2; i++) {
            var fmt = i === 0 ? 'deflate' : 'deflate-raw';
            try {
                var inflated = await new Response(new Blob([content]).stream().pipeThrough(new DecompressionStream(fmt))).arrayBuffer();
                var out = new TextDecoder('utf-8').decode(inflated);
                if (out) return out;
            } catch (e) { /* try the other framing */ }
        }
        return text;
    }

    function nonEmptyInfo(info) {
        var list = [];
        Object.keys(info).forEach(function (k) {
            var v = info[k];
            if (v === null || v === undefined || v === '') return;
            if (k === 'CreationDate' || k === 'ModificationDate') {
                var s = String(v);
                var year = null;
                if (/^D:\d{4}/.test(s)) year = parseInt(s.slice(2, 6), 10);
                else { var d = new Date(s); if (!isNaN(d.getTime())) year = d.getFullYear(); }
                if (year && year <= 1970) return;
            }
            list.push(k + ': ' + v);
        });
        return list;
    }

    async function inspect(file) {
        var buf = await file.arrayBuffer();
        var bytes = new Uint8Array(buf);

        var info = {}, pages = 0, xmpText = null, viewerRead = true;
        try {
            var task = pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false });
            var pdf = await task.promise;
            pages = pdf.numPages;
            var meta = await pdf.getMetadata();
            info = normalizeInfo(meta.info || {});
            try { if (meta.metadata) xmpText = meta.metadata.getRaw(); } catch (e) { xmpText = null; }
        } catch (e) {
            viewerRead = false;
        }

        var libDoc = null, refStream = null;
        try { libDoc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }); } catch (e) { /* keep going */ }
        if (!viewerRead && libDoc) {
            info = normalizeInfo(pickInfo(libDoc));
            pages = libDoc.getPageCount();
        }

        var refPresent = false;
        if (libDoc) {
            var ref = libDoc.catalog.get(PDFLib.PDFName.of('Metadata'));
            if (ref) {
                refPresent = true;
                try { refStream = libDoc.context.lookup(ref); } catch (e) { refStream = null; }
            }
        }
        if (refPresent && !xmpText && refStream && refStream.contents) {
            try {
                var filter = refStream.dict && refStream.dict.get && refStream.dict.get(PDFLib.PDFName.of('Filter'));
                if (!filter) xmpText = new TextDecoder('utf-8').decode(refStream.contents);
            } catch (e) { /* leave null */ }
        }
        var xmpFields = parseXmp(xmpText);

        var orphanXmp = 0, unscanned = 0, firstOrphan = null;
        if (libDoc) {
            try {
                var pairs = libDoc.context.enumerateIndirectObjects();
                for (var i = 0; i < pairs.length; i++) {
                    var obj = pairs[i][1];
                    if (refStream && obj === refStream) continue;
                    var content = obj && obj.contents;
                    if (!content || !content.length) continue;
                    if (content.length > 5 * 1024 * 1024) { unscanned++; continue; }
                    var text = null;
                    try { text = await streamText(obj); } catch (e) { text = null; }
                    if (text === null) { unscanned++; continue; }
                    if (text.indexOf('x:xmpmeta') !== -1 || text.indexOf('xpacket begin') !== -1) {
                        orphanXmp++;
                        if (!firstOrphan) {
                            var fs = parseXmp(text);
                            if (fs.length) firstOrphan = fs;
                        }
                    }
                }
            } catch (e) { /* enumerate unavailable */ }
        }

        var scanLimit = Math.min(bytes.length, MAX_SCAN);
        var latin = '';
        try { latin = new TextDecoder('latin1').decode(bytes.subarray(0, scanLimit)); } catch (e) { latin = ''; }

        var orphanInfo = 0, firstOrphanInfo = null;
        var currentInfo = {};
        ['Author', 'Title', 'Subject', 'Creator', 'Producer', 'Keywords'].forEach(function (k) {
            currentInfo[k] = info[k] ? String(info[k]).trim() : '';
        });
        var seenOrphan = {};
        if (latin) {
            ['Author', 'Title', 'Subject', 'Creator', 'Producer', 'Keywords'].forEach(function (k) {
                var re = new RegExp('/' + k + '\\s*\\(([^)]{1,200})\\)', 'g');
                var m;
                while ((m = re.exec(latin)) !== null) {
                    var v = m[1].replace(/\\\\/g, '\\').trim();
                    if (!v) continue;
                    if (currentInfo[k] && v === currentInfo[k]) continue;
                    var id = k + '|' + v;
                    if (seenOrphan[id]) continue;
                    seenOrphan[id] = true;
                    orphanInfo++;
                    if (!firstOrphanInfo) firstOrphanInfo = [];
                    if (firstOrphanInfo.length < 4) firstOrphanInfo.push({ key: k, value: v });
                }
            });
        }
        var eofCount = latin ? latin.split('%%EOF').length - 1 : 0;
        var linearized = latin.indexOf('/Linearized') !== -1;
        var revisions = eofCount;
        if (linearized && eofCount === 2) revisions = 1;
        var pieceInfo = latin.indexOf('/PieceInfo') !== -1;
        var embedded = latin.indexOf('/EmbeddedFiles') !== -1;
        var rawXmpHits = latin ? latin.split('x:xmpmeta').length - 1 : 0;

        var fieldText = [info.Title, info.Author, info.Subject, info.Keywords, info.Creator, info.Producer].filter(Boolean).join(' | ');
        xmpFields.forEach(function (f) {
            if (/creator|producer|creatortool|tool/i.test(f.key)) fieldText += ' | ' + f.value;
        });
        var fieldHits = [], rawHits = [];
        FINGERPRINTS.forEach(function (fp) {
            if (fieldText.indexOf(fp[0]) !== -1) { if (fieldHits.indexOf(fp[1]) === -1) fieldHits.push(fp[1]); }
            else if (latin.indexOf(fp[0]) !== -1) { if (rawHits.indexOf(fp[1]) === -1) rawHits.push(fp[1]); }
        });

        return {
            name: file.name,
            size: file.size,
            pages: pages,
            truncated: bytes.length > scanLimit,
            viewerRead: viewerRead,
            info: info,
            infoValues: nonEmptyInfo(info),
            orphanInfo: orphanInfo,
            firstOrphanInfo: firstOrphanInfo,
            xmpPresent: refPresent,
            xmpFields: xmpFields,
            xmpText: !!xmpText,
            orphanXmp: orphanXmp,
            firstOrphan: firstOrphan,
            unscanned: unscanned,
            revisions: revisions,
            eofCount: eofCount,
            linearized: linearized,
            pieceInfo: pieceInfo,
            embedded: embedded,
            rawXmpHits: rawXmpHits,
            fieldHits: fieldHits,
            rawHits: rawHits
        };
    }

    return { inspect: inspect, parseXmp: parseXmp };
})();

window.PDFMetaChecker = PDFMetaChecker;
