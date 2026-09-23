import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  BROWSER_PATH,
  BROWSER_PROFILE_DIR,
  DATA_DIR,
  LOGIN_TIMEOUT_MS,
  SESSION_FILE,
  log,
} from "./config.js";
import { CookieJar } from "./cookies.js";
import { fetchUserStatus } from "./api.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Saved session
// ---------------------------------------------------------------------------

export function loadSession() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    const jar = new CookieJar(data.cookies || []);
    return jar.size > 0 ? jar : null;
  } catch {
    return null;
  }
}

export function saveSession(jar) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ savedAt: new Date().toISOString(), cookies: jar }), {
    mode: 0o600,
  });
}

export function clearSession() {
  fs.rmSync(SESSION_FILE, { force: true });
}

// ---------------------------------------------------------------------------
// Email + password login (optional fallback, e.g. for headless machines)
// ---------------------------------------------------------------------------

export async function passwordLogin(email, password) {
  const jar = new CookieJar();

  const tokenResponse = await fetch(`${BASE_URL}/main/csrf_token`, { headers: { Cookie: jar.header() } });
  jar.update(tokenResponse);
  const tokenMatch = (await tokenResponse.text()).match(/CSRF_TOKEN\s*=\s*"([^"]+)"/i);
  if (!tokenMatch) throw new Error("Piazza login failed: couldn't get a CSRF token.");

  let response = await fetch(`${BASE_URL}/class`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
    body: new URLSearchParams({
      from: "/signup",
      email,
      password,
      remember: "on",
      csrf_token: tokenMatch[1],
    }),
    redirect: "manual",
  });
  jar.update(response);

  // Follow redirects by hand so cookies set along the way are kept.
  for (let hops = 0; hops < 5 && response.status >= 300 && response.status < 400; hops++) {
    const location = response.headers.get("location");
    if (!location) break;
    response = await fetch(new URL(location, BASE_URL), { headers: { Cookie: jar.header() }, redirect: "manual" });
    jar.update(response);
  }

  const errorMatch = (await response.text()).match(/var\s+ERROR_MSG\s*=\s*"([^"]*)"/i);
  if (errorMatch && errorMatch[1].trim()) {
    throw new Error(`Piazza login failed: ${errorMatch[1].trim()}`);
  }
  if (!(await fetchUserStatus(jar))) {
    throw new Error(
      "Piazza login failed. Check PIAZZA_EMAIL and PIAZZA_PASSWORD. " +
        "If you sign in to Piazza through your school (SSO), remove those settings to use browser login instead."
    );
  }
  return jar;
}

// ---------------------------------------------------------------------------
// Browser login (default): open a real browser window, let the user log in
// however they normally do (password, school SSO, 2FA), then keep the cookies.
// ---------------------------------------------------------------------------

function browserCandidates() {
  if (process.platform === "darwin") {
    const apps = [
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "Brave Browser.app/Contents/MacOS/Brave Browser",
      "Chromium.app/Contents/MacOS/Chromium",
    ];
    const roots = ["/Applications", path.join(process.env.HOME || "", "Applications")];
    return roots.flatMap((root) => apps.map((app) => path.join(root, app)));
  }

  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
    const apps = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ];
    return roots.flatMap((root) => apps.map((app) => path.join(root, app)));
  }

  const names = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser",
  ];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return dirs.flatMap((dir) => names.map((name) => path.join(dir, name)));
}

export function findBrowser() {
  if (BROWSER_PATH) return BROWSER_PATH;
  return browserCandidates().find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function isPiazzaCookie(cookie) {
  const host = new URL(BASE_URL).hostname;
  const domain = cookie.domain.replace(/^\./, "");
  return host === domain || host.endsWith(`.${domain}`);
}

export async function browserLogin() {
  const executablePath = findBrowser();
  if (!executablePath) {
    throw new Error(
      "Couldn't find Chrome, Edge, Brave or Chromium for Piazza login. " +
        "Set PIAZZA_BROWSER_PATH to your browser's executable, or set PIAZZA_EMAIL and PIAZZA_PASSWORD."
    );
  }

  const { default: puppeteer } = await import("puppeteer-core");
  log(`Opening ${executablePath} for Piazza login`);
  const browser = await puppeteer.launch({
    executablePath,
    headless: process.env.PIAZZA_BROWSER_HEADLESS === "1", // tests only
    userDataDir: BROWSER_PROFILE_DIR, // remembers SSO logins so re-login is quick
    defaultViewport: null,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1100,850",
      // Chrome refuses to start as root (e.g. in containers) with its sandbox on.
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ],
  });

  let closed = false;
  browser.on("disconnected", () => {
    closed = true;
  });

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.goto(`${BASE_URL}/account/login`).catch(() => {});

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let lastCookies = "";
    while (Date.now() < deadline) {
      if (closed) throw new Error("The Piazza login window was closed before login finished.");

      let cookies;
      try {
        cookies = (await browser.cookies()).filter(isPiazzaCookie);
      } catch {
        await sleep(500); // browser is closing; the next loop iteration reports it
        continue;
      }

      // Only re-check the session when the cookies change.
      const key = cookies.map((c) => `${c.name}=${c.value}`).sort().join(";");
      if (key && key !== lastCookies) {
        lastCookies = key;
        const jar = new CookieJar(cookies.map(({ name, value, expires }) => ({ name, value, expires })));
        if (await fetchUserStatus(jar)) {
          log("Piazza login succeeded");
          return jar;
        }
      }
      await sleep(1500);
    }
    throw new Error("Timed out waiting for Piazza login.");
  } finally {
    await browser.close().catch(() => {});
  }
}
