import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');

// State kept across refreshes, so a refresh never drops an ack or a row the viewer is about to click.
const rows = new Map(); // incident id -> <li>
const acked = new Map(); // incident id -> ack reply

// R5: viewer's local time zone and the viewer's own locale order (en-GB, de, pl… print dd/mm).
const timeFormat = new Intl.DateTimeFormat(navigator.languages?.length ? navigator.languages : undefined, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});

function localTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : timeFormat.format(d);
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function markAcked(row, reply) {
  row.classList.add('is-acked');
  row.querySelector('[data-testid="ack"]')?.remove();
  if (!row.querySelector('[data-testid="acked"]')) {
    const mark = el('span', { 'data-testid': 'acked', class: 'acked', title: reply.ackedAt }, 'acked');
    row.querySelector('.action').append(mark);
  }
}

// R7 (product, after the step-1 recording): Ack asks to confirm, and the confirm names the incident id,
// so a click that landed on a row that slid under the pointer can be caught before it acks.
const confirmBox = document.querySelector('[data-testid="confirm"]');
const confirmText = confirmBox.querySelector('.confirm-text');
const confirmAck = confirmBox.querySelector('[data-testid="confirm-ack"]');
const confirmCancel = confirmBox.querySelector('[data-testid="confirm-cancel"]');
let pending = null; // { id, button }

function askConfirm(id, button) {
  pending = { id, button };
  const row = rows.get(id);
  const what = row?.querySelector('.what')?.textContent ?? '';
  confirmText.textContent = `Ack ${id}?`;
  confirmBox.querySelector('.confirm-what').textContent = what;
  confirmBox.dataset.id = id;
  confirmBox.hidden = false;
  confirmAck.focus();
}

function closeConfirm() {
  confirmBox.hidden = true;
  delete confirmBox.dataset.id;
  pending = null;
}

confirmCancel.addEventListener('click', closeConfirm);
confirmBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeConfirm(); });
confirmAck.addEventListener('click', () => {
  if (!pending) return;
  const { id, button } = pending;
  closeConfirm();
  doAck(id, button);
});

function onAck(event) {
  const button = event.currentTarget;
  const row = button.closest('[data-testid="incident-row"]');
  // R2: the id of the row the button sits in at the moment of the click, never a list position
  askConfirm(row.dataset.id, button);
}

async function doAck(id, button) {
  const row = rows.get(id);
  button.disabled = true;
  button.textContent = 'acking…';
  try {
    const reply = await ack(id);
    acked.set(id, reply);
    markAcked(row, reply);
  } catch (err) {
    console.error(err);
    button.disabled = false;
    button.textContent = 'Ack';
  }
}

function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt, title: i.openedAt }, localTime(i.openedAt)),
  );
  const action = el('span', { class: 'action' });
  const button = el('button', { type: 'button', 'data-testid': 'ack' }, 'Ack');
  button.addEventListener('click', onAck);
  action.append(button);
  row.append(action);
  if (acked.has(i.id)) markAcked(row, acked.get(i.id));
  return row;
}

function updateRow(row, i) {
  row.className = `row ${i.severity}${acked.has(i.id) ? ' is-acked' : ''}`;
  row.querySelector('.sev').textContent = i.severity;
  row.querySelector('.what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
  const time = row.querySelector('time');
  if (time.getAttribute('datetime') !== i.openedAt) {
    time.setAttribute('datetime', i.openedAt);
    time.title = i.openedAt;
    time.textContent = localTime(i.openedAt);
  }
}

// R1: reconcile by id. Existing rows keep their node (and their Ack state); new ones go in at their
// place in the newest-first order, so a new incident lands at the top.
function render(incidents) {
  const seen = new Set();
  let before = list.firstChild;
  for (const i of incidents) {
    seen.add(i.id);
    let row = rows.get(i.id);
    if (row) updateRow(row, i);
    else {
      row = buildRow(i);
      rows.set(i.id, row);
    }
    if (row !== before) list.insertBefore(row, before);
    before = row.nextSibling;
  }
  for (const [id, row] of rows) {
    if (!seen.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }
  empty.hidden = incidents.length > 0;
  list.hidden = incidents.length === 0;
}

let loading = false;
async function refresh() {
  if (loading) return; // never stack requests if one is slow
  loading = true;
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    board.dataset.updatedAt = page.updatedAt;
    loader.remove(); // R3: gone once incidents are on screen
  } catch (err) {
    console.error(err);
  } finally {
    loading = false;
  }
}

await refresh();
setInterval(refresh, REFRESH_MS); // R4
