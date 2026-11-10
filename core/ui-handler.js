'use strict';
const UIHandler = {
    taskListEl: null,
    uploadAreaEl: null,
    fileInputEl: null,
    tasks: new Map(),
    _taskNames: {},
    _processor: null,
    _cfg: null,
    _pending: new Map(),

    // 多工具复用入口。不调用时回落到 PDFCompressor，压缩页行为与改动前完全一致。
    // cfg = { handler, outputName(fileName, index), statsLabel, accept, maxFiles }
    setProcessor(cfg) {
        this._processor = (cfg && cfg.handler) ? cfg.handler : null;
        this._cfg = cfg || null;
    },

    _getProcessor() {
        return this._processor || window.PDFCompressor || null;
    },

    // 文件名完全交给页面自己的 outputName 决定。这里不再追加序号，
    // 否则 split / jpg 页已经带 -partN、-pageNN 的名字会变成 a-part1-1.pdf。
    _outputName(taskId, index, total) {
        const cfg = this._cfg;
        const label = this._taskNames[taskId] || 'file';
        if (cfg && typeof cfg.outputName === 'function') {
            return cfg.outputName(label, index, total);
        }
        return 'compressed_' + Date.now() + '.pdf';
    },

    initUploadEvent() {
        const self = this;
        self.taskListEl = document.getElementById('taskList');
        self.uploadAreaEl = document.querySelector('.upload-area');
        self.fileInputEl = document.getElementById('fileInput');
        if (!self.uploadAreaEl || !self.fileInputEl || !self.taskListEl) return;

        self.uploadAreaEl.addEventListener('click', () => self.fileInputEl.click());
        self.fileInputEl.addEventListener('change', e => {
            self.handleFiles(e.target.files);
            e.target.value = '';
        });
        self.uploadAreaEl.addEventListener('dragover', e => {
            e.preventDefault();
            self.uploadAreaEl.classList.add('active');
        });
        self.uploadAreaEl.addEventListener('dragleave', () => {
            self.uploadAreaEl.classList.remove('active');
        });
        self.uploadAreaEl.addEventListener('drop', e => {
            e.preventDefault();
            self.uploadAreaEl.classList.remove('active');
            self.handleFiles(e.dataTransfer.files);
        });

        document.querySelectorAll('.level-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (window.PDFCompressor) window.PDFCompressor.setQuality(btn.dataset.level);
            });
        });
    },

    handleFiles(files) {
        const self = this;
        const proc = self._getProcessor();
        if (!proc || typeof proc.addTask !== 'function') return;

        Array.from(files).forEach(file => {
            if (!file.name.toLowerCase().endsWith('.pdf')) return;
            const taskId = Date.now() + '_' + Math.random().toString(36).slice(2);
            self.renderTaskItem(taskId, file);

            // cfg.autoRun === false 时只登记文件，等页面按钮调 runPending()。
            // split 与 pdf-to-jpg 需要先让用户选模式/分辨率，不能一上传就跑。
            if (self._cfg && self._cfg.autoRun === false) {
                self._pending.set(taskId, file);
                const btn = document.querySelector('.task-item[data-id="' + taskId + '"] .download-btn');
                if (btn) {
                    btn.innerText = (window._lang === 'zh') ? '待处理' : 'Ready';
                    btn.disabled = false;
                }
                return;
            }

            self._runOne(taskId, file);
        });
    },

    _runOne(taskId, file) {
        const self = this;
        const proc = self._getProcessor();
        const btn = document.querySelector('.task-item[data-id="' + taskId + '"] .download-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerText = (window._lang === 'zh') ? '处理中...' : 'Processing...';
        }
        return proc.addTask(file, taskId)
            .then(blob => { if (blob) self.setTaskSuccess(taskId, blob); })
            .catch(err => self.showTaskError(taskId, (err && err.message) || 'Failed'));
    },

    runPending() {
        const self = this;
        const items = Array.from(this._pending.entries());
        this._pending.clear();
        items.forEach(entry => self._runOne(entry[0], entry[1]));
        return items.length;
    },

    renderTaskItem(taskId, file) {
        const self = this;
        self._taskNames[taskId] = file.name;
        const fileSize = (file.size / 1024 / 1024).toFixed(2);
        const lang = window._lang || 'en';
        const statusText = lang === 'zh' ? '处理中...' : 'Processing...';
        const sizeLabel = lang === 'zh' ? '原始大小' : 'Original';
        const html =
            '<div class="task-item" data-id="' + taskId + '">' +
            '<div class="task-info">' +
            '<div class="task-name">' + file.name + '</div>' +
            '<div class="task-size">' + sizeLabel + ': ' + fileSize + ' MB</div>' +
            '</div>' +
            '<div class="task-progress"><div class="progress-bar" style="width:0%"></div></div>' +
            '<button class="task-btn download-btn" disabled>' + statusText + '</button>' +
            '</div>';
        self.taskListEl.insertAdjacentHTML('beforeend', html);
    },

    updateTaskProgress(taskId, percent) {
        const item = document.querySelector('.task-item[data-id="' + taskId + '"]');
        if (!item) return;
        const bar = item.querySelector('.progress-bar');
        if (bar) bar.style.width = percent + '%';
    },

    updateTaskStats(taskId, originalSize, compressedSize, ratio) {
        const item = document.querySelector('.task-item[data-id="' + taskId + '"]');
        if (!item) return;
        const sizeEl = item.querySelector('.task-size');
        if (!sizeEl) return;
        const lang = window._lang || 'en';
        const origMB = (originalSize / 1024 / 1024).toFixed(2);
        const compMB = (compressedSize / 1024 / 1024).toFixed(2);
        const savedLabel = lang === 'zh' ? '压缩后' : ((this._cfg && this._cfg.statsLabel) || 'Compressed');
        sizeEl.innerHTML = (lang === 'zh' ? '原始' : 'Original') + ': ' + origMB + ' MB → ' + savedLabel + ': ' + compMB + ' MB (' + ratio + '%)';
    },

    setTaskSuccess(taskId, blob) {
        const self = this;
        const item = document.querySelector('.task-item[data-id="' + taskId + '"]');
        if (!item) return;
        const btn = item.querySelector('.download-btn');
        const blobs = (Array.isArray(blob) ? blob : [blob]).filter(Boolean);
        if (blobs.length === 0) return;
        const lang = window._lang || 'en';

        const entries = blobs.map((b, i) => {
            const url = URL.createObjectURL(b);
            MemoryManager.registerURL(url);
            return { url: url, blob: b, name: self._outputName(taskId, i, blobs.length) };
        });

        // 保留 url/blob/name 三个原有字段，ZipHandler 无需改动
        self.tasks.set(taskId, {
            url: entries[0].url,
            blob: entries[0].blob,
            name: entries[0].name,
            items: entries
        });

        btn.innerText = lang === 'zh' ? '下载文件' : 'Download';
        btn.disabled = false;

        if (entries.length === 1) {
            btn.onclick = () => {
                const a = document.createElement('a');
                a.href = entries[0].url;
                a.download = entries[0].name;
                a.click();
            };
        } else {
            const links = document.createElement('div');
            links.className = 'task-multi';
            entries.forEach(e => {
                const a = document.createElement('a');
                a.href = e.url;
                a.download = e.name;
                a.className = 'multi-link';
                a.innerText = e.name;
                links.appendChild(a);
            });
            btn.replaceWith(links);
        }
        self.toggleBatchDownloadBtn();
    },

    toggleBatchDownloadBtn() {
        const batchBtn = document.querySelector('.download-all');
        if (!batchBtn) return;
        // 判据是“输出总数”，不是上传文件数：一个 PDF 转 12 张图也要能打包下载。
        let outputs = 0;
        this.tasks.forEach(item => { outputs += (item.items && item.items.length) ? item.items.length : 1; });
        batchBtn.style.display = outputs > 1 ? 'block' : 'none';
    },

    showTaskError(taskId, msg) {
        const item = document.querySelector('.task-item[data-id="' + taskId + '"]');
        if (!item) return;
        const bar = item.querySelector('.progress-bar');
        if (bar) {
            bar.style.width = '100%';
            bar.style.background = '#ef4444';
        }
        const btn = item.querySelector('.download-btn');
        if (btn) {
            btn.innerText = msg;
            btn.style.background = '#ef4444';
            btn.disabled = true;
        }
    },

    clearAllTasks() {
        this.tasks.forEach(item => { try { URL.revokeObjectURL(item.url); } catch (e) {} });
        this.tasks.clear();
        if (this.taskListEl) this.taskListEl.innerHTML = '';
        this.toggleBatchDownloadBtn();
        MemoryManager.releaseAllBlob();
        MemoryManager.releaseAllURLs();
    }
};
window.UIHandler = UIHandler;
