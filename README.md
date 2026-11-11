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
- `people` — personal part (optional). First open shows «Who are you?» with the names; the tourist taps own name once, the phone remembers it (more people can be added on one phone; «I am the guide or agent» skips). `[{id:"p01", name:"Ahmad Fauzi", rooms:{"0":"512","2":"1108"}, tickets:[{day:1, text:"HY 763 · Seat 14A · Booking K7XQ2M"}], msg:{en,id}, notes:[{day:3, text:{en,id}}]}]`
  - `rooms` key = stays index; shown on Today, tonight's hotel and Hotel tab. `tickets` shown on that day and in Help. `msg` every day, `notes` on their day (no `day` = every day).
  - `staffCode` — 6 digits (sheet B26, `tools/staffcode.py PIN` makes one, never equal to the PIN), required when `people` is set. «I am the guide or agent» asks for it once; then the phone shows rooms and tickets of the whole group. Only its hash goes into the page.
  - Name conflict check: `claimUrl` (or `tools/claim_url.txt`, one line — the bot web app …/exec from sheet «Настройки бота» B1 of «Взаиморасчёты King Wings»). The page tells the bot «this phone chose p03» (no names); if the same name is on two phones, both phones get «Who are you?» again until each taps own name. «👤 Choose my name again» is on Today under «For you».
  - NO passport numbers, dates of birth or ticket images with passport data — `build_guide.py` stops on anything passport-like.
- `ui` — per-language overrides of any interface text (`weatherV`, `timeV`, `thanksSub`, `noHotel`, `nextT`, …). Languages without built-in texts fall back to English — put their texts here.
- Daily memo (🧳 on Today): `build_guide.py` fills `days[i].wx` = `[{n,lat,lon,m}]` (place for the forecast; `m:1` mountains) and `days[i].holy` from hotel city and plan text. The phone fetches a free forecast (open-meteo, no key) after the page is shown, caches it 3 h; offline → `ui.weatherV`. What to wear / take is chosen from the forecast. On the day the group enters a country the memo lists its border rules (`dn_<country>` in the template, checked 11.11.2026); Help shows all of them.
- `route`, `tripImg` — for the "share the whole trip" picture; `showMeals` (false hides meals); `photos` (link after the trip)

New group: `python3 tools/newcode.py .` prints a free CODE and a PIN.
Full sample (fictional contacts): `tools/example_group.json`.
Change check: `python3 tools/srchash.py SHEET_VALUES.json "<logo link>"` → compare with `g/CODE/src.sha`; write the new value there after publishing.

No prices, net rates, margins or partner names in GROUP.json. `build_guide.py` stops on sheet errors (#ERROR…) and warns about anything that looks like a price.
