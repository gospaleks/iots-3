# Tehnički izveštaj — MQTT vs Kafka za IoT mikro-servise upravljane događajima

**IoTS Projekat 2** · Komparativna evaluacija **MQTT (Eclipse Mosquitto)** i
**Apache Kafka (KRaft)** kao messaging osnove kontejnerizovanog, događajima upravljanog IoT
pipeline-a, kroz četiri eksperimentalna scenarija (masivna ingestija, kvar veza, burst
opterećenje, kašnjenje upozorenja).

> Reproduktivnost: svaki broj u tabelama ispod prati se do CSV-a u `results/`,
> produkovanih skriptama u [`benchmarks/`](../../benchmarks/). Okruženje: WSL2 + Docker
> Desktop, single-node. Vidi [README](../../README.md), [ODLUKE](ODLUKE.md),
> [ZAHTEVI](ZAHTEVI.md) i narativne [notes/](../notes/).

---

## 1. Opis sistema

Tri mikro-servisa komuniciraju **isključivo** kroz posrednika:

```
ingestion (NestJS)  ──publish──▶  posrednik (Mosquitto | Kafka)  ──┬──▶  storage (NestJS) ──▶ TimescaleDB
                                                                    └──▶  analytics (FastAPI) ──▶ upozorenja
```

- **Ingestion (Unos)** — jedini publisher; simulator uređaja koji replayuje pravi sensor
  dataset (ili generiše unutar per-profil opsega), stampajući svaku poruku sa
  per-device `seq` i `sent_at_ms` vremenskim pečatom slanja. Podržava burst mod.
- **Storage (Skladištenje)** — jedini DB writer; pretplaćuje se, prati integritet per-device
  `seq` i transportno kašnjenje, i piše u TimescaleDB hypertable u `DIRECT` ili `BATCH`
  (size-OR-time flush) modu sa idempotentnim `ON CONFLICT` unosima.
- **Analytics (Analitika)** — FastAPI servis koji pokreće 10s tumbling window nad tokom,
  emitujući `[ALERT]`/`[INFO]` sažetke i hvatajući dvostruko kašnjenje.

**Arhitekturni kamen temeljac — jedna broker apstrakcija, nula duplikacije.** Svaki servis
zavisi samo od `BrokerAdapter` interfejsa (`publish` / `subscribe`); `MqttAdapter`
(mqtt.js / aiomqtt) i `KafkaAdapter` (kafkajs / aiokafka) ga implementiraju, a fabrika
ključovana na `BROKER_TYPE` je *jedini* kod koji zna da oba posrednika postoje. Promena
posrednika je **jedna env promenljiva + jedan Docker Compose profil** — bez promene koda.
Dva NestJS servisa dele adapter putem npm workspaces; Python servis reimplementira isti
pisani kontrakt (`shared/message-contract.md`) — paritet između jezika, ne duplikacija.
(Vidi [notes/01-broker-abstraction.md](../notes/01-broker-abstraction.md).)

**Infrastruktura.** Docker Compose sa profilima: `timescaledb` uvek aktivan; `mqtt` →
Mosquitto; `kafka` → Kafka u **KRaft** modu (bez ZooKeeper-a); `app` → tri servisa;
`tools` → Kafka UI (dev). TimescaleDB čuva hypertable na `ts`, PK `(ts, device)`.

---

## 2. Metodologija

| Scenario | Driver | Zašto | Ključne metrike |
|----------|--------|-------|-----------------|
| A — masivna ingestija | **emqtt-bench** / **kafka-producer-perf-test** (mandatni bench alati) | sirovi tavan posrednika | propusnost, gubitak, CPU, RAM |
| B — kvar veza | projektni simulator (odspajanje publishera **i** subscribera) | zahteva adresovane, uređene poruke; rez subscribera vežba mehanizam posrednika | izgubljene poruke, oporavak, duplikati |
| C — burst opterećenje | projektni simulator (`POST /burst`) | kontrolisani 50→5000 skok | zaostalost, gubitak, oporavak |
| D — kašnjenje upozorenja | projektni simulator | zahteva `sent_at_ms` za pravo kašnjenje | transportno + event-to-alert kašnjenje |

Korišćenje resursa je obavezni `docker stats` baseline, uzorkovan sa
`collect-docker-stats.sh`. Gubitak u B/C čita se direktno iz per-device `seq` trackera
servisa za skladištenje (praznina = izgubljena, ponavljanje = duplikat). Vidi
[notes/06-benchmark-harness.md](../notes/06-benchmark-harness.md) za dizajn harness-a.

