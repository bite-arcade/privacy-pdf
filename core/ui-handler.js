'use strict';
const UIHandler = {
    taskListEl: null,
    uploadAreaEl: null,
    fileInputEl: null,
    tasks: new Map(),
    _taskNames: {},

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
        const fileArray = Array.from(files);
        fileArray.forEach(file => {
            if (!file.name.toLowerCase().endsWith('.pdf')) return;
            const taskId = Date.now() + '_' + Math.random().toString(36).slice(2);
            self.renderTaskItem(taskId, file);
            if (window.PDFCompressor) {
                window.PDFCompressor.addTask(file, taskId).then(blob => {
                    if (blob) self.setTaskSuccess(taskId, blob);
                });
            }
        });
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
        const savedLabel = lang === 'zh' ? '压缩后' : 'Compressed';
        sizeEl.innerHTML = (lang === 'zh' ? '原始' : 'Original') + ': ' + origMB + ' MB → ' + savedLabel + ': ' + compMB + ' MB (' + ratio + '%)';
    },

    setTaskSuccess(taskId, blob) {
        const self = this;
        const item = document.querySelector('.task-item[data-id="' + taskId + '"]');
        if (!item) return;
        const btn = item.querySelector('.download-btn');
        const url = URL.createObjectURL(blob);
        MemoryManager.registerURL(url);
        self.tasks.set(taskId, { url: url, blob: blob, name: self._taskNames[taskId] || null });
        const lang = window._lang || 'en';
        btn.innerText = lang === 'zh' ? '下载文件' : 'Download';
        btn.disabled = false;
        btn.onclick = () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = 'compressed_' + Date.now() + '.pdf';
            a.click();
        };
        self.toggleBatchDownloadBtn();
    },

    toggleBatchDownloadBtn() {
        const batchBtn = document.querySelector('.download-all');
        if (batchBtn) batchBtn.style.display = this.tasks.size > 1 ? 'block' : 'none';
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
