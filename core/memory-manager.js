'use strict';
const MemoryManager = {
    blobList: [],
    fileObjects: [],
    urlList: [],
    canvasPool: [],

    registerBlob(blob) { this.blobList.push(blob); },
    registerFile(file) { this.fileObjects.push(file); },
    registerURL(url) { this.urlList.push(url); },
    registerCanvas(canvas) { this.canvasPool.push(canvas); },

    releaseAllBlob() {
        this.blobList.forEach(blob => { try { URL.revokeObjectURL(blob); } catch (e) {} });
        this.blobList = [];
    },
    releaseAllURLs() {
        this.urlList.forEach(url => { try { URL.revokeObjectURL(url); } catch (e) {} });
        this.urlList = [];
    },
    releaseCanvasPool() {
        this.canvasPool.forEach(canvas => {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.width = 0;
            canvas.height = 0;
        });
        this.canvasPool = [];
    },
    clearFileCache() { this.fileObjects = []; },

    fullReset() {
        this.releaseAllBlob();
        this.releaseAllURLs();
        this.releaseCanvasPool();
        this.clearFileCache();
        if (window.gzipTaskQueue) window.gzipTaskQueue = [];
        if (window.processingCount) window.processingCount = 0;
        if (window.UIHandler && window.UIHandler.tasks) window.UIHandler.tasks.clear();
    }
};

window.addEventListener('beforeunload', () => {
    if (typeof MemoryManager !== 'undefined') MemoryManager.fullReset();
});
window.MemoryManager = MemoryManager;
