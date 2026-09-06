// Chat is anonymous and open to anyone with the link, so this is a blunt
// first line of defense: a fixed list of words/phrases that get a message
// blocked before it's ever sent. Covers English and Spanish since guests
// may type in either. Matches whole words/phrases only (not substrings
// buried inside an unrelated word), so "classical" won't trip on "ass".
// Edit either list any time — no redeploy steps beyond a normal code push.

const ENGLISH_BANNED = [
  '2g1c', '2 girls 1 cup', 'acrotomophilia', 'alabama hot pocket', 'alaskan pipeline',
  'anal', 'anilingus', 'anus', 'apeshit', 'arsehole', 'ass', 'asshole', 'assmunch',
  'auto erotic', 'autoerotic', 'babeland', 'baby batter', 'baby juice', 'ball gag',
  'ball gravy', 'ball kicking', 'ball licking', 'ball sack', 'ball sucking', 'bangbros',
  'bangbus', 'bareback', 'barely legal', 'barenaked', 'bastard', 'bastardo', 'bastinado',
  'bbw', 'bdsm', 'beaner', 'beaners', 'beaver cleaver', 'beaver lips', 'beastiality',
  'bestiality', 'big black', 'big breasts', 'big knockers', 'big tits', 'bimbos',
  'birdlock', 'bitch', 'bitches', 'black cock', 'blonde action', 'blonde on blonde action',
  'blowjob', 'blow job', 'blow your load', 'blue waffle', 'blumpkin', 'bollocks',
  'bondage', 'boner', 'boob', 'boobs', 'booty call', 'brown showers', 'brunette action',
  'bukkake', 'bulldyke', 'bullet vibe', 'bullshit', 'bung hole', 'bunghole', 'busty',
  'butt', 'buttcheeks', 'butthole', 'camel toe', 'camgirl', 'camslut', 'camwhore',
  'carpet muncher', 'carpetmuncher', 'chocolate rosebuds', 'cialis', 'circlejerk',
  'cleveland steamer', 'clit', 'clitoris', 'clover clamps', 'clusterfuck', 'cock',
  'cocks', 'coprolagnia', 'coprophilia', 'cornhole', 'coon', 'coons', 'creampie', 'cum',
  'cumming', 'cumshot', 'cumshots', 'cunnilingus', 'cunt', 'darkie', 'date rape',
  'daterape', 'deep throat', 'deepthroat', 'dendrophilia', 'dick', 'dildo', 'dingleberry',
  'dingleberries', 'dirty pillows', 'dirty sanchez', 'doggie style', 'doggiestyle',
  'doggy style', 'doggystyle', 'dog style', 'dolcett', 'domination', 'dominatrix',
  'dommes', 'donkey punch', 'double dong', 'double penetration', 'dp action', 'dry hump',
  'dvda', 'eat my ass', 'ecchi', 'ejaculation', 'erotic', 'erotism', 'escort', 'eunuch',
  'fag', 'faggot', 'fecal', 'felch', 'fellatio', 'feltch', 'female squirting', 'femdom',
  'figging', 'fingerbang', 'fingering', 'fisting', 'foot fetish', 'footjob', 'frotting',
  'fuck', 'fuck buttons', 'fuckin', 'fucking', 'fucktards', 'fudge packer', 'fudgepacker',
  'futanari', 'gangbang', 'gang bang', 'gay sex', 'genitals', 'giant cock', 'girl on',
  'girl on top', 'girls gone wild', 'goatcx', 'goatse', 'god damn', 'gokkun',
  'golden shower', 'goodpoop', 'goo girl', 'goregasm', 'grope', 'group sex', 'g-spot',
  'guro', 'hand job', 'handjob', 'hard core', 'hardcore', 'hentai', 'homoerotic',
  'honkey', 'hooker', 'horny', 'hot carl', 'hot chick', 'how to kill', 'how to murder',
  'huge fat', 'humping', 'incest', 'intercourse', 'jack off', 'jail bait', 'jailbait',
  'jelly donut', 'jerk off', 'jigaboo', 'jiggaboo', 'jiggerboo', 'jizz', 'juggs', 'kike',
  'kinbaku', 'kinkster', 'kinky', 'knobbing', 'leather restraint', 'leather straight jacket',
  'lemon party', 'livesex', 'lolita', 'lovemaking', 'make me come', 'male squirting',
  'masturbate', 'masturbating', 'masturbation', 'menage a trois', 'milf',
  'missionary position', 'mong', 'motherfucker', 'mound of venus', 'mr hands',
  'muff diver', 'muffdiving', 'nambla', 'nawashi', 'negro', 'neonazi', 'nigga', 'nigger',
  'nig nog', 'nimphomania', 'nipple', 'nipples', 'nsfw', 'nsfw images', 'nude', 'nudity',
  'nutten', 'nympho', 'nymphomania', 'octopussy', 'omorashi', 'one cup two girls',
  'one guy one jar', 'orgasm', 'orgy', 'paedophile', 'paki', 'panties', 'panty',
  'pedobear', 'pedophile', 'pegging', 'penis', 'phone sex', 'piece of shit', 'pikey',
  'pissing', 'piss pig', 'pisspig', 'playboy', 'pleasure chest', 'pole smoker',
  'ponyplay', 'poof', 'poon', 'poontang', 'punany', 'poop chute', 'poopchute', 'porn',
  'porno', 'pornography', 'prince albert piercing', 'pthc', 'pubes', 'pussy', 'queaf',
  'queef', 'quim', 'raghead', 'raging boner', 'rape', 'raping', 'rapist', 'rectum',
  'reverse cowgirl', 'rimjob', 'rimming', 'rosy palm', 'rosy palm and her 5 sisters',
  'rusty trombone', 'sadism', 'santorum', 'scat', 'schlong', 'scissoring', 'semen',
  'sex', 'sexcam', 'sexo', 'sexy', 'sexual', 'sexually', 'sexuality', 'shaved beaver',
  'shaved pussy', 'shemale', 'shibari', 'shit', 'shitblimp', 'shitty', 'shota',
  'shrimping', 'skeet', 'slanteye', 'slut', 's&m', 'smut', 'snatch', 'snowballing',
  'sodomize', 'sodomy', 'spastic', 'spic', 'splooge', 'splooge moose', 'spooge',
  'spread legs', 'spunk', 'strap on', 'strapon', 'strappado', 'strip club',
  'style doggy', 'suck', 'sucks', 'suicide girls', 'sultry women', 'swastika',
  'swinger', 'tainted love', 'taste my', 'tea bagging', 'threesome', 'throating',
  'thumbzilla', 'tied up', 'tight white', 'tit', 'tits', 'titties', 'titty',
  'tongue in a', 'topless', 'tosser', 'towelhead', 'tranny', 'tribadism', 'tub girl',
  'tubgirl', 'tushy', 'twat', 'twink', 'twinkie', 'two girls one cup', 'undressing',
  'upskirt', 'urethra play', 'urophilia', 'vagina', 'venus mound', 'viagra', 'vibrator',
  'violet wand', 'vorarephilia', 'voyeur', 'voyeurweb', 'voyuer', 'vulva', 'wank',
  'wetback', 'wet dream', 'white power', 'whore', 'worldsex', 'wrapping men',
  'wrinkled starfish', 'xx', 'xxx', 'yaoi', 'yellow showers', 'yiffy', 'zoophilia',
  // Kept from the site's own original short list — not a slur, but blocked here on request.
  'gay',
];

