// ===== NAVBAR HAMBURGER =====
const hamburger = document.querySelector('.hamburger');
const navLinks = document.querySelector('.nav-links');
hamburger.addEventListener('click', () => navLinks.classList.toggle('show'));

// ===== COUNTDOWN =====
const countdownElement = document.getElementById("countdown");
const releaseElement = document.getElementById("release-date");
const releaseTime = "2025-10-25T00:00:00"; // AEDT
const timeZone = "Australia/Sydney";
const releaseDateAEDT = new Date(releaseTime);
const releaseDateLocal = new Date(releaseDateAEDT.toLocaleString('en-US',{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}));
releaseElement.textContent = `AEDT: ${releaseDateAEDT.toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short',timeZone:timeZone})} | Your Time: ${releaseDateLocal.toLocaleString()}`;

function updateCountdown() {
  const now = new Date();
  const diff = releaseDateAEDT - now;
  if(diff <= 0) { countdownElement.textContent = "Out Now!"; return; }
  const days = Math.floor(diff/(1000*60*60*24));
  const hours = Math.floor((diff/(1000*60*60))%24);
  const mins = Math.floor((diff/(1000*60))%60);
  const secs = Math.floor((diff/1000)%60);
  countdownElement.textContent = `${days}d ${hours}h ${mins}m ${secs}s`;
}
setInterval(updateCountdown, 1000);
updateCountdown();

// ===== MUSIC CARDS DATA =====
const musicSections = [
  {
    title: "Popular Tracks",
    tracks: [
      "https://open.spotify.com/track/7nXEbI0APAz5A0Eu5WplqT",
      "https://open.spotify.com/track/0KMw00xCTfO2DknghdAm5e",
      "https://open.spotify.com/track/4cjPxibtS86esnvVdrVF5G"
    ]
  },
  {
    title: "Recent Releases",
    tracks: [
      "https://open.spotify.com/album/6h3vtYq7BmnVmG9hCGVsP1?si=YCMMa99YSkyfHG29rI2imw",
      "https://open.spotify.com/track/1DhSKkbS2mJUiFydh4hIR5",
      "https://open.spotify.com/track/0KMw00xCTfO2DknghdAm5e"
    ]
  },
  {
    title: "Featured Music",
    tracks: [
      "https://open.spotify.com/track/0YbIjMC4dNebTEFwYJl2Mr",
      "https://open.spotify.com/track/2kBQzsiHEeBFwKnEDo13Rl",
      "https://open.spotify.com/track/6Dk1WBTgXAcCtY9lGwMIw5"
    ]
  }
];

// ===== GENERATE MUSIC CARDS =====
const musicContainer = document.getElementById('music-container');

musicSections.forEach(section => {
  const sec = document.createElement('section');
  sec.className = 'music-section';
  const h2 = document.createElement('h2');
  h2.textContent = section.title;
  sec.appendChild(h2);

  const grid = document.createElement('div');
  grid.className = 'music-grid';

  section.tracks.forEach(url => {
    const card = document.createElement('a');
    card.className = 'music-card';
    card.dataset.trackUrl = url;
    grid.appendChild(card);
  });

  sec.appendChild(grid);
  musicContainer.appendChild(sec);
});

// ===== LOAD SPOTIFY DATA =====
async function loadSpotifyData() {
  const cards = document.querySelectorAll(".music-card");
  for (let card of cards) {
    const url = card.dataset.trackUrl;
    try {
      const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      card.innerHTML = `<img src="${data.thumbnail_url}" alt="${data.title}"><h3>${data.title}</h3>`;
      const type = url.includes('/album/') ? 'album' : 'track';
      const id = url.split('/').pop().split('?')[0];
      card.addEventListener('click', () => {
        document.getElementById('spotify-player').src = `https://open.spotify.com/embed/${type}/${id}`;
        document.getElementById('spotify-modal').style.display = 'flex';
      });
    } catch(err) {
      console.error(err);
      card.innerHTML = "<h3>Track unavailable</h3>";
    }
  }
}
loadSpotifyData();

// ===== MODAL =====
const modal = document.getElementById('spotify-modal');
const player = document.getElementById('spotify-player');
document.querySelector('.modal-close').onclick = () => {
  modal.style.display = 'none';
  player.src = '';
};
window.onclick = (e) => {
  if (e.target === modal) {
    modal.style.display = 'none';
    player.src = '';
  }
};
