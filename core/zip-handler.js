'use strict';
const ZipHandler = {
    async downloadAll() {
        const tasks = UIHandler.tasks;
        const lang = window._lang || 'en';
        if (tasks.size === 0) {
            alert(lang === 'zh' ? '暂无可下载的文件' : 'No finished files yet');
            return;
        }
        try {
            const zip = new JSZip();
            let counter = 0;
            const seen = {};
            tasks.forEach(item => {
                const list = (item.items && item.items.length) ? item.items : [{ blob: item.blob, name: item.name }];
                list.forEach(e => {
                    let name = e.name || ('output-' + (++counter) + '.pdf');
                    if (seen[name]) {
                        const dot = name.lastIndexOf('.');
                        const base = dot > 0 ? name.slice(0, dot) : name;
                        const ext = dot > 0 ? name.slice(dot) : '';
                        name = base + '-' + (++counter) + ext;
                    }
                    seen[name] = true;
                    zip.file(name, e.blob);
                });
            });
            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            MemoryManager.registerBlob(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'PrivacyPDF_batch.zip';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 3000);
        } catch (err) {
            console.error('Batch ZIP error:', err);
            alert(lang === 'zh' ? '批量打包下载失败' : 'Batch download failed');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const downloadAllBtn = document.querySelector('.download-all');
    if (downloadAllBtn) downloadAllBtn.addEventListener('click', () => ZipHandler.downloadAll());
});
window.ZipHandler = ZipHandler;
