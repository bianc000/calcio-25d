# ⚽ MSoccer (Calcio 2.5D Multiplayer 3v3)

Un gioco di calcio in stile arcade 2.5D in tempo reale con grafica Three.js e multiplayer online Peer-to-Peer (WebRTC tramite PeerJS). Sfida un tuo amico direttamente dal browser, senza installare nulla e senza server proprietari!

🎮 **Gioca online subito:** [https://bianc000.github.io/calcio-25d/](https://bianc000.github.io/calcio-25d/)

---

## 🌟 Caratteristiche Principali

- **Visuale & Grafica 2.5D:** Campo da calcio con illuminazione da stadio, ombre dinamiche in tempo reale, strisce d'erba tagliate, porte e reti 3D, spalti e cartelloni pubblicitari LED.
- **Multiplayer Online Istantaneo (WebRTC PeerJS):** 
  - Crea una stanza con un click.
  - Genera un link diretto condivisibile (es. via WhatsApp, Telegram, Discord).
  - L'amico apre il link e si connette direttamente peer-to-peer con bassissima latenza!
- **Partite 3 Contro 3:**
  - Ogni giocatore controlla attivamente un atleta alla volta (cambio rapido con Spazio / Q).
  - Gli altri 2 compagni di squadra sono guidati da un'IA tattica (supporto offensivo, marcatura difensiva e copertura della porta).
- **Fisica Vettoriale Completa:** Palla con gravità, rimbalzi elastici, attrito del manto erboso, impatto sui pali/traversa e rete che blocca il tiro.
- **Audio Procedurale (Web Audio API):** Fischi dell'arbitro, colpi sul pallone, rintocco metallico sui pali, boato della folla per il GOOOL!
- **Controlli Touch per Smartphone e Tablet:** Joystick analogico virtuale e pulsanti grandi per giocare da mobile.
- **Aggiornamento Continuo Online (CI/CD):** Ogni modifica inviata su GitHub va direttamente online tramite GitHub Actions.

---

## 👥 I 12 Personaggi Giocabili

Prima di ogni match, ogni squadra sceglie 3 campioni tra i 12 disponibili:

| Personaggio | Ruolo / Soprannome | Specialità | Caratteristiche |
| :--- | :--- | :--- | :--- |
| **Ento** | *Il Cannoniere* | Cannone Infuocato | Fisico possente e tiro al fulmicotone micidiale (Tiro: 96) |
| **Lindi** | *Il Cervello* | Lancio Laser | Regista di altissima classe, passaggi al millimetro (Passaggio: 98) |
| **Matti** | *La Saetta* | Scatto Fulmineo | Velocità supersonica sulle corsie esterne (Velocità: 98) |
| **Bubi** | *Il Muro* | Tackle Roccia | Colosso difensivo insuperabile nei contrasti (Contrasto: 98) |
| **Lollo** | *Il Fantasista* | Tiro a Giro | Dribbling ubriacante e tiri a giro spettacolari (Tiro: 91, Passaggio: 90) |
| **Ara** | *Il Metronomo* | Intercetto Flash | Recupera palloni a centrocampo e avvia il contropiede (Difesa: 89) |
| **Roby** | *Il Cecchino* | Mirino Infallibile | Freddezza glaciale sotto porta, mira all'incrocio (Tiro: 95) |
| **Pibe** | *Il Fenomeno* | Rabona Magica | Il classico numero 10: baricentro basso e colpi magici (Tiro: 93, Passaggio: 93) |
| **Jelmo** | *La Saracinesca* | Paratona Felina | Riflessi prodigiosi tra i pali e rinvii lunghissimi (Contrasto/Parate: 96) |
| **Jona** | *Il Gladiatore* | Pressing Furioso | Grinta da vendere e pressing asfissiante per 90 minuti (Difesa: 94) |
| **Kri** | *Il Cobra* | Tiro Velenoso | Scatto fulmineo e conclusioni insidiose da fuori area (Velocità: 94, Tiro: 92) |
| **Leon** | *Il Capitano* | Spirito da Leader | Leader carismatico, forte di testa e completo in ogni reparto (Tiro: 90, Dif: 88, Pass: 89) |

---

## 🕹️ Comandi di Gioco

### Su Computer (Tastiera)
- **Movimento:** Tasti Freccia oppure `W`, `A`, `S`, `D`
- **Sprint / Corsa:** Tieni premuto `SHIFT`
- **Tiro in Porta:** Tasto `X` o `K` (tieni premuto per caricare la potenza, rilascia per calciare)
- **Passaggio:** Tasto `Z` o `J` (passaggio rasoterra o filtrante al compagno)
- **Scivolata / Contrasto:** Tasto `X` o `K` (quando non si ha il possesso palla)
- **Cambio Giocatore:** `Barra Spaziatrice` o `Q` (seleziona all'istante il compagno più vicino alla palla)
- **Pausa Partita:** Tasto `ESC` o `P` (o pulsante ⏸️ PAUSA sulla barra superiore)

### Su Dispositivi Mobili (Smartphone / Tablet)
- **Joystick analogico a sinistra:** Guida il giocatore
- **Pulsanti a destra:** `TIRO` (caricamento potenza al tocco), `PASS` (passaggio), `CAMBIA` (selezione compagno)

---

## 🌐 Come Giocare Online con un Amico

1. Apri il sito del gioco: [https://bianc000.github.io/calcio-25d/](https://bianc000.github.io/calcio-25d/)
2. Clicca su **"Gioca Online con Amici"**.
3. Clicca su **"Crea Nuova Partita (Host)"**: comparirà il codice stanza e il pulsante **"Copia Link Partita"**.
4. Invia il link o il codice al tuo amico via WhatsApp / Telegram.
5. Quando il tuo amico apre il link o inserisce il codice e clicca su **"Unisciti"**, la connessione peer-to-peer WebRTC si stabilisce in pochi istanti.
6. Selezionate i vostri 3 campioni preferiti e date il fischio d'inizio!

---

## 🚀 Struttura del Progetto

```
calcio-25d/
├── .github/
│   └── workflows/
│       └── deploy.yml       # Deploy automatico su GitHub Pages ad ogni push
├── css/
│   └── style.css            # Stile arcade moderno, HUD e responsive layout
├── js/
│   ├── app.js               # Logica applicativa, gestione UI, draft e matchmaking
│   ├── characters.js        # Schede e statistiche dei 12 personaggi giocabili
│   ├── game.js              # Motore 2.5D Three.js, fisica della palla, IA compagni
│   ├── network.js           # Netcode P2P WebRTC con PeerJS
│   └── audio.js             # Effetti sonori procedurali (Web Audio API)
├── index.html               # Pagina principale HTML5
└── README.md
```
