const { DEFAULT_THRESHOLD } = require('./lib');

function createFirestoreRepository({ db, FieldValue }) {
  const chats = db.collection('telegramChats');

  async function touchChat(chat, command, { isStart = false } = {}) {
    const ref = chats.doc(String(chat.id));
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const previous = snapshot.data() ?? {};
      const update = {
        chatId: chat.id,
        firstName: chat.first_name ?? null,
        lastName: chat.last_name ?? null,
        username: chat.username ?? null,
        threshold: Number.isFinite(previous.threshold) ? previous.threshold : DEFAULT_THRESHOLD,
        active: isStart ? true : Boolean(previous.active),
        firstSeenAt: previous.firstSeenAt ?? FieldValue.serverTimestamp(),
        lastActiveAt: FieldValue.serverTimestamp(),
        lastCommand: command || 'unknown',
      };
      if (isStart && !previous.joinedAt) update.joinedAt = FieldValue.serverTimestamp();
      if (!snapshot.exists) update.lastSent = 0;
      transaction.set(ref, update, { merge: true });
    });
  }

  async function getChat(chatId) {
    const snapshot = await chats.doc(String(chatId)).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }

  async function setThreshold(chatId, threshold) {
    const ref = chats.doc(String(chatId));
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const update = { threshold, active: true };
      if (!snapshot.data()?.joinedAt) update.joinedAt = FieldValue.serverTimestamp();
      transaction.set(ref, update, { merge: true });
    });
  }

  async function setActive(chatId, active) {
    const ref = chats.doc(String(chatId));
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const update = { active };
      if (active && !snapshot.data()?.joinedAt) update.joinedAt = FieldValue.serverTimestamp();
      transaction.set(ref, update, { merge: true });
    });
  }

  async function listActiveChats() {
    const snapshot = await chats.where('active', '==', true).get();
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }

  async function recordAlertSent(chat, current, sentAt) {
    const ref = chats.doc(String(chat.id ?? chat.chatId));
    const eventRef = db.collection('alertEvents').doc();
    const batch = db.batch();
    batch.update(ref, {
      lastSent: sentAt,
      lastAlertAt: FieldValue.serverTimestamp(),
      lastAlertLevel: current.value,
    });
    batch.set(eventRef, {
      chatId: chat.chatId,
      level: current.value,
      threshold: chat.threshold,
      observedAt: current.date,
      sentAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  }

  async function setSystemStatus(status) {
    await db.collection('systemStatus').doc('checkRiver').set({
      ...status,
      checkedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return {
    getChat,
    listActiveChats,
    recordAlertSent,
    setActive,
    setSystemStatus,
    setThreshold,
    touchChat,
  };
}

module.exports = { createFirestoreRepository };