**Okruženje.** WSL2 (Linux 5.15) + Docker Desktop, single node; TimescaleDB
`2.17.2-pg16`, Mosquitto 2, Kafka `3.8.1` (KRaft). Single-node, single-partition osim ako
nije naznačeno — apsolutni brojevi su dev-box cifre; **MQTT-vs-Kafka poređenje** je
rezultat od interesa.

---

## 3. Tabela poređenja performansi (ZAHTEVI §8.4)

Izmerjeno na ovom dev box-u. Brojevi uređaja **100** i **1000** su pokrenuti za svaku
QoS/acks konfiguraciju; **10000** nije pokrenuto na single WSL2 box-u (ograničenja
klijenta/FD i memorije) — komande za produkciju tih redova su u [benchmarks/README.md](../../benchmarks/README.md).
MQTT p95 kašnjenje je označeno kao `NA` jer emqtt-bench pub mod izveštava o propusnosti, ne
per-message kašnjenju (per-message transportno kašnjenje meri se umesto toga u Scenariju D);
Kafka p95 dolazi iz kafka-producer-perf-test.

CPU je prosek `docker stats` kontejnera posrednika tokom pokretanja (može preći 100% =
višejezgarni); RAM je prosečna rezidentna memorija. Propusnost je dostignuta vršna brzina.

| Posrednik | Konfiguracija | Uređaji | Propusnost (poruci/s) | p95 Kašnjenje (ms) | CPU (%) | RAM (MB) | Gubitak (%) |
|-----------|-----------|---------|-----------------------|--------------------|---------|----------|-------------|
| MQTT   | QoS 0   | 100     | 10.642             | NA               | 2,0     | 4,5      | 0,00     |
| MQTT   | QoS 0   | 1000    | 69.840             | NA               | 21,0    | 4,7      | 0,00     |
| MQTT   | QoS 0   | 10000   | _nije pokrenuto (dev box)_ | —          | —       | —        | —        |
| MQTT   | QoS 1   | 100     | 5.335              | NA               | 3,9     | 4,5      | 0,00     |
| MQTT   | QoS 1   | 1000    | 33.019             | NA               | 31,5    | 4,3      | 0,00     |
| MQTT   | QoS 1   | 10000   | _nije pokrenuto (dev box)_ | —          | —       | —        | —        |
| MQTT   | QoS 2   | 100     | 5.321              | NA               | 11,7    | 4,2      | 0,07     |
| MQTT   | QoS 2   | 1000    | 21.463             | NA               | 45,1    | 5,4      | 0,53     |
| MQTT   | QoS 2   | 10000   | _nije pokrenuto (dev box)_ | —          | —       | —        | —        |
| Kafka  | acks=0  | 100     | 31.746             | 63               | 32,7    | 363,8    | 0,00     |
| Kafka  | acks=0  | 1000    | 130.378            | 296              | 63,1    | 396,4    | 0,00     |
| Kafka  | acks=0  | 10000   | _nije pokrenuto (dev box)_ | —          | —       | —        | —        |
| Kafka  | acks=1  | 100     | 33.445             | 56               | 46,5    | 395,0    | 0,00     |
| Kafka  | acks=1  | 1000    | 144.718            | 259              | 68,0    | 451,9    | 0,00     |
| Kafka  | acks=1  | 10000   | _nije pokrenuto (dev box)_ | —          | —       | —        | —        |
| Kafka  | acks=all| 100     | 26.738             | 127              | 31,0    | 443,3    | 0,00     |
| Kafka  | acks=all| 1000    | 135.685            | 271              | 33,9    | 446,1    | 0,00     |
| Kafka  | acks=all| 10000   | _nije pokrenuto (dev box)_ | —          | —       | —        | —        |

> Najupadljiviji broj je **RAM**: Mosquitto je ostao stabilan na **~4–5 MB** pod
> svakim opterećenjem, dok je Kafka sedela na **~360–580 MB** — otprilike **100× razlika**.
> Ta jedna kolona potkrepljuje oba odgovora na kritična pitanja u §5.

---

## 4. Nalazi scenarija

### Scenario A — masivna ingestija

Tri jasna efekta u podacima:

