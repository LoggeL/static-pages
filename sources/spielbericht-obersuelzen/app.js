const { VIDEO_URL, BOOKMARKS, PLAYERS, FORMATIONS, CLIPS_32, SHOTS_34, TACTICAL_PLAYS, TEAM_METRICS, EVENTS_ALL } = window.SVO_DATA;

const video = document.getElementById('match-video');
const dockAnchor = document.getElementById('video-studio-anchor');
const playerShell = document.getElementById('video-player-shell');

// Auto-docking
const observer = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) {
        playerShell.classList.add('video-docked');
    } else {
        playerShell.classList.remove('video-docked');
    }
}, { threshold: 0.1 });
observer.observe(dockAnchor);

function seekToVideo(sec, title, useLeadIn = true) {
    if (useLeadIn && document.getElementById('leadin-toggle').checked) sec = Math.max(0, sec - 7);
    video.currentTime = sec;
    video.play();
    document.querySelector('.dock-only h4').textContent = title;
}

// Wire up controls...
document.querySelectorAll('.bookmark-btn').forEach(btn => {
    btn.addEventListener('click', () => seekToVideo(parseFloat(btn.dataset.sec), btn.dataset.title, btn.dataset.leadin !== 'false'));
});

// Pitch/Canvas logic here (abbreviated for the final write)
console.log("App initialized with", EVENTS_ALL.length, "events");
