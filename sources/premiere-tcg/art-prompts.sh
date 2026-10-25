#!/bin/zsh
# Erzeugt die Kartenillustrationen für den TCG-Gameplan, 4 Bilder parallel.
set -u
S=${0:A:h}
GEN=$S/scripts/art/codex_image.sh
STYLE="Painterly fantasy trading-card illustration in the style of classic collectible card game art: rich oil-paint texture, dramatic theatrical stage lighting with warm spotlights and deep shadows, cinematic composition, high detail. Landscape format 4:3. Absolutely no text, no letters, no numbers, no card frame, no border, no logo, no watermark. Any people are fictional, generic and not portraits of real persons."

typeset -A P
P[land-wueste]="A sun-scorched Wild West desert at golden hour: red rock mesas, an old wooden gold-mine entrance with rails and a lantern, a lonely saloon in the distance, dust in the air. Dominant palette deep red, orange and ochre."
P[land-piratenbucht]="A hidden Caribbean pirate cove in 1715 at dusk: a three-masted pirate ship anchored in turquoise water, a wooden jetty with barrels and lanterns, palm trees, distant storm clouds. Dominant palette deep blue and teal."
P[land-kanalisation]="A dystopian sewer tunnel beneath a ruined megacity in the year 2086: wet brick arches, dark water, rusted pipes, flickering violet, pink and green neon light leaking through grates, fog. Dominant palette black and deep violet."
P[land-klosterhof]="A bright medieval monastery courtyard in morning light: white stone cloister arches, a small chapel bell tower, a well, herb garden, doves, soft heavenly rays of light. Dominant palette white, cream and pale gold."
P[land-wald]="An ancient medieval forest at the edge of a village: huge mossy oaks, a winding path towards a castle on a hill, a jugglers' cart with colourful banners, dappled sunlight. Dominant palette rich greens."
P[rolle-lucy]="A fearless young heroine in a Victorian gothic dress holding a candelabra in a haunted mansion corridor, portraits on the walls, ghostly mist, she looks ready to face the darkness. Palette purple and black with warm candle light."
P[rolle-drusilla]="A pale, elegant gothic noblewoman in a dark velvet gown delivering a passionate monologue on a moonlit balcony of a haunted manor, one hand raised dramatically, bats in the night sky. Palette violet and silver."
P[rolle-clara]="A curious young woman with a lantern searching a dusty attic of a haunted house, old trunks, a mysterious doll and cobwebs, she leans forward questioning. Palette purple with warm lantern glow."
P[rolle-johanna]="Split composition showing the same medieval woman twice: on the left a cheerful young girl in a simple peasant dress in a sunny meadow, on the right her older wise self in a cloak by a hearth fire, an hourglass motif between them. Palette greens and warm browns."
P[rolle-jacques]="A nervous, lanky butler in an old-fashioned tailcoat peeking out from behind a heavy door in a gothic mansion, holding a silver tray, comic expression. Palette purple and dark wood."
P[zauber-blitz]="A violent thunderstorm with bright lightning bolts striking over a gothic manor on a theatre stage, curtains at the edges, rain, dramatic flash. Palette dark blue-grey with white lightning."
P[requisite-schwert]="A medieval longsword and an ornate dagger lying crossed on a weathered wooden prop table backstage of a theatre, a spotlight beam, velvet cloth, rope and stage ropes in the background. Palette warm brown and steel."
P[hero-buehne]="A grand theatre stage with heavy red velvet curtains opening, golden spotlights, and five giant glowing trading cards floating above the stage like actors, each card glowing in one colour: red, blue, black, white, green. Magical sparks. Wide cinematic view from the audience."
P[kartenrueckseite]="A symmetrical ornate card back design: theatre comedy and tragedy masks in the centre on deep red velvet, golden filigree ornaments, curtain tassels in the corners, art nouveau style. Portrait orientation 63:88, still no text."

run() { $GEN "$S/raw/$1.png" "$STYLE

${P[$1]}" > /dev/null 2>> "$S/errors.log" && echo "ok $1" || echo "FEHLER $1"; }
names=(${(k)P})
i=0
for n in $names; do
  [[ -s "$S/raw/$n.png" ]] && { echo "vorhanden $n"; continue }
  run $n &
  (( ++i % 4 == 0 )) && wait
done
wait
echo fertig
