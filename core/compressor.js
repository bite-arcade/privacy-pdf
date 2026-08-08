'use strict';
/**
 * PDF压缩核心引擎 v4.3
 * 优化：120s超时、100MB文件上限、JPG图片预判、加密PDF提示、Canvas统一内存回收
 */
const PDFCompressor = {
    qualityLevel: 'balanced',
    maxConcurrency: 1,
    processingCount: 0,
    taskQueue: [],
    MAX_FILE_SIZE: 100 * 1024 * 1024,
    SIZE_THRESHOLD: 500 * 1024,

    setQuality(level) { this.qualityLevel = level; },

    addTask(file, taskId) {
        const self = this;
        return new Promise(resolve => {
            self.taskQueue.push({ file, taskId, resolve });
            self.runQueue();
        });
    },

    runQueue() {
        const self = this;
        if (self.processingCount >= self.maxConcurrency || self.taskQueue.length === 0) return;
        self.processingCount++;
        const task = self.taskQueue.shift();
        self.compressFile(task.file, task.taskId)
            .then(r => task.resolve(r))
            .catch(e => { console.error('Task error:', e); task.resolve(null); })
            .finally(() => { self.processingCount--; self.runQueue(); });
    },

    _hasJPGMarker(buf) {
        const u8 = new Uint8Array(buf);
        const limit = Math.min(u8.length, 1024 * 1024);
        for (let i = 0; i < limit - 4; i++) {
            if (u8[i] === 0xFF && u8[i+1] === 0xD8 && u8[i+2] === 0xFF) return true;
        }
        return false;
    },

    async compressFile(file, taskId) {
        const self = this;
        MemoryManager.registerFile(file);
        const originalSize = file.size;
        const lang = window._lang || 'en';

        if (originalSize > self.MAX_FILE_SIZE) {
            const msg = lang === 'zh' ? '文件超过100MB上限' : 'File exceeds 100MB limit';
            if (window.UIHandler) window.UIHandler.showTaskError(taskId, msg);
            const origBlob = new Blob([file], { type: 'application/pdf' });
            MemoryManager.registerBlob(origBlob);
            if (window.UIHandler) window.UIHandler.updateTaskStats(taskId, originalSize, originalSize, 0);
            return origBlob;
        }

        const updateProgress = (pct) => {
            if (window.UIHandler) window.UIHandler.updateTaskProgress(taskId, Math.round(Math.min(pct, 99)));
        };
        updateProgress(3);

        const abortController = new AbortController();
        const signal = abortController.signal;
        let timedOut = false;
        const timeoutId = setTimeout(() => {
            timedOut = true;
            abortController.abort();
            const msg = lang === 'zh' ? '处理超时' : 'Timeout';
            if (window.UIHandler) window.UIHandler.showTaskError(taskId, msg);
        }, 120000);

        let quality, dpi;
        switch (self.qualityLevel) {
            case 'light':  quality = 0.85; dpi = 150; break;
            case 'extreme': quality = 0.4;  dpi = 72;  break;
            default:        quality = 0.75; dpi = 120;
        }

        try {
            const buf = await file.arrayBuffer();
            if (signal.aborted) return null;
            updateProgress(8);

            const sizeOver = originalSize > self.SIZE_THRESHOLD;
            const hasJPG = self._hasJPGMarker(buf);
            const useImageMode = sizeOver && hasJPG && typeof pdfjsLib !== 'undefined';

            let bytes;
            if (useImageMode) {
                console.log('PDF image detection: true, size:', originalSize);
                bytes = await self._imageCompress(buf, quality, dpi, updateProgress, signal);
            } else {
                console.log('PDF image detection: false, size:', originalSize);
                if (typeof PDFLib === 'undefined') throw new Error('pdf-lib load failed');
                const doc = await PDFLib.PDFDocument.load(buf, { updateMetadata: false });
                if (signal.aborted) return null;
                updateProgress(50);
                try { doc.setCreator(''); doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords(''); } catch (e) {}
                bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 100 });
            }

            clearTimeout(timeoutId);
            if (timedOut || signal.aborted) return null;
            if (!bytes || bytes.length < 100) throw new Error('Empty output bytes');

            if (bytes.length >= originalSize * 0.98) {
                console.log('No significant reduction, returning original');
                const origBlob = new Blob([file], { type: 'application/pdf' });
                MemoryManager.registerBlob(origBlob);
                if (window.UIHandler) window.UIHandler.updateTaskStats(taskId, originalSize, originalSize, 0);
                return origBlob;
            }

            const blob = new Blob([bytes], { type: 'application/pdf' });
            MemoryManager.registerBlob(blob);
            if (window.UIHandler) {
                const ratio = Math.round((1 - bytes.length / originalSize) * 100);
                window.UIHandler.updateTaskStats(taskId, originalSize, bytes.length, ratio);
            }
            return blob;

        } catch (err) {
            clearTimeout(timeoutId);
            if (signal.aborted) return null;
            console.error('Compress failed:', err);
            if (/encrypt|password|restricted/i.test(err.message)) {
                const tip = lang === 'zh' ? 'PDF已加密，请解除权限限制后重试' : 'PDF encrypted, remove restrictions first';
                if (window.UIHandler) window.UIHandler.showTaskError(taskId, tip);
            }
            const origBlob = new Blob([file], { type: 'application/pdf' });
            MemoryManager.registerBlob(origBlob);
            if (window.UIHandler) window.UIHandler.updateTaskStats(taskId, originalSize, originalSize, 0);
            return origBlob;
        }
    },

    async _imageCompress(arrayBuf, quality, dpi, updateProgress, signal) {
        const self = this;
        const scale = dpi / 72;
        if (signal.aborted) return null;
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuf) }).promise;
        if (signal.aborted) return null;
        updateProgress(12);
        const numPages = pdf.numPages;
        console.log('Total pages:', numPages);

        const newDoc = await PDFLib.PDFDocument.create();
        if (signal.aborted) return null;

        let idx = 0;
        const failedPages = [];
        return new Promise((resolve, reject) => {
            const processNext = async () => {
                if (signal.aborted) return reject(new Error('Cancelled'));
                if (idx >= numPages) {
                    if (failedPages.length > 0) console.warn('Failed render pages:', failedPages);
                    updateProgress(92);
                    const finalBytes = await newDoc.save({ useObjectStreams: true, addDefaultPage: false });
                    return resolve(finalBytes);
                }
                const progress = 12 + (idx / numPages) * 80;
                updateProgress(progress);
                try {
                    const jpegBytes = await self._renderPageToJPEG(pdf, idx + 1, quality, scale);
                    if (signal.aborted) return;
                    const jpegImage = await newDoc.embedJpg(jpegBytes);
                    if (!jpegImage) throw new Error('Embed jpg failed');
                    const page = await pdf.getPage(idx + 1);
                    const vp = page.getViewport({ scale: 1 });
                    const pageObj = newDoc.addPage([vp.width, vp.height]);
                    pageObj.drawImage(jpegImage, { x: 0, y: 0, width: vp.width, height: vp.height });
                } catch (err) {
                    console.warn('Page ' + (idx+1) + ' render skip:', err);
                    failedPages.push(idx + 1);
                }
                idx++;
                setTimeout(processNext, 30);
            };
            processNext();
        });
    },

    async _renderPageToJPEG(pdf, pageNum, quality, scale) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        MemoryManager.registerCanvas(canvas);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport }).promise;

        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                canvas.width = 0;
                canvas.height = 0;
                if (!blob) return reject(new Error('Canvas toBlob failed'));
                const reader = new FileReader();
                reader.onload = () => resolve(new Uint8Array(reader.result));
                reader.onerror = reject;
                reader.readAsArrayBuffer(blob);
            }, 'image/jpeg', quality);
        });
    }
};

window.PDFCompressor = PDFCompressor;
