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
  assert.equal(stored.dailySummary, false);
  assert.deepEqual(stored.alertPreferences, {
    height: true,
    rapidRise: false,
    rapidFall: false,
    recovery: false,
  });
  assert.equal(stored.alertState.heightCondition, 'unknown');
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

  await repository.setDailySummary(chat.id, true);
  assert.equal((await repository.listDailySummaryChats()).length, 1);
  assert.equal(await repository.claimDailySummary(chat.id, '2026-08-14'), true);
  assert.equal(await repository.claimDailySummary(chat.id, '2026-08-14'), false);
  assert.equal(await repository.claimDailySummary(chat.id, '2026-08-15'), true);

  const preferences = await repository.setAlertPreference(chat.id, 'rapidRise', true);
  assert.equal(preferences.rapidRise, true);
  assert.equal((await repository.getChat(chat.id)).alertPreferences.rapidRise, true);

  assert.equal(await repository.claimObservation('2026-08-14T14:00:00Z'), true);
  assert.equal(await repository.claimObservation('2026-08-14T14:00:00Z'), false);
  assert.equal(await repository.claimObservation('2026-08-14T15:00:00Z'), true);

  const observation = { value: 3.4, date: '2026-08-14T14:00:00Z' };
  const alertState = {
    heightCondition: 'above', velocityCondition: 'rapid-rise', lastObservationAt: observation.date,
  };
  await repository.recordAlertsSent(
    { id: String(chat.id), chatId: chat.id, threshold: 3.25 },
    observation,
    alertState,
    [
      { type: 'height' },
      { type: 'rapidRise', speedMetersPerHour: 0.4 },
    ],
    123456,
  );
  stored = await repository.getChat(chat.id);
  assert.equal(stored.lastSent, 123456);
  assert.equal(stored.lastAlertLevel, 3.4);
  const events = await db.collection('alertEvents').get();
  assert.equal(stored.alertState.velocityCondition, 'rapid-rise');
  assert.deepEqual(stored.lastAlertTypes, ['height', 'rapidRise']);
  assert.equal(events.size, 2);
  assert.equal(events.docs[0].data().threshold, 3.25);
  assert.deepEqual(events.docs.map((document) => document.data().type).sort(), ['height', 'rapidRise']);

  await repository.setSystemStatus({ ok: true, chatsProcessed: 1, alertsSent: 1, errors: 0 });
  const status = await db.collection('systemStatus').doc('checkRiver').get();
  assert.equal(status.data().ok, true);
  assert.equal(status.data().alertsSent, 1);

  const statistics = {
    sufficient: true,
    p90Ascent: 0.33,
    p90Descent: 0.16,
    validIntervalCount: 8612,
  };
  await repository.setVelocityStatistics(statistics);
  assert.deepEqual((await repository.getVelocityData()).statistics, statistics);
  const detection = {
    code: 'rapid-rise', observedAt: '2026-08-14T14:00:00', speedMetersPerHour: 0.4,
  };
  assert.equal(await repository.saveVelocityDetectionIfNew(detection), true);
  assert.equal(await repository.saveVelocityDetectionIfNew(detection), false);
  assert.equal((await repository.getVelocityData()).current.code, 'rapid-rise');

  const firstHistory = [
    { d: '2026-08-13T12:00:00Z', v: 0.8 },
    { d: '2026-08-14T12:00:00Z', v: 0.9 },
  ];
  const secondHistory = [
    { d: '2026-08-14T12:00:00Z', v: 0.95 },
    { d: '2026-08-15T12:00:00Z', v: 1.05 },
  ];
  await repository.setPublicForecast([{ d: '2026-08-16T12:00:00Z', v: 1.2 }]);
  await repository.mergePublicHistory(52, firstHistory, new Date('2026-08-15T13:00:00Z'));
  await repository.mergePublicHistory(52, secondHistory, new Date('2026-08-15T13:00:00Z'));

  const forecast = await repository.getPublicForecast();
  assert.deepEqual(forecast.rows, [{ d: '2026-08-16T12:00:00Z', v: 1.2 }]);
  assert.equal(typeof forecast.updatedAt.toDate, 'function');
  const [history] = await repository.getPublicHistories([52, 49]);
  assert.equal(history.siteCode, 52);
  assert.deepEqual(history.rows, [
    { d: '2026-08-13T12:00:00Z', v: 0.8 },
    { d: '2026-08-14T12:00:00Z', v: 0.95 },
    { d: '2026-08-15T12:00:00Z', v: 1.05 },
  ]);
  assert.equal(typeof history.updatedAt.toDate, 'function');
});
