# Home Heating dashboard

A phone-friendly dashboard for the house heat pump / water heater. The controller is a
Tecomat Foxtrot PLC whose web UI lives at `http://192.168.1.99/UVOD.XML`. This app logs
into it, reads the values every 15 seconds, saves a history point every minute, and can
switch the heat pump and hot water on or off.

## Setup

Requires Node.js 22+. No packages to install.

Create `.env` (git-ignored):

```
TECOMAT_HOST=192.168.1.99
TECOMAT_USER=your_username
TECOMAT_PASS=your_password
```

Run:

```
npm start
```

Open http://localhost:8080. History is stored in `data/history.jsonl`.

## How the controller works

- `GET /UVOD.XML` with header `x-tecomat: data` returns `<INPUT NAME="…" VALUE="…">` pairs.
- Writing a value: `POST /UVOD.XML` with body `encodeURIComponent("name=value")`.
- Login: get a `SoftPLC` cookie from `/syswww/login.xml`, then `POST /syswww/LOGIN.XML`
  with `USER` and `PASS = sha1(cookie + password)`.

Known values are listed in `FIELDS` and `SWITCHES` in [src/server.js](src/server.js).