const EXTRA_ENGLISH_BANNED = [
  '1 man 1 jar', '1m1j', '1man1jar', '2 girls 1 cup', '2g1c', '2girls1cup', 'acrotomophile',
  'acrotomophilia', 'alabama hot pocket', 'alabama tuna melt', 'alaskan pipeline', 'algophile',
  'algophilia', 'anal', 'anal assassin', 'anal astronaut', 'anilingus', 'anus', 'ape shit',
  'ape-shit', 'apeshit', 'apotemnophile', 'apotemnophilia', 'arse', 'arse bandit', 'arsehole',
  'ass', 'ass bandit', 'asshole', 'auto erotic', 'autoerotic', 'babeland', 'baby batter',
  'baby gravy', 'baby juice', 'ball batter', 'ball gag', 'ball gravy', 'ball kicking',
  'ball licking', 'ball sack', 'ball sucking', 'ball-gag', 'ball-kicking', 'ball-licking',
  'ball-sucking', 'ballcuzi', 'ballgag', 'bang bros', 'bang bus', 'bangbros', 'bangbus',
  'bareback', 'barely legal', 'bastard', 'bastinado', 'batty boi', 'batty boy', 'battyboi',
  'battyboy', 'bdsm', 'bean flicker', 'bean queen', 'bean-flicker', 'beaner', 'beaners',
  'beanflicker', 'beastiality', 'beaver cleaver', 'beaver lips', 'beestiality', 'bellend',
  'bellesa', 'bestiality', 'bicon', 'big boobs', 'big breasts', 'big cock', 'big knockers',
  'big tits', 'birdlock', 'bitch', 'bitches', 'black cock', 'bloody', 'blow job', 'blow your load',
  'blow-job', 'blowjob', 'blue waffle', 'bluewaffle', 'blumpkin', 'bollocks', 'bone smuggler',
  'bone-smuggler', 'boner', 'bonesmuggler', 'boob', 'booty buffer', 'booty call', 'booty-buffer',
  'boston george', 'breasts', 'brown piper', 'brown shower', 'brown showers', 'brown-piper',
  'brownie king', 'brownie queen', 'brownpiper', 'buddha head', 'buddha-head', 'buddhahead',
  'bufter', 'bufty', 'bugger', 'bukkake', 'bull shit', 'bull-shit', 'bulldyke', 'bullet vibe',
  'bullet vibrator', 'bullshit', 'bum boy', 'bum chum', 'bum driller', 'bum pilot', 'bum pirate',
  'bum rider', 'bum robber', 'bum rustler', 'bum-boy', 'bum-chum', 'bum-driller', 'bum-pirate',
  'bum-robber', 'bumboy', 'bumchum', 'bumdriller', 'bumhole engineer', 'bumrider', 'bumrobber',
  'butt boy', 'butt pilot', 'butt pirate', 'butt rider', 'butt robber', 'butt rustler', 'butt-boy',
  'butt-pirate', 'butt-robber', 'buttboy', 'butthole engineer', 'buttrider', 'buttrobber',
  'camel jockey', 'camel jockies', 'camel toe', 'cameljockey', 'cameljockies',
  'canadian porch swing', 'carpet muncher', 'carpetmuncher', 'cheese eating surrender monkey',
  'cheese-eating surrender monkey', 'chi chi man', 'chi-chi man', 'chicken queen', 'china man',
  'china men', 'chinaman', 'chinamen', 'ching chong', 'ching-chong', 'chink', 'chinks', 'chinky',
  'chocolate rosebud', 'chocolate rosebuds', 'cholerophile', 'cholerophilia', 'christ', 'cialis',
  'circle-jerk', 'circlejerk', 'cishet', 'cissie', 'cissy', 'claustrophile', 'claustrophilia',
  'cleveland accordion', 'cleveland hot waffle', 'cleveland steamer', 'clit', 'clitoris',
  'clover clamp', 'clover clamps', 'clunge', 'cluster fuck', 'cluster-fuck', 'clusterfuck',
  'cock', 'cockpipe cosmonaut', 'cockstruction worker', 'coimetrophile', 'coimetrophilia',
  'collared', 'collaring', 'coon', 'coons', 'coprolagnia', 'coprophile', 'coprophilia',
  'cornhole', 'crafty butcher', 'crap', 'cream-pie', 'creampie', 'cum', 'cum shot', 'cum shots',
  'cumming', 'cumshot', 'cumshots', 'cunnilingus', 'cunt', 'cunt boy', 'cunt-boy', 'cuntboy',
  'cunts', 'curry muncher', 'curry-muncher', 'currymuncher', 'damn', 'darkey', 'darkie', 'darkies',
  'darky', 'date rape', 'daterape', 'ddlg', 'deep throat', 'deep-throat', 'deepthroat',
  'dendrophile', 'dendrophilia', 'dick', 'dick girl', 'dick-girl', 'dickgirl', 'dildo', 'dildos',
  'dingleberries', 'dingleberry', 'dipsea', 'dirty pillows', 'dirty sanchez', 'dishabiliophile',
  'dishabiliophilia', 'dog shit', 'dog style', 'dog-shit', 'doggie style', 'doggie-style',
  'doggiestyle', 'doggy style', 'doggy-style', 'doggystyle', 'dogshit', 'dolcett', 'domination',
  'dominatrix', 'domme', 'dommes', 'donkey punch', 'donut muncher', 'donut puncher', 'doon coon',
  'dooncoon', 'double penetration', 'dp action', 'dry hump', 'dune coon', 'dune-coon',
  'dutch rudder', 'dyke', 'dystychiphile', 'dystychiphilia', 'edge play', 'edgeplay', 'ejaculate',
  'ejaculated', 'ejaculating', 'ejaculation', 'electro-play', 'electroplay', 'emetophile',
  'emetophilia', 'enby', 'eskimo trebuchet', 'eye-tie', 'eyetie', 'fag', 'fag bomb', 'fag-bomb',
  'fagbomb', 'faggot', 'fagot', 'felch', 'felching', 'fellating', 'fellatio', 'female squirting',
  'figging', 'finger bang', 'fingerbang', 'fingerbanging', 'fingered', 'fingering', 'finocchio',
  'finoccio', 'finochio', 'fisted', 'fisting', 'foot job', 'foot-job', 'footjob', 'french rudder',
  'frog eater', 'frog-eater', 'frogeater', 'frolic me', 'frolicme', 'frottage', 'frotting', 'fuck',
  'fuck-wit', 'fucken', 'fucker', 'fuckers', 'fuckhead', 'fuckheads', 'fuckin', 'fucking', 'fucks',
  'fucktard', 'fucktards', 'fuckwad', 'fuckwads', 'fuckwhit', 'fuckwit', 'fuckwits', 'fudge packer',
  'fudge-packer', 'fudgepacker', 'futanari', 'g-spot', 'gang bang', 'gangbang', 'gay sex',
  'gaysian', 'genitals', 'genitorture', 'gerontophile', 'gerontophilia', 'giant cock',
  'gin jockey', 'gin jocky', 'girl on top', 'go-kun', 'goatcx', 'goatse', 'god damn',
  'god damned', 'god-damn', 'god-damned', 'goddamn', 'goddamned', 'gokkun', 'golden shower',
  'golden showers', 'golliwog', 'gollywog', 'gook', 'gook-eye', 'gookie', 'gooks', 'gooky',
  'goregasm', 'gray queen', 'greaseball', 'grey queen', 'grope', 'group sex', 'gym bunny',
  'gymbunny', 'hadji', 'haji', 'hajji', 'hand job', 'hand-job', 'handjob', 'heimie', 'hell',
  'hermie', 'hickory switch', 'hippophile', 'hippophilia', 'homoerotic', 'honkey', 'honkeys',
  'honkies', 'honky', 'horny', 'horse shit', 'horse-shit', 'horseshit', 'hot carl', 'hot richard',
  'huge cock', 'humping', 'hymie', 'impact play', 'impact-play', 'incest', 'intercourse',
  'jack off', 'jack-off', 'jail bait', 'jailbait', 'jap', 'jelly donut', 'jerk mate', 'jerk off',
  'jerk-off', 'jerkmate', 'jesus', 'jesus christ', 'jigaboo', 'jiggerboo', 'jizz', 'juggs',
  'jungle bunny', 'junglebunny', 'kennebunkport surprise', 'kentucky klondike',
  'kentucky tractor puller', 'kike', 'kinbaku', 'kitty puncher', 'kitty-puncher', 'kittypuncher',
  'knobbing', 'kraut', 'krauts', 'kunt', 'kunts', 'kynophile', 'kynophilia', 'lady boy',
  'lady-boy', 'ladyboy', 'leather restraint', 'leather straight jacket', 'lemon party',
  'lemonparty', 'leningrad steamer', 'lesbo', 'leso', 'lezzie', 'lezzies', 'light in the fedora',
  'light in the loafers', 'light in the pants', 'limp wristed', 'limp-wristed', 'literotica',
  'lovemaking', 'male squirting', 'male-squirting', 'massive cock', 'masterb8', 'masterbate',
  'masturb8', 'masturbate', 'masturbating', 'masturbation', 'mayonnaise monkey',
  'mayonnaise monkies', 'mdlb', 'meat masseuse', 'meat spin', 'meatspin', 'menage a trois',
  'menage-a-trois', 'menages a trois', 'menages-a-trois', 'menophile', 'menophilia',
  'mexican pancake', 'milwaukee blizzard', 'missionary position', 'mississippi birdbath',
  'mound of venus', 'mr hands', 'mr. hands', 'mrhands', 'muff diver', 'muff diving', 'muff-diver',
  'muffdiver', 'muffdiving', 'muscle mary', 'mvtube', 'nambla', 'necrophile', 'necrophilia',
  'negro', 'neo nazi', 'neo-nazi', 'neonazi', 'nig nog', 'nigerian hurricane', 'nigga', 'nigger',
  'niggs', 'nignog', 'nimpho', 'nimphomania', 'nimphomaniac', 'nipple', 'nipple clamp',
  'nipple clamps', 'nipples', 'nude', 'nudity', 'nutten', 'nympho', 'nymphomania',
  'nymphomaniac', 'octopussy', 'omorashi', 'one cup two girls', 'one jar one man',
  'one man one jar', 'only fans', 'onlyfans', 'orgasm', 'orgasmic', 'orgasms', 'paedo bear',
  'paedobear', 'paedophile', 'paedophilia', 'pain slut', 'painslut', 'paki',
  'panamanian petting zoo', 'pansy', 'panties', 'parthenophile', 'parthenophilia', 'pedo bear',
  'pedobear', 'pedophile', 'pedophilia', 'pegging', 'penis', 'peter puffer', 'peter-puffer',
  'peterpuffer', 'petrol sniffer', 'petrol-sniffer', 'petrolsniffer', 'phagophile', 'phagophilia',
  'piece of shit', 'pieces of shit', 'pikey', 'pikeys', 'piss off', 'piss pig', 'pissed off',
  'pissing', 'pisspig', 'playboy', 'pleasure chest', 'pnigerophile', 'pnigerophilia', 'pnigophile',
  'pnigophilia', 'poinephile', 'poinephilia', 'pony boy', 'pony girl', 'pony-boy', 'pony-girl',
  'pony-play', 'ponyboy', 'ponygirl', 'ponyplay', 'poof', 'poon', 'poontang', 'poop chute',
  'poopchute', 'porn', 'porn hub', 'pornhub', 'porno', 'pornographic', 'pornography', 'pornos',
  'potato queen', 'prince albert piercing', 'proctophile', 'proctophilia', 'pubes', 'punani',
  'punany', 'pussy', 'pussy puncher', 'pussy-puncher', 'pussypuncher', 'queaf', 'queef', 'quim',
  'rag head', 'rag heads', 'raghead', 'ragheads', 'raging boner', 'ramen yarmulke', 'rape',
  'raping', 'rapist', 'rectum', 'retard', 'retarded', 'reverse cowgirl', 'rhabdophile',
  'rhabdophilia', 'rhypophile', 'rhypophilia', 'rice queen', 'rimjob', 'rimming', 'ring raider',
  'ringraider', 'rusty trombone', 'sand nigger', 'sand-nigger', 'sandnigger', 'santorum',
  'scatophile', 'scatophilia', 'schlong', 'scissoring', 'semen', 'seplophile', 'seplophilia',
  'sex', 'shaved beaver', 'shaved pussy', 'she male', 'she-male', 'sheep shagger',
  'sheepshagger', 'shemale', 'shibari', 'shit', 'shit head', 'shithead', 'shitty', 'shlong',
  'shota', 'shrimping', 'sissy', 'skeet', 'skittle harvest', 'skittles harvest', 'slant eye',
  'slant-eye', 'slanteye', 'snatch', 'snowballing', 'sod off', 'sodding', 'sodomise', 'sodomist',
  'sodomize', 'sodomy', 'spastic', 'spearchucker', 'spic', 'spick', 'spicks', 'spics',
  'spicy gringo', 'splooge', 'splooge moose', 'spooge', 'spunk', 'strap on', 'strap-on',
  'strapon', 'strappado', 'suastika', 'svastika', 'swamp guinea', 'swamp-guinea', 'swastika',
  'switch hitter', 't-girl', 'taphephile', 'taphephilia', 'tea bagged', 'tea bagging',
  'tea-bagged', 'tea-bagging', 'tgirl', 'thanatophile', 'thanatophilia', 'threesome', 'throating',
  'throbbing boner', 'throbbing cock', 'thumbzilla', 'timber nigger', 'timber-nigger',
  'timbernigger', 'tits', 'titties', 'titty', 'topless', 'tosser', 'towel head', 'towel-head',
  'towelhead', 'trannie', 'tranny', 'transbian', 'traumatophile', 'traumatophilia', 'tribadism',
  'tribbing', 'tub girl', 'tubgirl', 'twat', 'twink', 'two girls one cup', 'urethra play',
  'urophile', 'urophilia', 'vagina', 'venus mound', 'viagra', 'vibrator', 'violet wand',
  'vorarephile', 'vorarephilia', 'voyeurweb', 'wagon burner', 'wagon-burner', 'wank', 'wanker',
  'wax play', 'wax-play', 'wet back', 'wet dream', 'wet-back', 'wetback', 'whigger',
  'white power', 'white-power', 'whitepower', 'whore', 'wigga', 'wigger', 'wiitwd', 'wog', 'wogs',
  'wolfbagging', 'worldsex', 'wrapping men', 'wrinkled starfish', 'xhamster', 'xnxx', 'xtube',
  'xvideos', 'xxx', 'xyrophile', 'xyrophilia', 'yellow shower', 'yellow showers', 'zipper head',
  'zipper-head', 'zipperhead', 'zippo cat', 'zippo-cat', 'zippocat', 'zoophile', 'zoophilia',
];

