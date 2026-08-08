'use strict';
const ZipHandler = {
    async downloadAll() {
        const tasks = UIHandler.tasks;
        const lang = window._lang || 'en';
        if (tasks.size === 0) {
            alert(lang === 'zh' ? '暂无已压缩完成的文件' : 'No compressed files available');
            return;
        }
        try {
            const zip = new JSZip();
            tasks.forEach(item => {
                const name = (item.name && item.name.toLowerCase().endsWith('.pdf'))
                    ? item.name.replace(/\.pdf$/i, '_compressed.pdf')
                    : 'compressed_' + Date.now() + '.pdf';
                zip.file(name, item.blob);
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
