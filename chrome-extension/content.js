// Content script (isolated world). Reads the DataTable rows directly from the DOM and posts.
function text(node) { return (node && node.innerText) ? node.innerText.trim() : ''; }

function collectAttendees() {
  const table = document.querySelector('#datatable-buttons tbody') || document.querySelector('table tbody');
  if (!table) return [];
  const rows = [];
  table.querySelectorAll('tr').forEach(function (tr) {
    if (!tr.querySelectorAll('td').length) return;
    const rowLabel = text(tr).replace(/\s+/g, ' ').trim();
    // Cell structure: [ #number, name + faculty, time ]
    const cells = tr.querySelectorAll('td');
    if (cells.length < 3) return;
    const nameFaculty = text(cells[1]).split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    rows.push({
      name: nameFaculty[0] || '',
      faculty: nameFaculty[1] || '',
      checkInTime: text(cells[cells.length - 1])
    });
  });
  return rows;
}

function post() {
  const cfg = window.JKPS_SYNC_CONFIG;
  if (!cfg) return;
  const attendees = collectAttendees();
  if (!attendees.length) return;
  const meetingTitle = (document.querySelector('.x_title h2') || {}).innerText ? document.querySelector('.x_title h2').innerText.trim() : document.title;
  const trackingId = (new URL(window.location.href).searchParams.get('thekey') || '').slice(-5);
  fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'syncLiveAttendance', token: cfg.token, meetingTitle: meetingTitle, trackingId: trackingId, attendees: attendees })
  }).catch(function (error) { console.warn('JKPS attendance sync failed:', error); });
}

setTimeout(post, 3000);
setInterval(post, 10000);
