const { VIDEO_URL, BOOKMARKS, PLAYERS, FORMATIONS, CLIPS_32, SHOTS_34, TACTICAL_PLAYS, TEAM_METRICS, EVENTS_ALL, TACTICAL_HIGHLIGHTS } = window.SVO_DATA;

const video = document.getElementById('match-video');

function seekToVideo(sec, title, leadIn = true) {
    if (leadIn && document.getElementById('leadin-toggle') && document.getElementById('leadin-toggle').checked) sec = Math.max(0, sec - 7);
    video.currentTime = sec;
    video.play();
}

// 1. Add Tactical Highlights Section (#kap-4)
const tacticContainer = document.getElementById('kap-4');
const hlList = document.createElement('ul');
TACTICAL_HIGHLIGHTS.forEach(hl => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${hl.label}</strong>: ${hl.desc} `;
    const btn = document.createElement('button');
    btn.className = 'btn-video';
    btn.textContent = '▶ Szene ansehen';
    btn.onclick = () => seekToVideo(hl.sec, hl.label);
    li.appendChild(btn);
    hlList.appendChild(li);
});
tacticContainer.appendChild(hlList);

console.log("App initialized with corrected tactical model.");
