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
    if (useLeadIn && document.getElementById('leadin-toggle') && document.getElementById('leadin-toggle').checked) sec = Math.max(0, sec - 7);
    video.currentTime = sec;
    video.play();
    document.querySelector('.dock-only h4').textContent = title;
}

function createVideoBtn(sec, label, leadIn=true) {
    const btn = document.createElement('button');
    btn.className = 'btn-video';
    btn.textContent = '▶ ' + label;
    btn.onclick = () => seekToVideo(sec, label, leadIn);
    return btn;
}

// 1. Render Event Log (#kap-5)
const logContainer = document.getElementById('kap-5');
const logList = document.createElement('ul');
EVENTS_ALL.forEach(ev => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${ev.minLabel}</strong> ${ev.actors}: ${ev.desc} `;
    li.appendChild(createVideoBtn(ev.videoSec, ev.actors));
    logList.appendChild(li);
});
logContainer.appendChild(logList);

// 2. Render Tactical Plays (#kap-4)
const tacticContainer = document.getElementById('kap-4');
TACTICAL_PLAYS.forEach(play => {
    const div = document.createElement('div');
    div.innerHTML = `<h3>${play.title}</h3><p>${play.desc}</p>`;
    div.appendChild(createVideoBtn(play.videoSec, play.title));
    tacticContainer.appendChild(div);
});

// 3. Simple Training Planner (#kap-6)
const trainContainer = document.getElementById('kap-6');
trainContainer.innerHTML += `
    <ul id="training-list">
        <li><input type="checkbox"> Fokus-Drill: Pressingfalle (1475s) <button class="btn-video" onclick="seekToVideo(1475, 'Pressing-Drill')">▶ Video</button></li>
        <li><input type="checkbox"> Fokus-Drill: Distanzschuss-Verwertung (6023s) <button class="btn-video" onclick="seekToVideo(6023, 'Distanz-Drill')">▶ Video</button></li>
        <li><input type="checkbox"> Fokus-Drill: Defensiv-Konterblock (6135s) <button class="btn-video" onclick="seekToVideo(6135, 'Konter-Drill')">▶ Video</button></li>
    </ul>`;

console.log("App initialized with", EVENTS_ALL.length, "events");
