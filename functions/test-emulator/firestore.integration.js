const test = require('node:test');
const assert = require('node:assert/strict');
const { deleteApp, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { createFirestoreRepository } = require('../firestore-repository');

test('el adaptador persiste el ciclo completo de un chat en Firestore', async (context) => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Esta prueba requiere el emulador de Firestore');
  const app = initializeApp({ projectId: 'rio-en-alerta-sanfernando' }, `integration-${process.pid}`);
  context.after(() => deleteApp(app));
  const db = getFirestore(app);
  const repository = createFirestoreRepository({ db, FieldValue });
  const chat = { id: 987654, first_name: 'Integración', username: 'integracion_test' };

  await repository.touchChat(chat, '/start', { isStart: true });
  let stored = await repository.getChat(chat.id);
  assert.equal(stored.chatId, chat.id);
  assert.equal(stored.threshold, 2.5);
  assert.equal(stored.active, true);
  assert.equal(stored.lastCommand, '/start');
  assert.equal(typeof stored.joinedAt.toDate, 'function');
  const joinedAt = stored.joinedAt.toMillis();

  await repository.setThreshold(chat.id, 3.25);
  await repository.touchChat(chat, '/maximo', { isStart: false });
  stored = await repository.getChat(chat.id);
  assert.equal(stored.threshold, 3.25);
  assert.equal(stored.joinedAt.toMillis(), joinedAt);
  assert.equal(stored.lastCommand, '/maximo');

  await repository.setActive(chat.id, false);
  assert.equal((await repository.getChat(chat.id)).active, false);
  assert.deepEqual(await repository.listActiveChats(), []);

  await repository.setActive(chat.id, true);
  assert.equal((await repository.listActiveChats()).length, 1);

  const observation = { value: 3.4, date: '2026-08-14T14:00:00Z' };
  await repository.recordAlertSent({ id: String(chat.id), chatId: chat.id, threshold: 3.25 }, observation, 123456);
  stored = await repository.getChat(chat.id);
  assert.equal(stored.lastSent, 123456);
  assert.equal(stored.lastAlertLevel, 3.4);
  const events = await db.collection('alertEvents').get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].data().threshold, 3.25);

  await repository.setSystemStatus({ ok: true, chatsProcessed: 1, alertsSent: 1, errors: 0 });
  const status = await db.collection('systemStatus').doc('checkRiver').get();
  assert.equal(status.data().ok, true);
  assert.equal(status.data().alertsSent, 1);
});
