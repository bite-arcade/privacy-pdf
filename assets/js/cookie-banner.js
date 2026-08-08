document.addEventListener('DOMContentLoaded', function() {
    var cookieBanner = document.getElementById('cookieBanner');
    var acceptBtn = document.getElementById('cookieAccept');
    if (!cookieBanner || !acceptBtn) return;
    try {
        if (!localStorage.getItem('cookieAccepted')) cookieBanner.classList.add('show');
    } catch (_) { cookieBanner.classList.add('show'); }
    acceptBtn.addEventListener('click', function() {
        try { localStorage.setItem('cookieAccepted', 'true'); } catch (_) {}
        cookieBanner.classList.remove('show');
    });
});