const SPANISH_BANNED = [
  'asesinato', 'asno', 'bastardo', 'bollera', 'cabron', 'caca', 'chupada', 'chupapollas',
  'chupeton', 'concha', 'concha de tu madre', 'cono', 'coprofagia', 'culo', 'drogas',
  'esperma', 'fiesta de salchichas', 'follador', 'follar', 'gilipichis', 'gilipollas',
  'hacer una paja', 'haciendo el amor', 'heroina', 'hija de puta', 'hijaputa',
  'hijo de puta', 'hijoputa', 'idiota', 'imbecil', 'infierno', 'jilipollas', 'kapullo',
  'lameculos', 'maciza', 'macizorra', 'maldito', 'mamada', 'marica', 'maricon',
  'mariconazo', 'martillo', 'mierda', 'nazi', 'orina', 'pedo', 'pendejo', 'pervertido',
  'pezon', 'pinche', 'pis', 'prostituta', 'puta', 'racista', 'ramera', 'sadico', 'semen',
  'sexo', 'sexo oral', 'soplagaitas', 'soplapollas', 'tetas grandes', 'tia buena',
  'travesti', 'trio', 'verga', 'vete a la mierda', 'vulva',
];

// Emoji combos don't have word boundaries like text does, so they're
// checked separately as raw substrings after stripping invisible
// zero-width characters someone might sneak in between them to evade this.
const EMOJI_BANNED = [
  '🖕🤬', '🖕🤬🖕', '✊🍆', '✊🍆💦', '✊🍌', '✊🍌💦', '🍆🍑💦', '🍆👅💦', '🍆👋💦', '🍆💦',
  '🐓💍', '👉🌮', '👉👌', '👌👈', '👐🍅🍅', '🖕', '🤩🍆💦', '🤬🖕',
];

function stripZeroWidth(text) {
  return String(text || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function normalize(text) {
  return stripZeroWidth(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents (coño -> cono) so accented/plain forms both match
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BANNED_PHRASES = [
  ...new Set([...ENGLISH_BANNED, ...EXTRA_ENGLISH_BANNED, ...SPANISH_BANNED].map(normalize).filter(Boolean)),
];
const BANNED_EMOJI = [...new Set(EMOJI_BANNED.map(stripZeroWidth))];

function containsBannedWord(text) {
  const cleanedEmoji = stripZeroWidth(text);
  if (BANNED_EMOJI.some((seq) => cleanedEmoji.includes(seq))) return true;

  const normalized = ` ${normalize(text)} `;
  return BANNED_PHRASES.some((phrase) => normalized.includes(` ${phrase} `));
}

module.exports = { containsBannedWord, BANNED_PHRASES, BANNED_EMOJI };