- **Propusnost: Kafka >> MQTT pri skali.** Sa 1000 producenata, Kafka je izdržala ~130–145k
  poruci/s naspram MQTT-ovih ~21–70k. Kafka-in batched, append-to-log producentski put
  napravljen je tačno za ovaj firehose; MQTT-ovi per-message QoS handshake-ovi koštaju
  propusnost.
- **Poluga pouzdanosti košta propusnost, na oba posrednika.** MQTT QoS 0 → 1 → 2 pao je
  ~70k → 33k → 21k poruci/s (1000 uređaja) kako je handshake postajao teži, i QoS 2 je čak
  pokazao mali gubitak (0,07–0,53%) gde jedan subscriber nije mogao da drži tempo pri vrhuncu.
  Kafka acks=all je bio nešto sporiji i višeg kašnjenja od acks=1/0 (čekanje na puni ISR) —
  porez na trajnost. Kafka gubitak ostao je 0 (trajni log).
- **Trošak resursa: 100× RAM razlika.** Mosquitto je koristio **~4–5 MB** tokom celog perioda;
  Kafka je koristila **~360–580 MB** i koristila više CPU jezgara (vrhovi 150–330%). Ovo je
  JVM + page-cache + log mehanizam — moć po cenu.

Zaključak: ako vam treba maksimalni trajni protok i možete platiti RAM, Kafka pobjeđuje;
ako vam treba skoro besplatni posrednik na malom čvoru i možete tolerisati at-most-once/at-least-once
semantiku, MQTT pobjeđuje.

### Scenario B — kvar ivičnih veza

Ovaj scenario pokrećemo u **dve varijante**, jer mesto gde prerežete žicu odlučuje šta
zapravo merite. Gubici/duplikati uvek dolaze iz per-device `seq` trackera servisa za
skladištenje (praznina = izgubljena, ponavljanje = redelivered). Pun grid pokreće
[`benchmarks/scenario-b-matrix.sh`](../../benchmarks/scenario-b-matrix.sh).

#### Varijanta 1 — odspojeni publisher (originalni test)

**Ingestion** (publisher) kontejner je mrežno odspajan na 30s, zatim ponovo priključen.

| Posrednik | Trajanje kvara | Izgubljene poruke (seq praznine) | Duplikati | Oporavak |
|-----------|----------------|----------------------------------|-----------|----------|
| MQTT      | 30s            | 0                                | 0         | flush baferisanog zaostalih |
| Kafka     | 30s            | 0                                | 0         | flush baferisanog zaostalih |

- **Oba preživljavaju bez gubitaka — ali iz razloga *client-side*, ne broker queuinga.**
  mqtt.js bufferuje odlazne poruke dok je offline i flushuje ih po ponovnom priključivanju;
  kafkajs retryuje `send()` sa backoff-om kroz prozor koji pokriva prekid. Publisherova
  sopstvena biblioteka maskira particiju, pa **ova varijanta meri klijenta, ne posrednika**, i
  dva steka izgledaju identično bez obzira na to šta posrednici zapravo rade ispod.

#### Varijanta 2 — odspojeni subscriber (ono što zahtevi zapravo traže)

> **Zašto odspajamo subscriber.** ZAHTEVI §7-B traži da pokažemo *izgubljene poruke,
> oporavak i duplikate* — tj. **mehanizam offline-dostave** posrednika: MQTT-ova
> persistent-session queue naspram Kafka-inog trajnog loga + consumer offseta. Odspajanje
> *publishera* (bukvalno čitanje zadatka) nikada ne vežba taj mehanizam, jer publisher
> biblioteka sama po sebi baferuje i replaya — oba posrednika tada trivijalno postižu 0/0
> i poređenje ne govori ništa. Mehanizam se aktivira tek kada **consumer** ode i mora da
> *nastavi*: tamo MQTT ili je queue-ovao-za-vas ili nije, a Kafka premotava na poslednji
> offset. Zato čuvamo publisher varijantu radi poštenja, ali **subscriber** varijanta je ta
> koja odgovara na pitanje. (Takođe smo smanjili MQTT keepalive na 10s za ova pokretanja
> kako bi 30s prekid zapravo premašio ga — inače Mosquitto i dalje veruje da je klijent
> konektovan i drži sve, skrivajući clean-vs-persistent razliku. Vidi
> [notes/07-scenario-b-redesign.md](../notes/07-scenario-b-redesign.md).)

