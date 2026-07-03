# ZAHTEVI.md
# Internet stvari i servisi — Projekat 2
## Mikro-servisi upravljani događajima: Komparativna evaluacija MQTT i Kafka

> **Svrha ovog dokumenta:** Jedini izvor istine za ceo projekat. Svaki agent koda, implementacija servisa i skript za testiranje mora da referiše na ovaj dokument. Stavke u listi za proveru označavati po završetku.

---

## Sadržaj

1. [Cilj projekta](#1-cilj-projekta)
2. [Skup podataka — izvor istine](#2-skup-podataka--izvor-istine)
3. [Tehnološki stek](#3-tehnoloski-stek)
4. [Arhitektura sistema](#4-arhitektura-sistema)
5. [Specifikacije servisa](#5-specifikacije-servisa)
6. [Implementacije posrednika poruka](#6-implementacije-posrednika-poruka)
7. [Eksperimentalni scenariji](#7-eksperimentalni-scenariji)
8. [Merenje performansi](#8-merenje-performansi)
9. [Analiza pouzdanosti](#9-analiza-pouzdanosti)
10. [Isporučevine](#10-isporucevine)
11. [Struktura repozitorijuma](#11-struktura-repozitorijuma)
12. [Lista za proveru implementacije](#12-lista-za-proveru-implementacije)

---

## 1. Cilj projekta

Istražiti **performanse, skalabilnost i ograničenja** različitih sistema posrednika poruka zasnovanih na **modelu objavljivanja i pretplate** unutar IoT arhitektura mikro-servisa.

### Istraživački fokus

- Razumevanje **kompromisnih odluka**: kašnjenje vs. pouzdanost
- Pogodnost sistema posrednika za **ivična okruženja** (ograničeni resursi)
- Pogodnost sistema posrednika za **cloud okruženja** (skalabilnost, analitika)

### Osnove

- Koristiti **IoT skup podataka i model podataka iz Projekta 1** (dozvoljeno je proširenje atributa)
- Ceo sistem mora biti **kontejnerizovan** koristeći Docker Compose
- Moraju se koristiti najmanje **dve različite backend tehnologije**

---

## 2. Skup podataka — izvor istine

### 2.1 Pregled

| Svojstvo             | Vrednost                                               |
|----------------------|--------------------------------------------------------|
| Naziv                | Environmental Sensor Telemetry Data                    |
| Poreklo              | Tri Raspberry Pi + Breadboard senzorska polja          |
| Ukupan broj redova   | 405.184                                                |
| Vremenski opseg      | 07.12.2020 – 19.12.2020                                |
| Originalni protokol  | MQTT                                                   |

### 2.2 Metapodaci uređaja

| ID uređaja (MAC)        | Uslovi okruženja                        |
|-------------------------|-----------------------------------------|
| `00:0f:00:70:91:0a`     | Stabilan, hladniji i vlažniji           |
| `1c:bf:ce:15:ec:4d`     | Veoma promenljiva temperatura/vlažnost  |
| `b8:27:eb:bf:9d:51`     | Stabilan, topliji i suvi                |

### 2.3 Shema podataka — tabela `sensor_data`

| Kolona       | SQL tip        | Protobuf tip   | Opis                         | Jedinica/Format |
|--------------|----------------|----------------|------------------------------|-----------------|
| `ts`         | `TIMESTAMPTZ`  | `double`       | Vremenski pečat događaja     | Epoha u sekundama |
| `device`     | `VARCHAR(255)` | `string`       | MAC adresa uređaja           | String          |
| `co`         | `FLOAT8`       | `double`       | Nivo ugljen-monoksida        | ppm (%)         |
| `humidity`   | `FLOAT8`       | `double`       | Relativna vlažnost vazduha   | procenat        |
| `light`      | `BOOLEAN`      | `bool`         | Detektovano svetlo?          | boolean         |
| `lpg`        | `FLOAT8`       | `double`       | Tečni naftni gas             | ppm (%)         |
| `motion`     | `BOOLEAN`      | `bool`         | Detektovano kretanje?        | boolean         |
| `smoke`      | `FLOAT8`       | `double`       | Nivo dima                    | ppm (%)         |
| `temp`       | `FLOAT8`       | `double`       | Temperatura                  | Farenhajt       |
| `seq`        | `BIGINT`       | `int64`        | Monotono rastući brojač po uređaju (detekcija gubitaka/duplikata) | ceo broj |
| `sent_at_ms` | `BIGINT`       | `int64`        | Tačno vreme slanja (merenje kašnjenja) | epoha u ms |

> **Polja za merenje (`seq`, `sent_at_ms`) dodata su na osnovu odredbe "dozvoljeno je proširenje atributa" (§1).** `seq` je monotono rastući brojač po uređaju koji omogućava Servisu za skladištenje da detektuje izgubljene/duplirane poruke analizom praznina. `sent_at_ms` je tačno vreme slanja — **različito od `ts`** (koji je vreme *događaja* iz skupa podataka); osnova je za merenje end-to-end kašnjenja. Oba polja se čuvaju kako bi se post-analiza mogla raditi i nad bazom podataka i nad logovima.

### 2.4 Sadržaj poruke (JSON)

```json
{
  "ts": 1594419195.292461,
  "device": "00:0f:00:70:91:0a",
  "co": 0.006104480269226063,
  "humidity": 55.099998474121094,
  "light": true,
  "lpg": 0.008895956948783413,
  "motion": false,
  "smoke": 0.023978358312270912,
  "temp": 31.799999237060547,
  "seq": 12345,
  "sent_at_ms": 1717327200123
}
```

### 2.5 Napomene o implementaciji baze podataka

- **Mehanizam skladišta: TimescaleDB** (PostgreSQL + ekstenzija za vremenske serije). `sensor_data` je **hypertable** particionisana po `ts` radi performansi pisanja i upita vremenskih serija.
- **Primarni ključ: kompozitni `(ts, device)`** — NE samo `ts`. Tri uređaja mogu emitovati isti `ts`, pa bi sam `ts` doveo do kolizije. TimescaleDB dodatno zahteva da kolona za particionisanje (`ts`) bude deo svakog jedinstvenog ključa, pa je `(ts, device)` prirodan izbor.
- `ts` se čuva kao Epoch float u skupu podataka — implementacija mora konvertovati u `TIMESTAMPTZ` pri unosu.
- `light` i `motion` su `BOOLEAN`; `co`/`humidity`/`lpg`/`smoke`/`temp` su `FLOAT8`; `seq`/`sent_at_ms` su `BIGINT`.
- Shema se kreira putem `docker/db/init.sql` (ekstenzija + tabela + `create_hypertable`). Servis za skladištenje koristi TypeORM sa `synchronize: false` — **ne sme** da upravlja shemom (TypeORM ne može da kreira hypertable-ove).
- Primarne metrike agregacije za analitiku prozora: **`temp`**, **`humidity`**, **`co`**

### 2.6 Pragovi upozorenja (Analitika)

| Metrika      | Prag upozorenja | Jedinica    |
|--------------|-----------------|-------------|
| `temp`       | > 50 (podrazumevano) | Farenhajt |
| `co`         | konfigurisano   | ppm         |
| `smoke`      | konfigurisano   | ppm         |

---

## 3. Tehnološki stek

### 3.1 Backend servisi — Potrebne dve tehnologije

| Servis                     | Tehnologija     | Obrazloženje                                                                 |
|----------------------------|-----------------|------------------------------------------------------------------------------|
| Servis za unos podataka    | **NestJS**      | Prirodna asinhrona/event-loop arhitektura idealna za objavljivanje sa visokim protokom; MQTT.js + KafkaJS dobro podržani |
| Servis za skladištenje     | **NestJS**      | Integracija TypeORM + PostgreSQL; šabloni grupnog pisanja dobro podržani      |
| Servis za analitiku        | **FastAPI**     | Python ekosistem: `statistics`, `asyncio`, `aiokafka`, `asyncio-mqtt`; najpogodniji za obradu tokova sa kliznim agregacijama |

> **Zašto FastAPI umesto .NET-a kao druga tehnologija:**
> Servis za analitiku vrši kontinuiranu obradu tokova, agregacije tumbling prozora i statističke izračune. Python-ova standardna biblioteka i asinhroni ekosistem (`asyncio`, `statistics`, `aiokafka`, `asyncio-mqtt`) direktno odgovaraju ovim zahtevima uz minimalan boilerplate. .NET bi doneo superiornije runtime performanse, ali dodaje nepotrebnu težinu okruženja za servis čije usko grlo je I/O posrednika, a ne CPU.

### 3.2 Infrastruktura

| Komponenta           | Tehnologija                                       |
|----------------------|---------------------------------------------------|
| Kontejnerizacija     | Docker Compose (obavezno)                         |
| Baza podataka        | **TimescaleDB** (PostgreSQL + ekstenzija za vremenske serije) |
| Posrednik A          | Eclipse Mosquitto (MQTT)                          |
| Posrednik B          | Apache Kafka — KRaft mod (bez ZooKeeper-a)        |
| Testiranje opterećenja | emqtt-bench / kafka-producer-perf-test.sh       |
| Praćenje resursa     | `docker stats` (+ opcionalno Prometheus + Grafana)|
| Dev okruženje        | **WSL2** + Docker Desktop                         |

> **Zašto TimescaleDB umesto plain PostgreSQL?** Skup podataka je vremenski niz, a Scenariji A/C generišu unose sa visokim protokom. TimescaleDB-ova hypertable (automatsko vremensko particionisanje u delove) ubrzava unose i `ts`-opseg upita i pruža `time_bucket()` za post-analizu. Kompatibilna je sa standardnim `postgres` drajverom. Kompozitni PK `(ts, device)` takođe rešava problem kolizije `ts`-a (vidi §2.5).

> **Zašto razvijati u WSL2?** Repozitorijum živi u git-u, a Docker Desktop integriše sa WSL2, pa se razvoj odvija u Linux okruženju. Obavezni alati za testiranje (emqtt-bench je baziran na Erlang-u; k6 broker ekstenzije su napravljene u Go/xk6) i benchmark `.sh` skripte se izvršavaju nativno — bez Windows friction-a.

> **Zašto KRaft mod za Kafka?** Pokretanje Kafka bez ZooKeeper-a eliminiše jedan kontejner iz steka, smanjujući potrošnju memorije lokalnog računara. KRaft je produkujuće spreman od Kafka 3.3+.

---

## 4. Arhitektura sistema

### 4.1 Logička arhitektura

Sistem je implementiran **dvaput** — jednom sa MQTT i jednom sa Kafka. Obe varijante dele iste tri uloge servisa; menja se samo transportni sloj.

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose Stek                       │
│                                                             │
│  ┌─────────────────────┐                                    │
│  │  Servis za unos     │  (NestJS)                         │
│  │  [IoT Simulator]    │                                    │
│  └──────────┬──────────┘                                    │
│             │  PUBLISH                                       │
│             ▼                                               │
│  ┌──────────────────────────┐                              │
│  │      Posrednik poruka    │                              │
│  │  (Mosquitto / Kafka KRaft)│                             │
│  └───────────┬──────────────┘                              │
│              │  SUBSCRIBE (fan-out)                         │
│     ┌────────┴────────┐                                     │
│     ▼                 ▼                                     │
│  ┌──────────┐   ┌──────────────────┐                       │
│  │ Servis   │   │ Servis za        │  (FastAPI)            │
│  │ za sklad.│   │ analitiku        │                       │
│  │ (NestJS) │   └──────────────────┘                       │
│  └────┬─────┘                                               │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────┐                                               │
│  │PostgreSQL│                                               │
│  └──────────┘                                               │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Pravila komunikacije

- Sva međuservisna komunikacija odvija se **isključivo kroz posrednika** — nema direktnih HTTP poziva između servisa tokom rada u realnom vremenu
- Servis za unos je **jedini objavljivač**
- Servis za skladištenje i Servis za analitiku su **samo pretplatnici**
- PostgreSQL u koji upisuje **isključivo Servis za skladištenje**

---

## 5. Specifikacije servisa

### 5.1 Servis za unos podataka (NestJS)

**Uloga:** Simulira IoT uređaje i objavljuje podatke senzora posredniku u realnom vremenu.

#### Funkcionalni zahtevi

- Simulirati **N paralelnih IoT uređaja** (N je konfigurisano pri pokretanju)
- Generisati i objavljivati poruke senzora prema shemi skupa podataka (Odeljak 2.3)
- Podržati **konfigurisabilan protok objavljivanja** (poruka/sekundi)
- Podržati **burst mod**: nagli skok protoka sa bazne na vršnu brzinu (Scenario C)
- Vrednosti podataka treba da budu uzorkovane/replayed iz stvarnog skupa podataka (`data/iot_telemetry_data.csv`, gitignored, učitava se pri pokretanju) ILI generisane kao realistične nasumične vrednosti koje odgovaraju opsezima skupa podataka — birljivo putem env promenljive `DATA_SOURCE`
- Ugrađivati polja za merenje u svaku poruku: `seq` (monotono rastući brojač po uređaju) i `sent_at_ms` (tačno vreme slanja) — vidi §2.3
- Objavljivati na:
  - MQTT: konfigurisable topic (npr. `sensors/telemetry`)
  - Kafka: konfigurisable topic (npr. `sensor-telemetry`)

#### Potrebna konfiguracija (env promenljive)

| Promenljiva           | Opis                                                     | Primer          |
|-----------------------|----------------------------------------------------------|-----------------|
| `NUM_DEVICES`         | Broj paralelnih simuliranih uređaja                      | `100`           |
| `MESSAGES_PER_SECOND` | Protok objavljivanja po uređaju                          | `10`            |
| `BURST_TARGET_RATE`   | Vršni protok za burst scenario                           | `5000`          |
| `BROKER_HOST`         | Hostname posrednika                                      | `mosquitto`     |
| `BROKER_PORT`         | Port posrednika                                          | `1883`          |
| `TOPIC`               | Naziv ciljnog topica                                     | `sensors/data`  |
| `QOS_LEVEL`           | MQTT QoS (0, 1 ili 2) — samo za MQTT varijantu          | `1`             |
| `KAFKA_ACKS`          | Kafka acks podešavanje — samo za Kafka varijantu         | `1`             |
| `BROKER_TYPE`         | Bira adapter pri pokretanju (`mqtt` \| `kafka`)          | `mqtt`          |
| `DATA_SOURCE`         | `replay` (iz CSV-a) ili `random` (generisano)            | `replay`        |
| `DATASET_PATH`        | Putanja do CSV skupa podataka (replay mod)               | `/data/iot_telemetry_data.csv` |

---

### 5.2 Servis za skladištenje podataka (NestJS)

**Uloga:** Pretplaćuje se na posrednika i čuva poruke u PostgreSQL.

#### Funkcionalni zahtevi

- Pretplatiti se na topic posrednika
- Parsirati dolazne JSON poruke
- Upisivati podatke u tabelu `sensor_data` (shema: Odeljak 2.3)
- Implementirati **strategiju grupnog pisanja** za scenarije visokog opterećenja

#### ⚠️ Kritično: Optimizacija grupnog pisanja

> Tokom intenzivnih stres testova (**Scenariji A i C**), I/O podsistem baze podataka ne sme postati usko grlo — to bi iskrivilo rezultate benchmark-a od posrednika.
>
> **Zahtev implementacije:** Podržati dva moda pisanja, prebaciva putem env promenljive:
>
> | Mod          | Ponašanje                                                  |
> |--------------|------------------------------------------------------------|
> | `DIRECT`     | Pisanje svake poruke pojedinačno (podrazumevano/dev mod)   |
> | `BATCH`      | Baferisanje poruka i flush po **veličini ILI vremenu** (koji god nastupi pre) |
>
> Prebaciti se na `BATCH` mod za **Scenarije A i C**.
>
> **Okidač flush-a (oba uslova):** flush kada bafer dostigne `BATCH_SIZE` **ILI** kada prođe `FLUSH_INTERVAL_MS` od poslednjeg flush-a. Vremenski flush je obavezan — bez njega, tokovi niskog protoka (npr. Scenario D, periodi neaktivnosti) bi ostali neflushovani, a broj baferisanih-ali-nenapisanih redova pri padu bio bi neograničen. Koristiti jedan multi-row `INSERT` po flush-u.

#### Potrebna konfiguracija (env promenljive)

| Promenljiva         | Opis                                    | Primer                                |
|---------------------|-----------------------------------------|---------------------------------------|
| `DATABASE_URL`      | PostgreSQL connection string            | `postgresql://user:pass@db:5432/iotdb`|
| `BROKER_HOST`       | Hostname posrednika                     | `mosquitto`                           |
| `TOPIC`             | Izvorni topic                           | `sensors/data`                        |
| `BROKER_TYPE`       | Bira adapter (`mqtt` \| `kafka`)        | `mqtt`                                |
| `WRITE_MODE`        | `DIRECT` ili `BATCH`                    | `BATCH`                               |
| `BATCH_SIZE`        | Poruka po batch-u (u BATCH modu)        | `500`                                 |
| `FLUSH_INTERVAL_MS` | Maksimalno vreme pre flush-a parcijalnog batch-a | `1000`                       |

---

### 5.3 Servis za analitiku (FastAPI)

**Uloga:** Pretplaćuje se na tok poruka i vrši obradu toka u realnom vremenu koristeći Tumbling Window.

#### Funkcionalni zahtevi

##### Specifikacija Tumbling Window

| Parametar          | Vrednost                                            |
|--------------------|-----------------------------------------------------|
| Tip prozora        | **Tumbling Window** (fiksni, nepreklaplajući)       |
| Trajanje prozora   | **10 sekundi**                                      |
| Primarna metrika   | Prosečna temperatura po prozoru                     |
| Sekundarne metrike | Prosečna vlažnost, prosečni CO (za izveštaj)        |
| Prag upozorenja    | Konfigurisabilan (podrazumevano: `temp > 50°F`)     |

##### Logika obrade (obavezna)

```
Za svaki 10-sekundni tumbling prozor:
  1. Prikupiti sve poruke primljene unutar prozora
  2. Izračunati: avg_temp, avg_humidity, avg_co
  3. AKO avg_temp > ALERT_THRESHOLD:
       → Logovati KRITIČNO UPOZORENJE sa metapodacima prozora
     INAČE:
       → Logovati normalni sažetak prozora
  4. Resetovati akumulator prozora za sledeći ciklus
```

##### Format log-a upozorenja

```
[ALERT] {iso_timestamp} | Window [{start}–{end}] | AvgTemp: {value}°F | AvgHumidity: {value}% | AvgCO: {value}ppm | THRESHOLD EXCEEDED
[INFO]  {iso_timestamp} | Window [{start}–{end}] | AvgTemp: {value}°F | AvgHumidity: {value}% | AvgCO: {value}ppm | OK
```

##### Merenje end-to-end kašnjenja (Scenario D)

Servis za unos ugrađuje **vremenski pečat slanja** u svaku poruku (`sent_at_ms`, §2.3). Servis za analitiku beleži **dva** vremenska pečata radi izveštavanja o **dva komplementarna kašnjenja**:

| Metrika | Definicija | Šta meri |
|---------|------------|----------|
| **Transportno kašnjenje** | `receive_at_ms − sent_at_ms`, po poruci | Čisto vreme dostave posrednika (objavi → konzumira) |
| **Kašnjenje od događaja do upozorenja** | `alert_log_ms − sent_at_ms`, po upozorenju | End-to-end uključujući do `WINDOW_SIZE_SEC` baferovanja tumbling prozora |

> Originalna definicija spec-a (`t_end` = vreme log-a upozorenja) je kašnjenje **od događaja do upozorenja** i inherentno uključuje baferovanje prozora (poruka koja stigne na početku 10s prozora čeka ~10s pre nego što se njen prozor zatvori). Izveštavanje transportnog kašnjenja pored njega izoluje doprinos posrednika od kašnjenja u prozoru — oba su korisna za MQTT vs Kafka poređenje.

#### Potrebna konfiguracija (env promenljive)

| Promenljiva          | Opis                                             | Primer        |
|----------------------|--------------------------------------------------|---------------|
| `BROKER_TYPE`        | Bira adapter (`mqtt` \| `kafka`)                 | `mqtt`        |
| `WINDOW_SIZE_SEC`    | Trajanje tumbling prozora u sekundama            | `10`          |
| `ALERT_THRESHOLD`    | Temperaturni prag za upozorenje                  | `50.0`        |
| `BROKER_HOST`        | Hostname posrednika                              | `mosquitto`   |
| `TOPIC`              | Izvorni topic                                    | `sensors/data`|

---

## 6. Implementacije posrednika poruka

### 6.1 MQTT — Eclipse Mosquitto

#### QoS nivoi — Sva tri moraju biti testirana

| QoS | Garancija         | Opis                                                       | Očekivani uticaj              |
|-----|-------------------|------------------------------------------------------------|-------------------------------|
| `0` | Najviše jednom    | Fire-and-forget; bez ACK-a                                 | Najmanji latensi, mogući gubici |
| `1` | Barem jednom      | Potreban ACK; mogući duplikati                             | Umeren latensi                |
| `2` | Tačno jednom      | 4-smerni handshake; bez gubitaka, bez duplikata            | Najveći latensi               |

#### Šta analizirati

- Uticaj QoS nivoa na **kašnjenje poruka** (p50, p95, p99)
- Uticaj QoS nivoa na **stopu gubitka poruka**
- **Oporavak posle mrežnog prekida:**
  - Trajne sesije (`cleanSession = false`) — posrednik čuva pretplate i poruke u redu za offline klijente
  - Ponašanje pri ponovnom povezivanju: da li se dostavljaju baferisane poruke?

---

### 6.2 Apache Kafka (KRaft mod)

#### Potvrda producenta — Sve tri moraju biti testirana

| `acks` | Ponašanje                                                      | Kompromis                             |
|--------|----------------------------------------------------------------|---------------------------------------|
| `0`    | Bez ACK-a — fire and forget                                    | Maksimalni protok, bez garancije      |
| `1`    | ACK samo od lidera particije                                   | Izbalansirane performanse/pouzdanost  |
| `all`  | ACK od svih sinhronizovanih replika                            | Maksimalna pouzdanost, veći latensi   |

#### Šta analizirati

- **Consumer Lag:** razlika između poslednjeg produciranog offseta i poslednjeg potvrđenog offseta od strane konzumenta
  - Praćenje lag-a tokom burst scenarija
  - Merenje vremena za povratak lag-a na 0 (vreme oporavka)
- **Particionisanje:** kako broj particija utiče na protok i paralelizam konzumenta
- **Oporavak posle mrežnog prekida:**
  - Kafka-ovo praćenje offseta garantuje da konzument nastavlja od tačno poslednjeg potvrđenog offseta
  - Meriti: izgubljene poruke vs. poruke replayed posle ponovnog povezivanja

---

## 7. Eksperimentalni scenariji

### Scenario A — Masivna ingestija senzora

**Cilj:** Odrediti maksimalni protok i stopu gubitka poruka pod teškim paralelnim opterećenjem.

| Parametar      | Vrednosti                |
|----------------|--------------------------|
| Broj uređaja   | **100, 1000, 10000**     |
| Tip opterećenja | Svi uređaji objavljuju istovremeno |
| Mod skladišta  | **BATCH** (obavezno)     |

**Metrike za prikupljanje:**

| Metrika                        | Opis                                                         |
|--------------------------------|--------------------------------------------------------------|
| Maks. propusnost (poruci/s)    | Vršni broj poruka u sekundi kojeg posrednik može da izdrži  |
| Stopa gubitka poruka (%)       | `izgubljeno / poslato × 100`                                 |
| CPU po kontejneru (%)          | Prosek i vrh tokom testa                                     |
| RAM po kontejneru (MB)         | Prosek i vrh tokom testa                                     |

---

### Scenario B — Kvar ivičnih veza

**Cilj:** Testirati mehanizme oporavka posrednika posle simulirane mrežne particije.

#### Postupak

```bash
# Korak 1: Proveriti normalan rad sistema (poruke teku, skladištenje piše)

# Korak 2: Odspojiti servis za unos od mreže
docker network disconnect <network_name> <ingestion_service_container>

# Korak 3: Čekati 30 sekundi (simulirani prekid)
sleep 30

# Korak 4: Ponovo priključiti
docker network connect <network_name> <ingestion_service_container>

# Korak 5: Pratiti oporavak
```

**Metrike za prikupljanje:**

| Metrika               | Opis                                                            |
|-----------------------|-----------------------------------------------------------------|
| Izgubljene poruke     | Broj poruka koje nisu dostavljene tokom 30s prekida             |
| Vreme oporavka (s)    | Vreme od ponovnog priključivanja do stabilnog toka poruka       |
| Duplikati poruka      | Svi duplikati pri ponovnom priključivanju (posebno QoS 1 / acks=1) |

**Analiza po posredniku:**

| Posrednik | Mehanizam                                                               |
|-----------|-------------------------------------------------------------------------|
| MQTT      | Trajne sesije: da li posrednik čuva poruke za offline klijenta?         |
| Kafka     | Praćenje offseta: da li konzument nastavlja od ispravne pozicije?       |

---

### Scenario C — Burst opterećenje

**Cilj:** Testirati ponašanje posrednika i servisa pod naglim skokovima saobraćaja.

| Parametar      | Vrednost                                    |
|----------------|---------------------------------------------|
| Bazni protok   | **50 poruci/s**                             |
| Vršni protok   | **5000 poruci/s**                           |
| Trajanje burst-a | Nekoliko sekundi (dokumentovati tačno korišćeno trajanje) |
| Tip opterećenja | Nagla šiljak, ne postepena rampa            |
| Mod skladišta  | **BATCH** (obavezno)                        |

**Metrike za prikupljanje:**

| Metrika              | Opis                                                           |
|----------------------|----------------------------------------------------------------|
| Veličina zaostalih   | Dubina reda pri vršnom opterećenju                             |
| Backpressure         | Kako posrednik reaguje kada je preopterećen                    |
| Vreme oporavka (s)   | Vreme za povratak propusnosti na baznu vrednost posle burst-a  |
| Stopa gubitka poruka | Tokom i neposredno posle burst-a                               |

---

### Scenario D — Kašnjenje upozorenja u realnom vremenu

**Cilj:** Meriti end-to-end kašnjenje od generisanja kritičnog događaja do izlaza upozorenja.

#### Definicija kašnjenja

```
t_start : Servis za unos ugrađuje vremenski pečat generisanja u sadržaj poruke
t_end   : Servis za analitiku loguje UPOZORENJE na stdout

Kašnjenje = t_end - t_start  (milisekunde)
```

**Metrike za prikupljanje:**

| Metrika             | Opis                                                      |
|---------------------|-----------------------------------------------------------|
| Min. kašnjenje (ms) | Najbrža opažena dostava upozorenja                        |
| Maks. kašnjenje (ms)| Najsporija opažena                                        |
| Prosečno kašnjenje (ms) | Aritmetička sredina                                   |
| p95 kašnjenje (ms)  | 95. percentil                                             |
| Uticaj QoS/acks     | Kako nivo garancije dostave utiče na kašnjenje upozorenja |

---

## 8. Merenje performansi

### 8.1 Alati za MQTT testiranje opterećenja

Koristiti **jedan** od sledećih (obavezno — ne pisati prilagođene generatore opterećenja):

| Alat              | Napomene                                         |
|-------------------|--------------------------------------------------|
| **emqtt-bench**   | Zvanični MQTT benchmark alat od EMQ-a            |
| **k6 + MQTT extension** | k6 sa MQTT dodatkom                        |

### 8.2 Alati za Kafka testiranje opterećenja

Koristiti **jedan** od sledećih (obavezno):

| Alat                            | Napomene                                              |
|---------------------------------|-------------------------------------------------------|
| **kafka-producer-perf-test.sh** | Isporučen sa Kafka, visoko-performansna native skripta |
| **k6 + xk6-kafka**             | k6 sa Kafka ekstenzijom                               |

### 8.3 Praćenje resursa

**Obavezni baseline alat:**
```bash
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
```

**Opcionalno (preporučeno za vizuelno izveštavanje):**
- Prometheus + Grafana stek integrisan u Docker Compose

### 8.4 Tabela poređenja performansi — Mora biti popunjena

> Ova tabela mora da se pojavi u tehničkom izveštaju na osnovu stvarnih eksperimentalnih podataka.

| Posrednik | Konfiguracija | Uređaji | Propusnost (poruci/s) | p95 Kašnjenje (ms) | CPU (%) | RAM (MB) | Gubitak (%) |
|-----------|---------------|---------|----------------------|---------------------|---------|----------|-------------|
| MQTT   | QoS 0   | 100     |                   |                  |         |          |          |
| MQTT   | QoS 0   | 1000    |                   |                  |         |          |          |
| MQTT   | QoS 0   | 10000   |                   |                  |         |          |          |
| MQTT   | QoS 1   | 100     |                   |                  |         |          |          |
| MQTT   | QoS 1   | 1000    |                   |                  |         |          |          |
| MQTT   | QoS 1   | 10000   |                   |                  |         |          |          |
| MQTT   | QoS 2   | 100     |                   |                  |         |          |          |
| MQTT   | QoS 2   | 1000    |                   |                  |         |          |          |
| MQTT   | QoS 2   | 10000   |                   |                  |         |          |          |
| Kafka  | acks=0  | 100     |                   |                  |         |          |          |
| Kafka  | acks=0  | 1000    |                   |                  |         |          |          |
| Kafka  | acks=0  | 10000   |                   |                  |         |          |          |
| Kafka  | acks=1  | 100     |                   |                  |         |          |          |
| Kafka  | acks=1  | 1000    |                   |                  |         |          |          |
| Kafka  | acks=1  | 10000   |                   |                  |         |          |          |
| Kafka  | acks=all| 100     |                   |                  |         |          |          |
| Kafka  | acks=all| 1000    |                   |                  |         |          |          |
| Kafka  | acks=all| 10000   |                   |                  |         |          |          |

---

## 9. Analiza pouzdanosti

### Kritična inženjerska pitanja — Moraju biti odgovorena u izveštaju

#### Pitanje 1
> **Zašto je MQTT idealan za direktno postavljanje na ivičnim uređajima (senzori), ali postaje neadekvatan kada su potrebne big-data analitike istorijskih podataka?**

Odgovor mora da se bavi:
- Memorijskim i CPU otiskom Mosquitto-a naspram JVM overhead-a Kafka-e
- Odsustvom trajnog loga poruka u MQTT (nema replaya)
- Pub/sub modelom bez praćenja offseta konzumenta
- Efikasnošću protokola (mali paketi, MQTT over TCP/TLS za ograničene mreže)

#### Pitanje 2
> **Zašto Kafka dominira u cloud sistemima intenzivnog korišćenja podataka? Koja je "cena" njene skalabilnosti u smislu resursa, i da li je realno pokrenuti Kafka na ivičnim serverima sa ograničenim resursima?**

Odgovor mora da se bavi:
- Kafka-inim nepromenjivim append-only logom kao ključnim arhitekturalnim razlikovnikom
- Replay poruka i istorijska analitika
- Particionisanje i horizontalna skalabilnost
- JVM RAM zahtevi i obrasci disk I/O
- KRaft mod poboljšanje u odnosu na tradicionalno ZooKeeper postavljanje za ivičnu primenu

---

## 10. Isporučevine

| # | Isporučevina                          | Opis                                                                              |
|---|---------------------------------------|-----------------------------------------------------------------------------------|
| 1 | **Git repozitorijum**                 | Kompletan izvorni kod sa istorijom commit-ova                                     |
| 2 | **Docker Compose konfiguracija**      | Radni `docker-compose.yml` fajlovi (jedan po varijanti posrednika, ili unifikovani sa profilima) |
| 3 | **Konfiguracioni fajlovi posrednika** | `mosquitto.conf`, Kafka server svojstva                                           |
| 4 | **Benchmark skripte**                 | Shell/Python skripte za pokretanje sva 4 scenarija na oba posrednika              |
| 5 | **Eksperimentalni rezultati**         | Sirovi podaci merenja (CSV, JSON ili snimljeni logovi)                            |
| 6 | **Tehnički izveštaj**                 | Opis sistema, popunjena tabela performansi, odgovori na kritična pitanja           |

---

## 11. Struktura repozitorijuma

> **Unificirani raspored (adapter šablon, bez dupliciranja po posredniku).** Ranije verzije imale su posebna `mqtt/` i `kafka/` stabla sa punom kopijom svakog servisa — to je upravo duplikacija koda koji ovaj projekat izbegava. Umesto toga, postoji **jedna kodna baza po servisu**; svaka definiše `BrokerAdapter` interfejs implementiran sa `MqttAdapter` i `KafkaAdapter`, izabran pri pokretanju putem `BROKER_TYPE`. Docker Compose **profili** biraju koji stek posrednika je aktivan. Promena posrednika je jedna CLI zastavica — bez promene koda, bez dupliciranih servisa.

```
/
├── docs/
│   ├── REQUIREMENTS.md            ← originalni (šta)
│   ├── DECISIONS.md               ← tech/arhitekturne odluke (zašto)
│   ├── PLAN.md                    ← plan implementacije (pregled/indeks)
│   ├── plan/                      ← jedan fajl po iteraciji (00–08)
│   ├── report.md                  ← tehnički izveštaj (isporučevina #6)
│   └── sr/                        ← srpske verzije dokumenata
│
├── data/                          ← GITIGNORED: dataset CSV
│   └── iot_telemetry_data.csv
│
├── shared/
│   ├── dataset_info.md            ← shema skupa podataka
│   └── message-contract.md        ← kanonski sadržaj poruke + nazivi topica
│
├── services/                      ← npm workspaces koren (NestJS servisi dele libs)
│   ├── package.json
│   ├── libs/
│   │   ├── broker/                ← BrokerAdapter, MqttAdapter, KafkaAdapter, DI fabrika
│   │   └── contracts/             ← payload DTO, konstante topica, env ključevi
│   ├── ingestion-service/         ← NestJS (publisher + device simulator)
│   ├── storage-service/           ← NestJS (subscriber + TimescaleDB writer)
│   └── analytics-service/         ← FastAPI (Python; sopstveni asyncio adapter)
│
├── docker/
│   ├── docker-compose.yml         ← profili: mqtt | kafka (+ uvek aktivno: db)
│   ├── .env.example
│   ├── mosquitto/mosquitto.conf
│   ├── kafka/
│   └── db/init.sql
│
├── benchmarks/
│   ├── scenario-a-massive-ingestion.sh
│   ├── scenario-b-connectivity-failure.sh
│   ├── scenario-c-burst-load.sh
│   ├── scenario-d-alerting-latency.sh
│   ├── collect-docker-stats.sh
│   └── lib/
│
├── results/
│   ├── mqtt/{scenario-a,scenario-b,scenario-c,scenario-d}/
│   └── kafka/{scenario-a,scenario-b,scenario-c,scenario-d}/
│
├── dashboard/                     ← OPCIONALNO: React/Vite SPA
│
├── CLAUDE.md
└── README.md
```

---

## 12. Lista za proveru implementacije

### Infrastruktura
- [ ] PostgreSQL kontejner + `init.sql` sa `sensor_data` shemom
- [ ] MQTT stek: Mosquitto konfigurisan, Docker Compose radi
- [ ] Kafka stek: KRaft mod konfigurisan, Docker Compose radi
- [ ] `.env` fajlovi / strategija env promenljivih definisana za oba steka

### Servisi — MQTT varijanta
- [ ] Servis za unos (NestJS) — MQTT publisher
- [ ] Servis za skladištenje (NestJS) — MQTT subscriber + PostgreSQL writer (batch podrška)
- [ ] Servis za analitiku (FastAPI) — MQTT subscriber + Tumbling Window + logovanje upozorenja

### Servisi — Kafka varijanta
- [ ] Servis za unos (NestJS) — Kafka producer
- [ ] Servis za skladištenje (NestJS) — Kafka consumer + PostgreSQL writer (batch podrška)
- [ ] Servis za analitiku (FastAPI) — Kafka consumer + Tumbling Window + logovanje upozorenja

### Testovi konfiguracije posrednika
- [ ] MQTT QoS 0
- [ ] MQTT QoS 1
- [ ] MQTT QoS 2
- [ ] Kafka `acks=0`
- [ ] Kafka `acks=1`
- [ ] Kafka `acks=all`

### Eksperimentalni scenariji
- [ ] Scenario A — MQTT: 100 uređaja
- [ ] Scenario A — MQTT: 1000 uređaja
- [ ] Scenario A — MQTT: 10000 uređaja
- [ ] Scenario A — Kafka: 100 uređaja
- [ ] Scenario A — Kafka: 1000 uređaja
- [ ] Scenario A — Kafka: 10000 uređaja
- [ ] Scenario B — MQTT: mrežni prekid + ponovano priključivanje + analiza oporavka
- [ ] Scenario B — Kafka: mrežni prekid + ponovo priključivanje + analiza oporavka
- [ ] Scenario C — MQTT: burst 50 → 5000 poruci/s
- [ ] Scenario C — Kafka: burst 50 → 5000 poruci/s
- [ ] Scenario D — MQTT: end-to-end kašnjenje upozorenja izmereno (min/avg/p95/maks)
- [ ] Scenario D — Kafka: end-to-end kašnjenje upozorenja izmereno (min/avg/p95/maks)

### Alati za benchmark
- [ ] emqtt-bench ili k6+MQTT: instalirani, smoke-testirani
- [ ] kafka-producer-perf-test.sh ili k6+xk6-kafka: instalirani, smoke-testirani
- [ ] `docker stats` izlaz sačuvan i arhiviran za sve scenarije

### Izveštaj i isporučevine
- [ ] Tabela poređenja performansi u potpunosti popunjena
- [ ] Pitanje 1 odgovoreno (MQTT ivica vs. analitika)
- [ ] Pitanje 2 odgovoreno (Kafka cloud cena, ivična izvodljivost)
- [ ] Svi sirovi rezultati arhivirani u `results/`
- [ ] Git repozitorijum sa smislenom istorijom commit-ova

---

*Poslednje ažuriranje: jun 2026. — revidirano za unifikovanu adapter-pattern arhitekturu, TimescaleDB hypertable, `seq`/`sent_at_ms` polja za merenje, size-OR-time batch flush i dvostruku metriku kašnjenja.*
*Izvor: IoTS Projekat 2 specifikacija + Environmental Sensor Telemetry dataset*
