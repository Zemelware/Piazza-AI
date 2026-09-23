// Minimal cookie jar for a single site (piazza.com). Cookies are stored as
// plain objects so they can be written to disk and loaded from the browser.

export class CookieJar {
  constructor(cookies = []) {
    this.cookies = new Map();
    for (const cookie of cookies) this.set(cookie);
  }

  set({ name, value, expires }) {
    const expired = typeof expires === "number" && expires > 0 && expires * 1000 < Date.now();
    if (!value || expired) {
      this.cookies.delete(name);
    } else {
      this.cookies.set(name, { name, value, expires: expires ?? -1 });
    }
  }

  get(name) {
    return this.cookies.get(name)?.value;
  }

  get size() {
    return this.cookies.size;
  }

  header() {
    return [...this.cookies.values()].map((c) => `${c.name}=${c.value}`).join("; ");
  }

  // Apply Set-Cookie headers from a fetch Response.
  update(response) {
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const raw of setCookies) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const cookie = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
      for (const attr of attrs) {
        const [key, val = ""] = attr.split("=");
        const k = key.trim().toLowerCase();
        if (k === "max-age") {
          cookie.expires = Date.now() / 1000 + Number(val);
        } else if (k === "expires" && cookie.expires === undefined) {
          const time = Date.parse(val.trim());
          if (!Number.isNaN(time)) cookie.expires = time / 1000;
        }
      }
      this.set(cookie);
    }
  }

  toJSON() {
    return [...this.cookies.values()];
  }
}
