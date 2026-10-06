export function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
// Remembered codes live in localStorage; others only for this tab session.
// Older builds kept the code in sessionStorage, so that is still read.
export function readToken() {
  try {
    return localStorage.getItem("cinema-access") || sessionStorage.getItem("cinema-access") || "";
  } catch {
    return "";
  }
}
export function saveToken(token, remember) {
  try {
    localStorage.removeItem("cinema-access");
    sessionStorage.removeItem("cinema-access");
    if (token) (remember ? localStorage : sessionStorage).setItem("cinema-access", token);
  } catch {}
}
export function tokenRemembered() {
  try {
    return !!localStorage.getItem("cinema-access") || !sessionStorage.getItem("cinema-access");
  } catch {
    return false;
  }
}
