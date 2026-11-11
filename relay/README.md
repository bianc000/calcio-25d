# MSoccer WebSocket Relay (Cloudflare Workers + Durable Objects)

Server WebSocket serverless gratuito per far giocare gli amici di **MSoccer** su Wi-Fi diversi, reti universitarie, 4G/5G e Safari iOS senza configurare TURN o porte router.

## Costi
Usa il piano **Cloudflare Workers Free**:
- **100.000 richieste HTTP/WS-upgrade al giorno** gratuite (ogni giocatore che entra in una stanza consuma solo 1 richiesta di apertura; i pacchetti di gioco scambiati dentro il WebSocket aperto non consumano quota richieste!).
- **WebSocket Hibernation API**: tra un tick e l'altro non spreca CPU attiva.

## Deploy rapido (3 comandi da Terminale)

Prerequisito: [Node.js](https://nodejs.org/) (o `brew install node`).

```bash
cd relay
npm install
npx wrangler login
npx wrangler deploy
```

Al termine `wrangler deploy` stamperà il tuo URL pubblico, ad esempio:
`https://msoccer-relay.<tuo-nome>.workers.dev`

## Collegamento al gioco (zero configurazione per gli amici)

1. Apri `js/network.js` alla riga:
   ```js
   export const DEFAULT_RELAY_URL = 'wss://msoccer-relay.<tuo-nome>.workers.dev';
   ```
   *(inserendo il tuo URL con `wss://` al posto di `https://`)*
2. Fai commit e push su GitHub (`git add js/network.js && git commit -m "Enable default Cloudflare WS relay" && git push`).
3. Da quel momento chiunque apra `https://bianc000.github.io/calcio-25d/` giocherà su qualsiasi Wi-Fi/4G/Safari in automatico!

> **Opzione alternativa senza editing immediato**: incolla l'URL `wss://...workers.dev` direttamente nelle impostazioni di rete del gioco; il link d'invito copiato includerà automaticamente `&relay=...` per gli amici.