**Storage** (subscriber) kontejner je odspajan dok ingestion nastavlja da objavljuje
(~1000 poruci/s). Za MQTT prelazimo session podešavanja koja odlučuju o njegovom ponašanju;
Kafka nema takvo podešavanje — log odlučuje.

| Posrednik | Varijanta (konfiguracija) | Trajanje kvara | Izgubljene poruke | Duplikati | Šta pokazuje |
|-----------|--------------------------|----------------|-------------------|-----------|--------------|
| MQTT  | persistent (`clean=false`, QoS 1, neograničen red) | 30s | **0**     | 0 | posrednik **queue-uje** za offline subscriber → bez gubitka |
| MQTT  | clean session (`clean=true`, QoS 1)                 | 30s | **31.000**| 0 | sesija odbačena pri odspajanju → sve tokom prekida je **odbačeno** |
| MQTT  | QoS 0 (`clean=false`, QoS 0)                        | 30s | **31.000**| 0 | QoS 0 se nikad ne queue-uje, čak ni za persistent sesiju → **odbačeno** |
| MQTT  | persistent + **ograničen** red (`max_queued=10000`) | 30s | **5.884** | 0 | posrednikov in-RAM red **prekoračen** → parcijalni gubitak |
| Kafka | consumer resume (podrazumevano)                      | 30s | **0**     | 1 | consumer se **nastavlja od poslednjeg potvrđenog offseta** → bez gubitka |
| Kafka | consumer resume, **dugački** prekid                  | 90s | **0**     | 1 | trajni log je **neovisan od dužine** → i dalje bez gubitka |

- **MQTT-ova pouzdanost u potpunosti je funkcija njegove session konfiguracije.** Sa persistent
  sesijom (stabilan client-id, `clean=false`, QoS ≥ 1) Mosquitto queue-uje poruke za
  odsutnog subscribera i dostavlja ih pri ponovnom priključivanju — **0 izgubljenih**. Promenite
  bilo šta od toga i garancija nestaje: **clean session** ništa ne zadržava (31.000 izgubljeno ≈
  30s × 1000 poruci/s), **QoS 0** je fire-and-forget pa se nikad ne queue-uje (31.000 izgubljeno),
  i čak persistent sesija gubi kada njen **ograničeni in-memory red prekoračen** (ograničenje od
  10.000 poruka ispalo je ~5,9k). Ovo je cena MQTT-ovog čuvanja stanja u RAM-u.
- **Kafka ne gubi ništa ni u jednoj varijanti** — uključujući 3× duži prekid — jer su poruke
  dodate u **trajni log** bez obzira na to ko je slušao, a vraćajući se consumer samo nastavlja
  od svog **potvrđenog offseta**. Jedini **duplikat** je Kafka-ina poštena **at-least-once**
  semantika: jedna poruka bila je obrađena ali njen offset još nije potvrđen kada je consumer
  pao, pa je ponovo dostavljena (a naš idempotentni `ON CONFLICT` unos je apsorbuje bezopasno).
- **Ovo je strukturna razlika pouzdanosti koju scenario treba da otkrije.** MQTT može da
  odgovori Kafka-i *samo* pod specifičnom, RAM-ograničenom konfiguracijom i samo za prekide
  kratke dovoljne da stanu u red; Kafka je ispravna po konstrukciji, nezavisno od konfiguracije,
  dužine prekida ili koje strane se odspoji — uz trošak resursa kvantifikovan u §3.

### Scenario C — burst opterećenje

Baseline 50 poruci/s, nagla šiljak na 5000 poruci/s burst target na 5s, praćenje
zaostalih (`buffered`) servisa za skladištenje po sekundi.

| Posrednik | Vršne zaostale (buffered redovi) | Izgubljene poruke | Vreme oporavka |
|-----------|----------------------------------|-------------------|----------------|
| MQTT      | 45                               | 0                 | ~0s            |
| Kafka     | 353                              | 0                 | ~1s            |

- **Oba su apsorbovala 100× skok bez ikakvog gubitka.** Storage `BATCH` writer (flush po
  veličini ILI vremenu) upao je burst; posrednik + DB su nadoknadili pri ovim volumenima
  na dev box-u.
- **Kafka je pokazala veće prolazne zaostale** (353 vs 45 baferisanih redova). Kafka predaje
  consumeru fetchovane *batch-ove*, pa storage bafer skače u većim koracima između flush-ova;
  MQTT-ov per-message push praznio se glatko. Oba su se oporavila u ~1s.
