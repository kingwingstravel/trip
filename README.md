# King Wings — travel guides

Each group: `g/<code>/` — page encrypted with the group PIN (AES-GCM, PBKDF2-SHA256 250 000). No plain text in this repo.

## Build and publish a group
```
python3 tools/build_guide.py GROUP.json /tmp/guide.html      # data -> page (template.html)
python3 tools/publish.py /tmp/guide.html CODE PIN "Title" . LANG   # encrypt -> g/CODE/
git add g/CODE && git commit -m "guide CODE" && git push
```
GROUP.json is private: never commit it here.
CODE — 8 chars `[a-hj-km-np-z2-9]`, PIN — 6 digits. Never change them for an existing group.

## GROUP.json
- `code`, `lang` (main language: id/en/ru/ms/ko…), `langs` (switcher, e.g. `["id","en"]`), `title`, `start` (YYYY-MM-DD, day 1)
- `countries` — route order, codes `kz uz kg tj tm`; `home` — country of our own guide (default `kz`)
- `guests` — `{en:"6 guests + 1 infant", id:"…"}`
- `logo` — `{mode:"kw"|"agent"|"two"|"kw+agent"|"none", files:["/path/logo.png"]}`
- `support` — 24/7 phone
- `guides` / `drivers` — per country: `{kz:{name,phone,car}, uz:{name}}` (phone only if allowed to show)
  - next to «Call» a messenger button by country: kz/kg/tj WhatsApp, uz Telegram, tm imo (copies the number). Override: `msg:"whatsapp"|"telegram"|"imo"`. Support 24/7 gets WhatsApp.
- `stays` — `[{city, name, from, to, nights, in, booking, addr, taxiRu, nameRu, map}]` (`from`/`to` = day index, 0-based; no `name` → "to be confirmed")
- `days` — `[{c, place, t, title, meet, plan:[["07:00",{en,id}]…], imp, tags:[{en,id}], meals:{l,d,o}, hotel, img, tNote, pill}]`
  - text = `{en:"…", id:"…"}`; `hotel` = stays index, `-1` = no hotel tonight, omitted = hide
  - `dep` — flight day: `{go:"06:30", fly:"09:30", flight:{en,id}}` (leave for the airport, flight time, flight text). Shows the "📅 Remind me about the flight" button (calendar file with 2 reminders: evening before 20:00 — or 09:00 the same day if leaving after 12:00 — and 1 hour before leaving). Without `dep` the page finds it itself from a plan line like "Transfer to … Airport".
  - `img`: night_arrival, road, flight, mountains, city, silkroad, train, madrasa
- `check` — `{en:[…], id:[…]}` before-you-go list
- `ui` — per-language overrides of any interface text (`weatherV`, `timeV`, `thanksSub`, `noHotel`, `nextT`, …). Languages without built-in texts fall back to English — put their texts here.
- `route`, `tripImg` — for the "share the whole trip" picture; `showMeals` (false hides meals); `photos` (link after the trip)

New group: `python3 tools/newcode.py .` prints a free CODE and a PIN.
Full sample (fictional contacts): `tools/example_group.json`.
Change check: `python3 tools/srchash.py SHEET_VALUES.json "<logo link>"` → compare with `g/CODE/src.sha`; write the new value there after publishing.

No prices, net rates, margins or partner names in GROUP.json. `build_guide.py` stops on sheet errors (#ERROR…) and warns about anything that looks like a price.
