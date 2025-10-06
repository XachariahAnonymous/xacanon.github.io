// ---------- Helper: parse Spotify track ID ----------
function parseSpotifyTrackId(url) {
  // Accepts:
  // - https://open.spotify.com/track/{id}
  // - https://open.spotify.com/track/{id}?si=...
  // - spotify:track:{id}
  if (!url) return null;
  const trackRegex = /(?:track[:\/])([A-Za-z0-9]{22})/;
  const match = url.match(trackRegex);
  return match ? match[1] : null;
}

// ---------- Splash setup: set embed iframe + fetch thumbnail ----------
document.addEventListener('DOMContentLoaded', () => {
  const splash = document.getElementById('splash-screen');
  const mainContent = document.getElementById('main-content');
  const closeSplash = document.getElementById('close-splash');

  // close button behavior with fade out/in
  closeSplash.addEventListener('click', () => {
    splash.style.transition = 'opacity 0.45s ease';
    splash.style.opacity = '0';
    setTimeout(() => {
      splash.style.display = 'none';
      mainContent.classList.remove('hidden');
      mainContent.classList.add('fade-in');
    }, 500);
  });

  // If you want the splash to auto-close after N seconds, uncomment:
  // setTimeout(() => closeSplash.click(), 7000); // auto-close after 7s

  // Process the splash track URL
  const splashTrackUrl = splash.getAttribute('data-track-url') || '';
  const splashId = parseSpotifyTrackId(splashTrackUrl);

  const splashIframe = document.getElementById('splash-iframe');
  const splashCover = document.getElementById('splash-cover');
  const splashTitle = document.getElementById('splash-track-title');

  if (splashId) {
    // set embed src (must be embed/track/{id})
    splashIframe.src = `https://open.spotify.com/embed/track/${splashId}`;

    // Try to fetch oEmbed to get thumbnail & title (may be blocked by CORS in some contexts)
    const oembedUrl = 'https://open.spotify.com/oembed?url=' + encodeURIComponent(splashTrackUrl);
    fetch(oembedUrl)
      .then(res => {
        if (!res.ok) throw new Error('oEmbed fetch failed');
        return res.json();
      })
      .then(data => {
        if (data.thumbnail_url) splashCover.src = data.thumbnail_url;
        if (data.title) splashTitle.textContent = data.title + (data.author_name ? ' — ' + data.author_name : '');
      })
      .catch(err => {
        // If fetch fails (CORS or network), keep fallback placeholder and set a small friendly title
        console.warn('oEmbed failed or blocked:', err);
        splashTitle.textContent = 'Open on Spotify';
      });
  } else {
    // no valid id: show default message
    splashTitle.textContent = 'Invalid Spotify link — replace data-track-url with a valid link.';
  }

  // ---------- Featured music cards: set link + try to load cover art for each card that has data-track-url ----------
  const musicCards = document.querySelectorAll('.music-card[data-track-url]');
  musicCards.forEach((card, idx) => {
    const trackUrl = card.getAttribute('data-track-url');
    const tid = parseSpotifyTrackId(trackUrl);
    const img = card.querySelector('.card-cover');
    const listenLink = card.querySelector('.listen-link');
    const titleEl = card.querySelector('h3');

    if (tid) {
      // set listen link correctly to track page (not embed)
      if (listenLink) listenLink.href = `https://open.spotify.com/track/${tid}`;

      // try oEmbed for thumbnail + title
      const oembedFetch = 'https://open.spotify.com/oembed?url=' + encodeURIComponent(trackUrl);
      fetch(oembedFetch)
        .then(r => {
          if (!r.ok) throw new Error('oEmbed fetch failed');
          return r.json();
        })
        .then(json => {
          if (json.thumbnail_url && img) img.src = json.thumbnail_url;
          if (json.title && titleEl) titleEl.textContent = json.title;
        })
        .catch(e => {
          // fallback: keep placeholder (user can replace manually)
          console.warn('Card oEmbed failed:', e);
        });
    } else {
      if (listenLink) listenLink.href = '#';
    }
  });

  // ---------- Start main page hidden until splash dismissed (or you could auto-hide) ----------
  // (mainContent remains hidden until the splash is closed)
});

// ===== COUNTDOWN TIMER =====
function updateCountdown() {
  const releaseDateEl = document.getElementById('release-date');
  if (!releaseDateEl) return;
  // The content expects an ISO date/time string (AEST) — parser uses local browser time.
  const releaseDateRaw = releaseDateEl.textContent.trim();
  const releaseDate = new Date(releaseDateRaw).getTime();
  const now = new Date().getTime();
  const distance = releaseDate - now;

  const cdEl = document.getElementById('countdown');
  if (!cdEl) return;

  if (isNaN(releaseDate) || releaseDateRaw === '') {
    cdEl.innerText = 'Set a valid release date in the HTML (ISO format).';
    return;
  }

  if (distance <= 0) {
    cdEl.innerText = "It's out now!";
    return;
  }

  const days = Math.floor(distance / (1000 * 60 * 60 * 24));
  const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((distance % (1000 * 60)) / 1000);

  cdEl.innerText = `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

setInterval(updateCountdown, 1000);
updateCountdown();