- Validira **obavezni BATCH mod** (ZAHTEVI §5.2): tokom šiljka DB writer nikada nije postao
  usko grlo i ništa nije odbačeno.

### Scenario D — kašnjenje upozorenja u realnom vremenu

Oba posrednika merena na isti način (analytics servis, 5 uređaja @ 50 poruci/s, 10s
prozor, prag upozorenja 20°F da prozori pucaju). Dve latencije prema metodologiji:

| Posrednik | Transportno avg (ms) | Transportno maks (ms) | Event-to-alert avg (ms) | Event-to-alert p95 (ms) |
|-----------|----------------------|-----------------------|-------------------------|--------------------------|
| MQTT      | **1,24**             | 3                     | 5.369                   | 6.149                    |
| Kafka     | **6,65**             | 1.361                 | 5.641                   | 6.836                    |

- **Transport (čist broker hop): MQTT je nekoliko× brži** — ~1,2ms vs ~6,7ms — i daleko
  konzistentniji (maks 3ms vs Kafka outlier od 1,4s iz consumer-group/fetch zagrijavanja).
  MQTT-ov lagani per-message push pobjeđuje Kafka-in fetch/batch consumer model za
  single-message reaktivnost.
- **Event-to-alert dominira prozor, ne posrednik.** Oba završavaju oko ~5,4–5,6s
  jer 10s tumbling window dodaje, u proseku, ~pola prozora baferovanja. Doprinos posrednika
  od ~5ms je šum ovde — što je tačno *zašto* izveštaj meri transport posebno: kašnjenje
  prozoriranja bi inače sakrilo razliku posrednika.
- **Implikacija:** za *latencijski-kritična* upozorenja, MQTT-ov niži transportni latensi
  pomaže, ali strategija prozoriranja je mnogo važnija; smanjite prozor da skratite
  event-to-alert. (QoS/acks sweep — podesite `QOS_LEVEL`/`KAFKA_ACKS` i ponovo pokrenite;
  skripta označava svaki red.)

---

## 5. Analiza pouzdanosti — kritična inženjerska pitanja (ZAHTEVI §9)

### Pitanje 1 — Zašto je MQTT idealan *na ivici* (senzori), ali neadekvatan kada su potrebne big-data analitike istorijskih podataka?

**MQTT je napravljen za ograničenu ivicu.**

- **Minijaturni otisak.** Mosquitto je mali C broker: u našim pokretanjima je radio i
  pokretao se pri svega nekoliko **MB** RAM-a i skoro nultom CPU-u prenoseći hiljade
  poruka/s (vidi kolone resursa Scenarija A). Nema JVM-a, nema page cache-a koji treba
  hraniti, nema pozadinskog kompaktiranja. To odgovara gateway-u klase Raspberry Pi pored
  senzora.
- **Efikasnost protokola.** MQTT ima ~2-bajtni fiksni zaglavni i kompaktan publish paket,
  dizajniran za lossy, low-bandwidth, high-latency linkove (radi srećno na nestabilnom
  cellular/TCP, i over TLS kada je potrebno). QoS 0/1/2 omogućava uređaju da trguje
  pouzdanost za bateriju/propusnost po poruci.
- **Jednostavan pub/sub.** Senzor se samo konektuje i objavljuje; subscriber samo prima.
  Nema dodele particija, nema vođenja offseta, nema koordinacije consumer-grupe.

**Zašto zakazuje za big-data analitiku.**

- **Nema trajnog loga / nema replay-a.** MQTT je *ruter poruka*, ne prodavnica. Jednom
  kada je poruka dostavljena (ili njen QoS handshake završen), broker je zaboravlja.
  Subscriber koji nije bio konektovan, ili analytics posao koji želi da rekomputa nad
  podacima prošlog meseca, **ne može da dobije istoriju nazad** — nema šta da se replay-uje.
  Naš servis za skladištenje mora da čuva u TimescaleDB-u tačno zato što broker ništa ne
  čuva.
- **Nema consumer offseta.** Nema pojma "gde je svaki consumer." Subscriber koji se
  ponovo priključi nastavlja od *sada* (persistent sesije mogu da queue-uju *neke* poruke
  za poznatog klijenta, ograničeno memorijom brokera — nije trajni, premotljivi log). Ne
  možete dodati drugi analytics consumer sledeće sedmice i da čita od početka.
