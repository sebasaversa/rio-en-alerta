import { auth, db } from "./firebase.js";
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithRedirect,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const elements = {
  loginPanel: document.querySelector("#login-panel"),
  loginMessage: document.querySelector("#login-message"),
  signIn: document.querySelector("#sign-in"),
  signOut: document.querySelector("#sign-out"),
  dashboard: document.querySelector("#dashboard"),
  reload: document.querySelector("#reload"),
  schedulerStatus: document.querySelector("#scheduler-status"),
  schedulerDetail: document.querySelector("#scheduler-detail"),
  metricTotal: document.querySelector("#metric-total"),
  metricSubscribed: document.querySelector("#metric-subscribed"),
  metricActive: document.querySelector("#metric-active"),
  metricAlerts: document.querySelector("#metric-alerts"),
  userSearch: document.querySelector("#user-search"),
  usersBody: document.querySelector("#users-body"),
  usersMessage: document.querySelector("#users-message"),
};

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
let users = [];

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(date) : "—";
}

function formatLevel(value) {
  return Number.isFinite(Number(value))
    ? `${Number(value).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`
    : "—";
}

function userName(user) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return fullName || (user.username ? `@${user.username}` : "Sin nombre");
}

function formatAlertPreferences(value = {}) {
  const preferences = {
    height: typeof value.height === "boolean" ? value.height : true,
    rapidRise: Boolean(value.rapidRise),
    rapidFall: Boolean(value.rapidFall),
    recovery: Boolean(value.recovery),
  };
  const labels = {
    height: "Altura",
    rapidRise: "Crecida",
    rapidFall: "Bajante",
    recovery: "Recuperación",
  };
  const active = Object.entries(preferences)
    .filter(([, enabled]) => enabled)
    .map(([key]) => labels[key]);
  return active.length ? active.join(", ") : "Ninguno";
}

function renderUsers() {
  const term = elements.userSearch.value.trim().toLocaleLowerCase("es-AR");
  const visible = users.filter((user) => {
    const searchable = `${userName(user)} ${user.username ?? ""}`.toLocaleLowerCase("es-AR");
    return searchable.includes(term);
  });
  elements.usersBody.innerHTML = visible.map((user) => `
    <tr>
      <td><strong>${escapeHtml(userName(user))}</strong>${user.username ? `<small>@${escapeHtml(user.username)}</small>` : ""}</td>
      <td>${formatDate(user.joinedAt ?? user.firstSeenAt)}</td>
      <td>${formatDate(user.lastActiveAt)}</td>
      <td>${formatLevel(user.threshold)}</td>
      <td>${escapeHtml(formatAlertPreferences(user.alertPreferences))}</td>
      <td><span class="admin-pill ${user.active ? "is-active" : ""}">${user.active ? "Activa" : "Pausada"}</span></td>
    </tr>`).join("");
  elements.usersMessage.textContent = visible.length
    ? `${visible.length} usuario${visible.length === 1 ? "" : "s"}.`
    : "No hay usuarios que coincidan con la búsqueda.";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

async function loadDashboard() {
  elements.reload.disabled = true;
  elements.usersMessage.textContent = "Actualizando…";
  const [chatSnapshot, statusSnapshot, alertSnapshot] = await Promise.all([
    getDocs(collection(db, "telegramChats")),
    getDoc(doc(db, "systemStatus", "checkRiver")),
    getDocs(query(collection(db, "alertEvents"), orderBy("sentAt", "desc"), limit(500))),
  ]);
  users = chatSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    .sort((left, right) => (asDate(right.lastActiveAt)?.getTime() ?? 0) - (asDate(left.lastActiveAt)?.getTime() ?? 0));
  const activeCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  elements.metricTotal.textContent = String(users.length);
  elements.metricSubscribed.textContent = String(users.filter((user) => user.active).length);
  elements.metricActive.textContent = String(users.filter((user) => (asDate(user.lastActiveAt)?.getTime() ?? 0) >= activeCutoff).length);
  elements.metricAlerts.textContent = alertSnapshot.size === 500 ? "500+" : String(alertSnapshot.size);
  if (statusSnapshot.exists()) {
    const status = statusSnapshot.data();
    elements.schedulerStatus.textContent = status.ok ? "Operativa" : "Con errores";
    elements.schedulerStatus.className = status.ok ? "is-ok" : "is-error";
    elements.schedulerDetail.textContent = `Última revisión: ${formatDate(status.checkedAt)} · ${status.chatsProcessed ?? 0} chats · ${status.alertsSent ?? 0} alertas.`;
  }
  renderUsers();
  elements.reload.disabled = false;
}

async function showUnauthorized(user) {
  elements.loginPanel.classList.remove("is-hidden");
  elements.dashboard.classList.add("is-hidden");
  elements.signOut.classList.remove("is-hidden");
  elements.signIn.classList.add("is-hidden");
  elements.loginMessage.textContent = `La cuenta ${user.email ?? "seleccionada"} todavía no está autorizada. Identificador: ${user.uid}`;
}

elements.signIn.addEventListener("click", async () => {
  elements.signIn.disabled = true;
  elements.loginMessage.textContent = "Redirigiendo a Google…";
  try {
    await signInWithRedirect(auth, provider);
  } catch (error) {
    elements.signIn.disabled = false;
    elements.loginMessage.textContent = `No se pudo ingresar: ${error.message}`;
  }
});

elements.signOut.addEventListener("click", () => signOut(auth));
elements.reload.addEventListener("click", () => loadDashboard().catch(handleLoadError));
elements.userSearch.addEventListener("input", renderUsers);

function handleLoadError(error) {
  elements.usersMessage.textContent = `No se pudieron cargar los datos: ${error.message}`;
  elements.reload.disabled = false;
}

getRedirectResult(auth).catch((error) => {
  elements.loginMessage.textContent = `No se pudo ingresar: ${error.message}`;
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    elements.loginPanel.classList.remove("is-hidden");
    elements.dashboard.classList.add("is-hidden");
    elements.signOut.classList.add("is-hidden");
    elements.signIn.classList.remove("is-hidden");
    elements.signIn.disabled = false;
    elements.loginMessage.textContent = "";
    return;
  }
  const authorization = await getDoc(doc(db, "adminUsers", user.uid)).catch(() => null);
  if (!authorization?.exists() || authorization.data().active !== true) {
    await showUnauthorized(user);
    return;
  }
  elements.loginPanel.classList.add("is-hidden");
  elements.dashboard.classList.remove("is-hidden");
  elements.signOut.classList.remove("is-hidden");
  await loadDashboard().catch(handleLoadError);
});
