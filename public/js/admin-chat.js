(function () {
  const chatLog = document.getElementById('admin-chat-log');
  const chatEmpty = document.getElementById('admin-chat-empty');
  const chatError = document.getElementById('admin-chat-error');
  const chatForm = document.getElementById('admin-chat-form');
  const chatMessageInput = document.getElementById('admin-chat-message');

  if (!chatLog || !chatForm) return;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatTime(isoLike) {
    if (!isoLike) return '';
    const iso = isoLike.includes('T') ? isoLike : isoLike.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return isoLike;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  async function deleteMessage(id, bubble) {
    bubble.style.opacity = '0.4';
    try {
      const res = await fetch(`/admin/chat/${id}/delete`, { method: 'POST' });
      if (res.ok) {
        bubble.remove();
      } else {
        bubble.style.opacity = '1';
      }
    } catch (err) {
      bubble.style.opacity = '1';
    }
  }

  // Full snapshot every poll (not incremental) so a deleted message
  // disappears from this view too, not just stop showing up going forward.
  function renderMessages(messages) {
    const currentIds = new Set((messages || []).map((m) => String(m.id)));

    Array.from(chatLog.children).forEach((el) => {
      if (!currentIds.has(el.dataset.id)) el.remove();
    });

    if (!messages || !messages.length) {
      chatEmpty.style.display = 'block';
      return;
    }

    const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;

    messages.forEach((m) => {
      if (chatLog.querySelector(`[data-id="${m.id}"]`)) return;

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble' + (m.is_dj ? ' chat-bubble-dj' : '');
      bubble.dataset.id = m.id;
      bubble.innerHTML = `
        <span class="chat-sender">${escapeHtml(m.is_dj ? 'DJ (you)' : m.sender_name)}</span>
        <span class="chat-text">${escapeHtml(m.message)}</span>
        <span class="chat-time">${formatTime(m.created_at)}</span>`;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.style.padding = '2px 10px';
      delBtn.style.fontSize = '0.7rem';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteMessage(m.id, bubble));
      bubble.appendChild(delBtn);

      chatLog.appendChild(bubble);
    });

    chatEmpty.style.display = chatLog.childElementCount ? 'none' : 'block';
    if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
  }

  async function pollChat() {
    try {
      const res = await fetch('/admin/chat', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      renderMessages(data.messages);
    } catch (err) {
      // Silently retry on next interval.
    }
  }

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    chatError.style.display = 'none';

    const submitBtn = chatForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const message = chatMessageInput.value.trim();

    try {
      const res = await fetch('/admin/chat/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        chatMessageInput.value = '';
        chatMessageInput.focus();
        pollChat();
      } else {
        chatError.textContent = data.error || 'Something went wrong. Please try again.';
        chatError.style.display = 'block';
      }
    } catch (err) {
      chatError.textContent = 'Network error. Please try again.';
      chatError.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });

  pollChat();
  setInterval(pollChat, 3000);
})();