- **Fan-out, ne paralelna konzumpcija.** Više subscribera svaki dobija puni tok; MQTT nema
  ugrađen način da *particionira* high-volume topic kroz pool radnika za horizontalni
  protok (shared subscriptions postoje ali su ograničene i broker-specifične).
- **Backpressure / baferovanje ograničeno je broker RAM-om.** Pod trajnim preopterećenjem
  mali in-memory broker nema kuda da prelije, pa odbacuje — u redu za "poslednje čitanje
  pobjeđuje" telemetriju, pogrešno za "ne izgubi ništa" analytics ingestiju.

**Ukratko:** MQTT optimizuje za *slanje male poruke sa ograničenog uređaja, sada,
jeftino*. Analitika treba *trajnost, replay, offsets i particionisanu skalu* — nijedno od
toga nije MQTT-ov posao. To je tačno zašto naš pipeline koristi MQTT kao edge transport
ali bazu podataka (i, na Kafka strani, sam log) za istoriju.

### Pitanje 2 — Zašto Kafka dominira cloud sistemima intenzivnog korišćenja podataka? Koja je "cena" njene skalabilnosti u resursima, i da li je Kafka realna na ivičnim serverima sa ograničenim resursima?

**Kafka-ina supermoć je nepromenljivi, append-only commit log.**

- **Log je arhitektura.** Kafka ne "dostavlja i zaboravlja" — *dodaje* svaku poruku u
  particionisani, on-disk log sa prozorom zadržavanja. Consumeri prate sopstveni **offset**,
  pa bilo koji consumer može čitati sopstvenim tempom, **replay-ovati** sa bilo koje tačke,
  ili se pridružiti kasnije i čitati od početka. Naši storage i analytics servisi su dve
  nezavisne **consumer grupe** koje čitaju *isti* tok — log to čini prirodnim.
- **Istorijska analitika i reproblematika.** Pošto je log trajan i premotljiv, novi
  analytics model može se back-testirati nad zadržanim podacima bez ponovnog unosa sa
  uređaja. Ovo je sposobnost koja MQTT strukturno nema.
- **Particionisanje = horizontalna skala + redosled.** Topic se deli na particije; producenti
  ključuju po entitetu (ključujemo po `device`, čuvajući per-device `seq` redosled) i consumer
  grupa rasprostire particije po radnicima. Propusnost se skalira dodavanjem particija i
  consumera. U Scenariju A, kafka-producer-perf-test je izdržao visoku stopu zapisa sa
  acks-podesiljivom trajnošću.

**Cena, u resursima.**

- **JVM RAM i page cache.** Kafka radi na JVM-u i jako se oslanja na OS page cache za
  log; zdrava Kafka želi stotine MB do GB RAM-a. U našim pokretanjima memorija i CPU
  Kafka kontejnera bili su **redovi veličine veći od Mosquitto-ovih** (deseci-do-stotine
  MB i multi-core CPU šiljci vs Mosquitto-ove nekoliko MB) — kolone resursa u §3 to
  kvantifikuju.
- **Disk I/O.** Trajnost znači da svaka poruka udari log (i bude fsync-ovana po acks
  politici); trajni unos je disk-ograničen, a zadržavanje kontinuirano troši storage.
- **Operativna težina.** Čak i single-node, Kafka je teža zver za pokretanje, podešavanje
  i odrzavanje od config-fajl brokera poput Mosquitto-a.

**Da li je Kafka realna na ivici?**

- Istorijski *ne* — klasična Kafka je takođe zahtevala **ZooKeeper** ensemble, udvostručujući
  pokretne delove i RAM. **KRaft mod** (šta mi postavljamo) uklanja ZooKeeper: controller
  quorum je ugrađen u samu Kafka, smanjujući otisak i operativnu složenost. To čini
  *single-node* Kafka smisleno izvodljivim na robusnijem edge **serveru** (ne senzoru,
  ne Pi-u) — npr. regionalni gateway sa nekoliko GB RAM-a i SSD-om.
- Ali je i dalje pogrešan alat *na senzoru*: JVM/RAM/disk trošak nadmašuje šta
  mikrokontroler ili Pi-klasa čvor može da deli, a ivica retko treba lokalno replay-abilnu
  istoriju. Pragmatična topologija je tačno ona ovog projekta: **MQTT na ivici → bridge →
  Kafka u cloud/regionalnom nivou** za trajnu, replay-abilnu, horizontalno-skaliranu analitiku.

