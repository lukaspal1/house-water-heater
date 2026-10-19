// Client for the Tecomat Foxtrot web interface on the heat pump controller.
// Reads values from UVOD.XML and writes them back the same way the web UI does.
import { createHash } from 'node:crypto';

const decoder = new TextDecoder('windows-1250');

export class Tecomat {
  constructor({ host, user, pass }) {
    this.base = `http://${host}`;
    this.user = user;
    this.pass = pass;
    this.cookie = null;
    this.loggingIn = null;
  }

  async request(path, { method = 'GET', body } = {}) {
    const headers = { 'x-tecomat': 'data' };
    if (this.cookie) headers.Cookie = `SoftPLC=${this.cookie}`;
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await fetch(this.base + path, {
      method, body, headers, redirect: 'manual', signal: AbortSignal.timeout(8000),
    });
    const setCookie = res.headers.get('set-cookie');
    const m = setCookie && setCookie.match(/SoftPLC=(\d+)/);
    if (m) this.cookie = m[1];
    return res;
  }

  // The login page hashes sha1(cookie + password) in the browser before posting.
  async login() {
    this.cookie = null;
    await this.request('/syswww/login.xml');
    if (!this.cookie) throw new Error('Controller did not issue a session cookie');
    const hash = createHash('sha1').update(this.cookie + this.pass).digest('hex');
    const body = `USER=${encodeURIComponent(this.user)}&PASS=${hash}`;
    const res = await this.request('/syswww/LOGIN.XML', { method: 'POST', body });
    const text = await res.text();
    if (/<ACER VALUE="1"/.test(text)) throw new Error('Login rejected: wrong user name or password');
  }

  async ensureLogin() {
    this.loggingIn ??= this.login().finally(() => { this.loggingIn = null; });
    return this.loggingIn;
  }

  // Fetches a page, logging in again when the session has expired (302 to login).
  async fetchPage(page = 'UVOD.XML', opts) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.cookie) await this.ensureLogin();
      const res = await this.request('/' + page, opts);
      if (res.status === 200) {
        const xml = decoder.decode(await res.arrayBuffer());
        if (!xml.includes('<LOGIN>')) return xml;
      }
      this.cookie = null;
    }
    throw new Error(`Could not load ${page} after logging in`);
  }

  async read(page = 'UVOD.XML') {
    return parseInputs(await this.fetchPage(page));
  }

  // The web UI posts the whole "name=value" pair through encodeURIComponent.
  // The controller answers with the page's values after the write.
  async write(name, value, page = 'UVOD.XML') {
    return parseInputs(await this.fetchPage(page, { method: 'POST', body: encodeURIComponent(`${name}=${value}`) }));
  }

  // Presses an arrow button: sets it to 1 and lets the controller step the value
  // and clear the button. Clears it ourselves if the controller has not.
  async pulse(name, page) {
    let values = await this.write(name, 1, page);
    if (values[name] === '1') {
      await new Promise((r) => setTimeout(r, 300));
      values = await this.read(page);
      if (values[name] === '1') values = await this.write(name, 0, page);
    }
    return values;
  }
}

function parseInputs(xml) {
  const values = {};
  for (const [, name, value] of xml.matchAll(/<INPUT NAME="([^"]+)" VALUE="([^"]*)"/g)) {
    values[name] = value;
  }
  return values;
}
