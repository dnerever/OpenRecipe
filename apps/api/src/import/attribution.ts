/**
 * Who to credit for an imported recipe.
 *
 * A Notion export carries a link and nothing else — no byline, no author field.
 * So what can honestly be cited is the **publication**, not the person: "Adapted
 * from Budget Bytes", with the URL alongside it so a reader can go and see whose
 * recipe it actually is. Naming a human we never read would be inventing one.
 *
 * A later pass that fetches each URL can do better — schema.org `Recipe` markup
 * carries an `author`, and that is the right place to upgrade this from the site
 * to the cook.
 */

/**
 * Hosts worth spelling properly, because a bare domain reads as a URL rather
 * than as a name. Everything else falls back to its hostname, which is always
 * accurate even when it is ugly — a citation that is right and plain beats a
 * guessed title-casing of `thedeliciouscrescent.com`.
 */
const PUBLICATIONS: Record<string, string> = {
  'ahealthylifeforme.com': 'A Healthy Life For Me',
  'ambitiouskitchen.com': 'Ambitious Kitchen',
  'archive.is': 'archive.is',
  'biggerbolderbaking.com': 'Bigger Bolder Baking',
  'brokebankvegan.com': 'Broke Bank Vegan',
  'budgetbytes.com': 'Budget Bytes',
  'classycooking.co': 'Classy Cooking',
  'cooking.nytimes.com': 'NYT Cooking',
  'cookingforpeanuts.com': 'Cooking for Peanuts',
  'cookwithmanali.com': 'Cook With Manali',
  'delishknowledge.com': 'Delish Knowledge',
  'drivemehungry.com': 'Drive Me Hungry',
  'forkinthekitchen.com': 'Fork in the Kitchen',
  'gimmesomeoven.com': 'Gimme Some Oven',
  'hamiltonbeach.com': 'Hamilton Beach',
  'healthynibblesandbits.com': 'Healthy Nibbles',
  'heartbeetkitchen.com': 'Heartbeet Kitchen',
  'holycowvegan.net': 'Holy Cow Vegan',
  'hungryhappens.net': 'Hungry Happens',
  'instagram.com': 'Instagram',
  'itdoesnttastelikechicken.com': "It Doesn't Taste Like Chicken",
  'jocooks.com': 'Jo Cooks',
  'kathysvegankitchen.com': "Kathy's Vegan Kitchen",
  'kingarthurbaking.com': 'King Arthur Baking',
  'lovingitvegan.com': 'Loving It Vegan',
  'mealime.com': 'Mealime',
  'minimalistbaker.com': 'Minimalist Baker',
  'myplantifulcooking.com': 'Plantiful Cooking',
  'noracooks.com': 'Nora Cooks',
  'plantyou.com': 'PlantYou',
  'rainbownourishments.com': 'Rainbow Nourishments',
  'rainbowplantlife.com': 'Rainbow Plant Life',
  'schoolnightvegan.com': 'School Night Vegan',
  'sweetpeasandsaffron.com': 'Sweet Peas and Saffron',
  'sweetsimplevegan.com': 'Sweet Simple Vegan',
  'tasty.co': 'Tasty',
  'thecreativebite.com': 'The Creative Bite',
  'thedeliciouscrescent.com': 'The Delicious Crescent',
  'thekampungvegan.com': 'The Kampung Vegan',
  'themediterraneandish.com': 'The Mediterranean Dish',
  'theplantbasedschool.com': 'The Plant Based School',
  'theveganatlas.com': 'The Vegan Atlas',
  'thewoksoflife.com': 'The Woks of Life',
  'thiswifecooks.com': 'This Wife Cooks',
  'tyberrymuch.com': 'Ty Berry Much',
  'veganjapanese.com': 'Vegan Japanese',
  'veggiefunkitchen.com': 'Veggie Fun Kitchen',
  'veggiessavetheday.com': 'Veggies Save The Day',
  'wanderingchickpea.com': 'Wandering Chickpea',
};

/**
 * The publication behind a URL, or `null` if it is not a URL at all.
 *
 * Subdomains are tried before the bare domain so `cooking.nytimes.com` can be
 * "NYT Cooking" rather than "The New York Times", and a redirector such as
 * `r.mealime.com` still resolves to its publication.
 */
export function attributionFor(url: string): string | null {
  let host: string;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  if (host === '') return null;

  const named = PUBLICATIONS[host];
  if (named) return named;

  // `r.mealime.com` → try `mealime.com`, then `com` (which will not match).
  const labels = host.split('.');
  for (let i = 1; i < labels.length - 1; i++) {
    const suffix = labels.slice(i).join('.');
    const match = PUBLICATIONS[suffix];
    if (match) return match;
  }

  return host;
}