**Zaključak.** Kafka dominira cloud-om jer append-only log daje trajnost, replay,
offsets i particionisanu skalu — uz realni RAM/CPU/disk trošak. KRaft dovoljno snižava
prag za sposoban edge *server*, ali MQTT ostaje pravi izbor na ograničenom uređaju.

---

## 6. Zaključci

Eksperimenti čine kompromis konkretnim i konzistentnim sa arhitekturom:

- **Propusnost i trajnost → Kafka.** Izdržala ~2× višu stopu poruka sa 1000 producenata
  i nikada nije izgubila poruku (trajni log), uz cenu mnogo višeg variranja kašnjenja i
  resursa.
- **Otisak i ivična pogodnost → MQTT.** Mosquitto je radio celo vreme sa **~4–5 MB**
  RAM-a sa najnižim, najkonzistentnijim transportnim kašnjenjem (~1ms). Kafka je trebala
  **~100× RAM-a** (~360–580 MB) plus multi-core CPU i disk — u redu za server, nemoguće za
  senzor.
- **Poluge pouzdanosti koštaju performanse predvidivo.** MQTT QoS↑ i Kafka acks=all oba
  trguju propusnost/kašnjenje za jače garancije — biraju po kritičnosti poruke.
- **Pipeline je apsorbovao burst-ove i publisher dropout sa nultim gubitkom** (BATCH upisi +
  client baferovanje). I kada smo prerezali **subscriber** — test koji zapravo sondira
  brokera — strukturna razlika se jasno pokazala: **Kafka nije izgubila ništa** ni u jednoj
  konfiguraciji i pri 3× trajanju kvara (trajni log + offset resume), dok je **MQTT odgovarao
  tome samo pod persistent, QoS ≥ 1, unbounded-queue sesijom** i izgubio sve pod
  clean-session, QoS 0, ili queue overflow-om (§4). Kafka-ina pouzdanost je po konstrukciji;
  MQTT-ova je RAM-ograničen konfiguracioni izbor.
- **Arhitektura je ispunila obećanje:** svaki gornji rezultat produciran je prebacivanjem
  `BROKER_TYPE` + Compose profila — **jedna zastavica, bez promene koda** — što je upravo ono
  što je omogućilo čisto jabuke-s-jabukama poređenje.

**Preporučena topologija:** MQTT na ograničenoj ivici → bridge → Kafka u
cloud/regionalnom nivou za trajnu, replay-abilnu, horizontalno-skaliranu analitiku. Ovaj
projekat implementira upravo taj razdel iza jedne broker apstrakcije.

### Napomene o obimu (poštenje o pokretanjima)
- Brojevi uređaja **100** i **1000** su izmereni za pun QoS/acks grid; **10000**
  nije pokrenuto na single WSL2 box-u (FD/RAM ograničenja) — komande harness-a su obezbeđene.
- Apsolutni brojevi su dev-box cifre (single node, single partition); **relativno
  MQTT-vs-Kafka poređenje** je robustni rezultat.
- Scenario B se pokreće u dve varijante: odspajanje *publishera* (client baferovanje maskira
  kvar → 0/0 na oba posrednika) i odspajanje *subscribera* (vežba mehanizam posrednika —
  MQTT gubi pod clean-session/QoS 0/queue-overflow, Kafka nastavlja od svog offseta bez
  gubitka). Subscriber varijanta je ta koja odgovara na ZAHTEVI §7-B; koristi snižen MQTT
  keepalive (10s) kako bi 30s kvar zapravo razorio sesiju.

---

## 7. Reproduktivnost

```bash
cp docker/.env.example docker/.env                 # podesiti BROKER_TYPE + BROKER_HOST/PORT
docker compose --profile <mqtt|kafka> up -d        # Scenario A (samo posrednik)
docker compose --profile <mqtt|kafka> --profile app up -d   # Scenariji B/C/D (+ servisi)
BROKER=<mqtt|kafka> benchmarks/scenario-a-massive-ingestion.sh   # → results/<broker>/scenario-a/
BROKER=<mqtt|kafka> benchmarks/scenario-b-connectivity-failure.sh
BROKER=<mqtt|kafka> benchmarks/scenario-c-burst-load.sh
BROKER=<mqtt|kafka> benchmarks/scenario-d-alerting-latency.sh
```

Detalji alata i parametri podešavanja: [benchmarks/README.md](../../benchmarks/README.md).
