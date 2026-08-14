const { DEFAULT_THRESHOLD } = require('./lib');
const {
  alertStateFromChat,
  normalizeAlertPreferences,
  normalizeAlertState,
} = require('./alert-machine');

function createFirestoreRepository({ db, FieldValue }) {
  const chats = db.collection('telegramChats');
  const velocityRef = db.collection('publicData').doc('velocity');
  const alertMachineRef = db.collection('systemStatus').doc('alertMachine');

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
        alertPreferences: normalizeAlertPreferences(previous.alertPreferences),
        alertState: alertStateFromChat(previous),
        dailySummary: Boolean(previous.dailySummary),
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
      const update = {
        threshold,
        active: true,
        alertState: {
          ...normalizeAlertState(snapshot.data()?.alertState),
          heightCondition: 'unknown',
        },
      };
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

  async function listDailySummaryChats() {
    const snapshot = await chats.where('dailySummary', '==', true).get();
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }

  async function setDailySummary(chatId, enabled) {
    await chats.doc(String(chatId)).set({ dailySummary: enabled }, { merge: true });
  }

  async function setAlertPreference(chatId, key, enabled) {
    const ref = chats.doc(String(chatId));
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const preferences = normalizeAlertPreferences(snapshot.data()?.alertPreferences);
      if (!Object.hasOwn(preferences, key)) throw new RangeError('Tipo de aviso desconocido');
      preferences[key] = Boolean(enabled);
      transaction.set(ref, { alertPreferences: preferences }, { merge: true });
      return preferences;
    });
  }

  async function claimDailySummary(chatId, dateKey) {
    const ref = chats.doc(String(chatId));
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!data?.dailySummary || data.lastSummaryDate === dateKey) return false;
      transaction.set(ref, {
        lastSummaryDate: dateKey,
        lastSummaryAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });
  }

  async function saveAlertState(chatId, state) {
    await chats.doc(String(chatId)).set({
      alertState: normalizeAlertState(state),
      alertStateUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async function recordAlertsSent(chat, current, state, events, sentAt) {
    const ref = chats.doc(String(chat.id ?? chat.chatId));
    const batch = db.batch();
    batch.update(ref, {
      alertState: normalizeAlertState(state),
      alertStateUpdatedAt: FieldValue.serverTimestamp(),
      lastSent: sentAt,
      lastAlertAt: FieldValue.serverTimestamp(),
      lastAlertLevel: current.value,
      lastAlertTypes: events.map((event) => event.type),
    });
    events.forEach((event) => {
      batch.set(db.collection('alertEvents').doc(), {
        chatId: chat.chatId,
        type: event.type,
        level: current.value,
        threshold: chat.threshold,
        observedAt: current.date,
        speedMetersPerHour: Number.isFinite(event.speedMetersPerHour) ? event.speedMetersPerHour : null,
        sentAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }

  async function claimObservation(observedAt) {
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(alertMachineRef);
      if (snapshot.data()?.lastObservationAt === observedAt) return false;
      transaction.set(alertMachineRef, {
        lastObservationAt: observedAt,
        claimedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });
  }

  async function setSystemStatus(status) {
    await db.collection('systemStatus').doc('checkRiver').set({
      ...status,
      checkedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async function getVelocityData() {
    const snapshot = await velocityRef.get();
    return snapshot.exists ? snapshot.data() : null;
  }

  async function setVelocityStatistics(statistics) {
    await velocityRef.set({
      statistics,
      calculatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async function saveVelocityDetectionIfNew(detection) {
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(velocityRef);
      if (snapshot.data()?.current?.observedAt === detection.observedAt) return false;
      transaction.set(velocityRef, {
        current: detection,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });
  }

  return {
    getChat,
    getVelocityData,
    claimObservation,
    claimDailySummary,
    listActiveChats,
    listDailySummaryChats,
    recordAlertsSent,
    saveAlertState,
    saveVelocityDetectionIfNew,
    setActive,
    setAlertPreference,
    setDailySummary,
    setSystemStatus,
    setThreshold,
    setVelocityStatistics,
    touchChat,
  };
}

module.exports = { createFirestoreRepository };
