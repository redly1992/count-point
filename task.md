implement a web app, help me to record and count point after a round, should ask me when you not clear some point
- Create a simple web app using HTML, CSS, and JavaScript.
- The app should have a button to start a session include multiple rounds
- Have function to Configure number of players, name, color 's player and points per round

* Interface:
  - A button to start the session.
  - When a session starts, the app should display the current round, player scores, and total points.
  - Eg: if 2 players, display a square divided by 2, 3 player: a circle is divided into 3 equal parts, 4 players: a square is divided into 4 equal parts, and so on. Call it player area.
  - Player area should display name, current total point for that round.
  - A area 's player need filled by color config before corresponding to player, show sub: (name, total score of current session) and main: (player scores for current round, default is 0)
  - In round, should have one Subtract/Add button to update state is adding/subtrating
  - Every time tap the player 's area, the points will be added/remove current round point by the points default points per round for that player (following current state of adding/subtracting)
  - A button to end the session. Then should the final scores and winner.
  - UI should be nice, and have vibe cartoon, colorful, and fun.
  - Run good in mobile.
  - Use local storage to save the session data, so that if the user accidentally refresh the page, the data will not be lost.
