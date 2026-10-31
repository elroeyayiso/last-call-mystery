# Last Call: Who Did It?

A room-code detective party game for 2–6 players. Players investigate a theft, share or conceal private clues, face a chaos event, and cast secret votes to catch the thief.

## Run it locally

Requires Node.js 20 or newer. No package installation is needed.

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). To choose a different port, set `PORT`, for example `PORT=8080 npm start`.

To play across devices on the same network, run the server on a computer reachable by the others and open that computer's LAN address on each device. For play over the internet, deploy this directory to a host that supports a long-running Node.js server and HTTPS.

## How a round works

1. Create a room, share its six-character code, and wait for at least one other player.
2. The host starts the case. Each player receives a secret role and clue.
3. Discuss evidence for five minutes. Each player can reveal their clue once.
4. A random chaos event starts for three minutes, followed by two minutes of secret voting.
5. A tie triggers a 30-second runoff. A second tie lets the thief escape. The game reveals roles and scores, and the host can replay.

With two players, the game assigns one Thief and one Detective. The Detective receives a witness-backed lead naming the Thief; the Thief must persuade them to vote the other way. With three to six players, one Thief is assigned along with a Detective, and Witness/Guest roles.

## Multiplayer and privacy

The server owns room state and validates who can start, reveal a clue, or vote and when. Each client receives its own role and clue, public clues, and public vote progress; role identities and vote choices are withheld until the result. A random reconnect token is saved in that browser's local storage.

Rooms are stored in server memory. Restarting the server clears rooms and scores. Deploying the game publicly requires a persistent Node.js service; a static file host alone will not support multiplayer rooms.
