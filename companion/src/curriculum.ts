/**
 * The path. Each node is a *view* the student tends to hold, and which the
 * monk dissolves through prasaṅga (drawing out consequences the student
 * themself cannot accept), never by asserting a counter-thesis.
 *
 * Doctrinal content here is the grounding layer: the monk is told to teach
 * only what is in these notes (plus the sources they cite) and to say so
 * plainly when a question goes beyond them. Quotes are paraphrases unless
 * marked otherwise; verse numbers follow the standard Sanskrit numbering of
 * the Mūlamadhyamakakārikā (MMK).
 */

export type Source = {
  ref: string;
  /** Paraphrase in our own words, or a quote from a CC0/public-domain text. */
  gist: string;
  url?: string;
};

export type ViewNode = {
  id: string;
  /** Short name shown in the sky once the view is seen through. */
  name: string;
  /** The view as a student would say it. */
  view: string;
  /** Ways students often phrase this view, so the monk can recognise it. */
  phrasings: string[];
  /** Nodes that usually come before this one. Purely a suggestion of flow. */
  after: string[];
  optional?: boolean;
  /** Position in the sky, x in [-1, 1], y in [0, 1] from bottom. */
  pos: [number, number];
  /** Opening questions that draw the view out into the open. */
  probes: string[];
  /** The reductio, step by step. Each step is a consequence the student must face. */
  consequences: string[];
  /** What it looks like when the student has genuinely seen through it. */
  signs: string[];
  /** The insight, phrased as the student might arrive at it. */
  insight: string;
  /** The insight in one plain sentence, shown to the visitor with the light ("you saw..."). */
  plain: string;
  /** Why it matters for a life: what loosening this view frees you from. */
  matters: string;
  /** Misreadings the monk must not endorse or create. */
  pitfalls: string[];
  sources: Source[];
};

export const PATH: ViewNode[] = [
  {
    id: "solid-self",
    name: "the self",
    view: "I am a real, separate self: the one in here, behind my eyes.",
    phrasings: [
      "of course I exist",
      "I am my body / my mind / my memories",
      "there has to be someone who is me",
      "I'm the one asking",
    ],
    after: [],
    pos: [0, 0],
    probes: [
      "Who is asking the question?",
      "Point to it. Where exactly is this you?",
      "Is it the same you that was a child?",
    ],
    consequences: [
      "If the self is the body: the body changes completely and you call it 'my body', as one owns a thing. Can the owner be the thing owned?",
      "If the self is the mind: thoughts and feelings arise and pass. Which of them is you? When a thought ends, do you end?",
      "If the self is the whole collection: a collection is just its parts plus a name. Remove the parts one by one; at which point does the self leave?",
      "If the self is something apart from body and mind: then it has no features at all. What is it that you are so sure of?",
      "Like a chariot: not the wheel, not the axle, not the pile of parts, not something beyond them, yet 'chariot' works perfectly well as a name. Is the self any different?",
    ],
    signs: [
      "the student cannot locate the self in or apart from the parts",
      "the student sees 'I' still functions as a name without needing an essence",
      "the student does not jump to 'I don't exist at all' (if they do, that is nothing-exists, not this insight)",
    ],
    insight:
      "The self is not found on analysis, yet 'I' still works: a name given to a changing collection.",
    plain: "The self isn't a thing you can find: \"I\" is a name for a changing pattern, and the name still works.",
    matters: "Much fear, defensiveness and pride comes from guarding a solid \"me\". Seen as a living pattern, there is room to change, to be criticised, to let go.",
    pitfalls: [
      "Do not say the self does not exist at all. Say it does not exist the way it seems to: independently, by its own nature.",
      "Do not replace the small self with a big Self (Atman, cosmic consciousness). That is a different tradition.",
    ],
    sources: [
      {
        ref: "SN 5.10 (Vajirā Sutta)",
        gist: "Just as 'chariot' is spoken of when the parts are assembled, so 'a being' is spoken of when the aggregates are present.",
        url: "https://suttacentral.net/sn5.10/en/sujato",
      },
      {
        ref: "Milindapañha, the chariot dialogue",
        gist: "Nāgasena asks King Milinda whether the chariot is the pole, the axle, the wheels, all together or something else; none is the chariot, yet 'chariot' is a valid designation.",
      },
      {
        ref: "MMK 18.1",
        gist: "If the self were the aggregates, it would arise and cease with them; if it were other than the aggregates, it would lack their characteristics.",
      },
      {
        ref: "Candrakīrti, Madhyamakāvatāra 6.151ff",
        gist: "The sevenfold analysis: the chariot is not identical to its parts, not other than them, does not possess them, is not in them, they are not in it, it is not their mere collection, nor their shape.",
      },
    ],
  },
  {
    id: "witness",
    name: "the witness",
    view: "Fine, but someone is watching all this. The observer, pure awareness, is the real me.",
    phrasings: [
      "but there's an awareness that sees thoughts come and go",
      "I am the watcher",
      "consciousness itself is what I am",
    ],
    after: ["solid-self"],
    pos: [-0.38, 0.2],
    probes: [
      "Have you ever found the watcher, or only things being watched?",
      "Before any seeing happens, where is the seer?",
    ],
    consequences: [
      "If the seer existed before seeing, it would be a seer of nothing. What would make it a seer?",
      "If the seer only exists in seeing, then seer and seeing depend on each other; neither stands on its own.",
      "Try to look at the looker. Like an eye trying to see itself, or teeth trying to bite themselves.",
      "If awareness is aware of objects, it depends on objects. If it is aware of nothing, in what sense is it aware?",
    ],
    signs: [
      "the student sees that the witness is not found apart from what is witnessed",
      "the student stops treating awareness as a hidden permanent core",
    ],
    insight:
      "No watcher stands behind the watching. Seer and seen lean on each other, like two sheaves of reeds.",
    plain: "No one stands behind experience watching it: the watching and the watched lean on each other.",
    matters: "It is tempting to retreat into a detached \"pure observer\" and stand outside your own life. Seeing there is no one behind the glass brings you back into it.",
    pitfalls: [
      "This is where Madhyamaka parts ways with Advaita Vedānta and some neo-advaita: awareness is not a self-existing ground.",
      "Do not deny that experience happens. Deny only that it belongs to an independent owner.",
    ],
    sources: [
      {
        ref: "MMK 3.6",
        gist: "Without seeing, there is no seer; and the seer is not found apart from seeing.",
      },
      {
        ref: "MMK 9.3-5",
        gist: "If someone existed prior to seeing, hearing and feeling, by what would they be known? Without them, how would they be made known?",
      },
      {
        ref: "SN 12.67 (Naḷakalāpī Sutta)",
        gist: "Consciousness and name-and-form support each other like two sheaves of reeds leaning together; remove one and the other falls.",
        url: "https://suttacentral.net/sn12.67/en/sujato",
      },
    ],
  },
  {
    id: "essence",
    name: "own-being",
    view: "At least things are what they are. A cup is really a cup, whatever we call it.",
    phrasings: [
      "things have a nature of their own",
      "the world exists out there independent of us",
      "a tree is a tree",
    ],
    after: ["solid-self"],
    pos: [0.34, 0.16],
    probes: [
      "What makes this cup a cup? Is it the clay, the shape, the use, the name?",
      "Would it still be a cup if no one could ever drink from it?",
    ],
    consequences: [
      "If the cup's cup-ness were its own, independent nature, it could not depend on clay, potter, shape or use. Yet take those away and nothing called 'cup' remains.",
      "Something that has its own nature would not need causes. But everything you can point to came from causes.",
      "What has its own nature could never change, since change would mean losing its nature. Does anything you know never change?",
      "So either things are made from causes, or they have their own nature. Which is it? They cannot be both.",
    ],
    signs: [
      "the student sees that dependence and own-nature exclude each other",
      "the student can name what the cup depends on: parts, causes, and the mind that names it",
    ],
    insight:
      "Whatever depends on other things has no being of its own. That absence of own-being is what 'empty' means.",
    plain: "Nothing is what it is all by itself: a cup is a cup because of clay, shape, use and the ones who drink.",
    matters: "We treat things and people as fixed: \"that's just how he is\", \"I'm just like this\". Seeing that everything is made of relations makes it workable and changeable.",
    pitfalls: [
      "Empty does not mean the cup is not there or does not hold tea.",
      "Do not slide into 'it is all in the mind' (idealism). The mind is just as empty as the cup.",
    ],
    sources: [
      {
        ref: "MMK 15.1-2",
        gist: "It is not reasonable for own-being (svabhāva) to arise from causes and conditions; an own-being that was made would be a contradiction, since own-being means not made and not dependent on another.",
      },
      {
        ref: "MMK 15.8",
        gist: "If something existed by its own nature, it could never become otherwise.",
      },
      {
        ref: "MMK 24.19",
        gist: "There is nothing that is not dependently arisen; therefore there is nothing that is not empty.",
      },
    ],
  },
  {
    id: "causation",
    name: "arising",
    view: "Things really come into being from causes. The seed produces the sprout.",
    phrasings: [
      "cause and effect is just how the world works",
      "everything has a cause",
      "A makes B happen",
    ],
    after: ["essence"],
    pos: [0.46, 0.38],
    probes: [
      "Is the sprout already inside the seed, or is it something new?",
    ],
    consequences: [
      "If the sprout comes from itself (it was already there in the seed), nothing new arises and arising is pointless; it would go on arising forever.",
      "If it comes from something wholly other, then anything could come from anything: rice from a stone, darkness from a flame.",
      "If from both self and other, it inherits both problems.",
      "If from neither, it arises from no cause at all, and then why do seeds matter to farmers?",
      "So real, inherent arising is not found in any of the four ways. Yet farmers still plant seeds. What does that tell you about causes?",
    ],
    signs: [
      "the student walks through the four alternatives and finds none holds",
      "the student keeps conventional causality (planting still works) while dropping real production",
    ],
    insight:
      "Nothing arises by its own power from another thing with its own power. There is dependent arising, which is not the production of real things.",
    plain: "Causes work, but nothing hands its being over to another thing: things arise together, leaning on conditions.",
    matters: "Blame and guilt often picture one solid cause making one solid result. Seeing a web of conditions softens both, and shows where you can act: on the conditions.",
    pitfalls: [
      "Never say causes do not work. Conventionally they work perfectly; it is their inherent existence that is not found.",
    ],
    sources: [
      {
        ref: "MMK 1.1",
        gist: "Not from itself, not from another, not from both, not without a cause: no thing anywhere has ever arisen.",
      },
      {
        ref: "Candrakīrti, Prasannapadā on MMK 1.1",
        gist: "The Prāsaṅgika does not assert the opposite thesis; they only show the opponent the unwanted consequences of their own position.",
      },
      {
        ref: "MMK, dedicatory verses",
        gist: "Homage to the Buddha who taught dependent arising: no ceasing, no arising, no annihilation, no permanence, no coming, no going, no difference, no identity; the pacification of conceptual proliferation.",
      },
    ],
  },
  {
    id: "motion",
    name: "going",
    view: "Change is real. I walk from here to there; time flows.",
    phrasings: ["time passes", "things move", "the present moment is real"],
    after: ["essence"],
    optional: true,
    pos: [0.78, 0.26],
    probes: [
      "Where does the going happen: on the path already walked, the path not yet walked, or somewhere in between?",
    ],
    consequences: [
      "The part already walked is not being walked now; that going is over.",
      "The part not yet walked is not being walked either.",
      "Apart from walked and not-walked, there is no third place for walking to happen.",
      "And the walker: is there a walker without walking? Is there walking without a walker? Each is defined by the other.",
    ],
    signs: [
      "the student sees that mover and movement are defined only in relation to each other",
      "the student does not conclude that nobody walks to the shop (walking works conventionally)",
    ],
    insight:
      "Going and goer lean on each other. Motion is real enough to walk home on, and not findable when you look for it.",
    plain: "Going and goer are defined by each other: change is real enough to live in, and nothing you can pin down.",
    matters: "We try to freeze moments and hold on to how things were. Seeing change as how things are, not something that happens to fixed things, loosens that grip.",
    pitfalls: [
      "Do not present this as Zeno's paradox or as a proof that motion is impossible.",
    ],
    sources: [
      {
        ref: "MMK 2.1",
        gist: "What has been gone over is not being gone over; what has not yet been gone over is not being gone over; apart from these, a being-gone-over is not known.",
      },
      {
        ref: "MMK 2.8",
        gist: "A goer does not go; a non-goer does not go; other than goer and non-goer, what third one goes?",
      },
    ],
  },
  {
    id: "nihilism",
    name: "nothing",
    view: "So nothing really exists. It's all illusion, and nothing matters.",
    phrasings: [
      "everything is an illusion",
      "so nothing is real",
      "then I don't exist",
      "then why care about anything",
    ],
    after: ["witness", "causation"],
    pos: [0.02, 0.46],
    probes: [
      "If nothing exists, who is saying so? And does the saying exist?",
      "When you stub your toe, is the pain nothing?",
    ],
    consequences: [
      "If nothing exists, your statement 'nothing exists' does not exist either, and asserts nothing.",
      "You found that things are not independent. You did not find that they are absent. Dependence is a way of being, not a way of not being.",
      "If emptiness meant nonexistence, then empty things could not work. But it is because a cup is empty of own-being that it can be made, used, broken.",
      "If nothing mattered, kindness and cruelty would be the same. Do they feel the same to the one receiving them?",
    ],
    signs: [
      "the student sees that 'empty' and 'nonexistent' are different",
      "the student sees that action and consequence still function",
    ],
    insight:
      "Empty does not mean nothing. Because things depend on each other, they can work at all. 'Exists' and 'does not exist' are both extremes.",
    plain: "Empty doesn't mean nothing: things lean on each other, and that is how they work at all. Kindness still lands.",
    matters: "\"No self, no essence\" can slide into \"nothing matters\": that is despair, not freedom. It is because things depend on each other that what you do matters.",
    pitfalls: [
      "This is the most dangerous misreading. Never let the student leave thinking emptiness means nihilism or that ethics are void.",
    ],
    sources: [
      {
        ref: "SN 12.15 (Kaccānagotta Sutta)",
        gist: "'Everything exists' is one extreme; 'nothing exists' is the other. Avoiding both, the Realized One teaches by the middle: dependent origination.",
        url: "https://suttacentral.net/sn12.15/en/sujato",
      },
      {
        ref: "MMK 24.14",
        gist: "For one to whom emptiness makes sense, everything makes sense; for one to whom emptiness does not make sense, nothing makes sense.",
      },
      {
        ref: "MMK 24.18",
        gist: "Whatever is dependently arisen, that we call emptiness. That is a dependent designation, and that itself is the middle way.",
      },
      {
        ref: "MMK 15.10",
        gist: "'It exists' is grasping at permanence; 'it does not exist' is the view of annihilation. So the wise do not dwell in existence or nonexistence.",
      },
    ],
  },
  {
    id: "two-truths",
    name: "two truths",
    view: "Then the ultimate truth must be the real world hidden behind these appearances.",
    phrasings: [
      "so ordinary life is fake and the ultimate is real",
      "conventional truth is just a lie we tell",
      "there's a truer reality behind this one",
    ],
    after: ["nihilism"],
    pos: [-0.2, 0.62],
    probes: [
      "Where would you find the ultimate, if not in these very things?",
      "Can you teach the ultimate without using words, which are conventional?",
    ],
    consequences: [
      "If the ultimate were a separate hidden world, it would be one more thing with its own nature. You have already seen there is no such thing.",
      "The ultimate truth about the cup is its emptiness. That emptiness is not somewhere else; it is the cup's own way of being.",
      "Without conventional truth, the ultimate cannot even be pointed at. Without understanding the ultimate, freedom is not reached. So neither can be thrown away.",
    ],
    signs: [
      "the student sees the ultimate as the emptiness of conventional things, not a second world",
      "the student respects conventional truth instead of dismissing it",
    ],
    insight:
      "Two truths, one world. The ultimate is not behind appearances; it is how appearances are.",
    plain: "There is no truer world hiding behind this one: the deepest truth about the cup is right there in the cup.",
    matters: "Looking for the \"real\" life somewhere else, behind or after this one, makes us miss this one. The ordinary world is where the truth is.",
    pitfalls: [
      "Do not present conventional truth as falsehood. It is true in its domain.",
      "Do not present the ultimate as a Platonic realm or as Brahman.",
    ],
    sources: [
      {
        ref: "MMK 24.8-10",
        gist: "The Buddha's teaching relies on two truths: conventional and ultimate. Those who do not see the distinction do not understand the profound. Without relying on the conventional, the ultimate cannot be taught; without understanding the ultimate, nirvāṇa is not attained.",
      },
    ],
  },
  {
    id: "emptiness-absolute",
    name: "emptiness",
    view: "So emptiness is the true nature of reality, the ultimate ground beneath everything.",
    phrasings: [
      "emptiness is the absolute",
      "everything comes from the void",
      "so the answer is emptiness",
    ],
    after: ["two-truths"],
    pos: [0.16, 0.75],
    probes: [
      "Is emptiness itself empty, or is it the one thing that is not?",
    ],
    consequences: [
      "If emptiness had its own nature, it would be the one thing that does not depend on anything. But emptiness is only the emptiness of something; take away the cup and there is no emptiness of the cup.",
      "Then emptiness would become a new essence, and you would cling to it like the old ones.",
      "A medicine that cures the illness must leave the body too. If the medicine stays, it becomes the new illness.",
      "Grasp a snake by the wrong end and it bites. Grasp emptiness as a thing and it bites the same way.",
    ],
    signs: [
      "the student sees that emptiness is itself empty, a description and not a substance",
      "the student stops treating emptiness as something to hold on to",
    ],
    insight:
      "Emptiness is empty too. It is a medicine for views, not a new view to hold.",
    plain: "Emptiness isn't a thing either: it's only a way of saying nothing stands alone. Nothing to grab.",
    matters: "Spiritual ideas easily become new things to cling to and feel superior about. Even \"emptiness\" is a medicine, put down once it has done its work.",
    pitfalls: [
      "Do not describe emptiness as a void, ground, source, or cosmic substance.",
      "Taoist 'wu' and Watts' playful 'Void' language are evocative but not the same claim. Name the difference if it comes up.",
    ],
    sources: [
      {
        ref: "MMK 13.8",
        gist: "The Victorious Ones taught emptiness as the relinquishing of all views. Those for whom emptiness becomes a view, they called incurable.",
      },
      {
        ref: "MMK 24.11",
        gist: "Emptiness wrongly seen ruins the slow-witted, like a snake wrongly grasped or a spell wrongly cast.",
      },
      {
        ref: "MMK 22.11",
        gist: "One should not say 'empty', nor 'not empty', nor both, nor neither. These are said only for the purpose of designation.",
      },
      {
        ref: "Candrakīrti, Prasannapadā on MMK 13.8 (citing the Ratnakūṭa)",
        gist: "Like a purgative that clears out the illness and must itself be passed out, emptiness removes views and must not itself become one.",
      },
    ],
  },
  {
    id: "nirvana-elsewhere",
    name: "the far shore",
    view: "Enlightenment is somewhere else: a special state I must reach, away from this ordinary mess.",
    phrasings: [
      "I need to escape suffering",
      "nirvana is a state of bliss",
      "one day I'll be enlightened",
    ],
    after: ["emptiness-absolute"],
    pos: [-0.08, 0.88],
    probes: [
      "Where is the far shore, if this shore is empty too?",
      "Who would arrive there?",
    ],
    consequences: [
      "If nirvāṇa had its own nature, it would be one more thing, made, conditioned, and so not peace.",
      "If saṃsāra is empty of own-being and nirvāṇa is empty of own-being, what is left to separate them?",
      "The one who wants to get there is the self you could not find. Who, then, is going?",
    ],
    signs: [
      "the student sees that there is no separate place to escape to",
      "the student sees that the craving to arrive is itself the obstacle",
    ],
    insight:
      "There is no other shore. The limit of saṃsāra is the limit of nirvāṇa; not a hair's breadth between them.",
    plain: "There is no other shore to escape to: peace isn't somewhere else, it's the grip loosening here.",
    matters: "Chasing a perfect state later keeps us restless now. Freedom isn't a place you arrive at; it's the grasping easing wherever you are.",
    pitfalls: [
      "This does not mean 'so practice is pointless' or 'you are already perfect, do nothing'. Confusion still has to be seen through.",
    ],
    sources: [
      {
        ref: "MMK 25.19-20",
        gist: "Saṃsāra is not the slightest bit different from nirvāṇa; nirvāṇa is not the slightest bit different from saṃsāra. The limit of nirvāṇa is the limit of saṃsāra; not even a subtle difference is found between them.",
      },
      {
        ref: "MMK 25.24",
        gist: "Peace is the stilling of all grasping and all conceptual proliferation. No dharma was ever taught by the Buddha to anyone, anywhere.",
      },
    ],
  },
  {
    id: "middle-position",
    name: "the middle",
    view: "So the middle way is the correct view: the true position between the extremes.",
    phrasings: [
      "so the answer is the middle way",
      "Madhyamaka is right",
      "the truth is in the middle",
      "what's your view then?",
    ],
    after: ["nirvana-elsewhere"],
    pos: [0.03, 1],
    probes: [
      "Where exactly is the middle? Can you stand on it?",
      "And what is my position, do you think?",
    ],
    consequences: [
      "If the middle were a position, it would be one more view, open to the same analysis as all the others.",
      "Nāgārjuna said: if I had a thesis, that fault would be mine. Every view you brought, you brought; nothing was put in its place.",
      "A raft is for crossing the river. Having crossed, one does not carry it on one's head.",
    ],
    signs: [
      "the student no longer tries to hold any final view, including this one",
      "there may be laughter, or a quiet 'ah'",
    ],
    insight:
      "The middle way is not a place to stand. It is letting go of standing places.",
    plain: "The middle way isn't a position to hold: it's not needing to hold one.",
    matters: "Even the right view, held tightly, becomes another fight. Holding views lightly, you can listen, change your mind and stay kind in disagreement.",
    pitfalls: [
      "Do not say 'all views are equally valid' (relativism). Some views cause suffering; seeing through them is the point.",
    ],
    sources: [
      {
        ref: "Vigrahavyāvartanī 29",
        gist: "If I had any thesis, that fault would be mine. But I have no thesis, so the fault is not mine.",
      },
      {
        ref: "MMK 27.30",
        gist: "I bow to Gautama who, out of compassion, taught the true Dharma for the abandoning of all views.",
      },
      {
        ref: "MN 22 (Alagaddūpama Sutta), the raft",
        gist: "The teaching is like a raft, for crossing over, not for holding on to.",
        url: "https://suttacentral.net/mn22/en/sujato",
      },
    ],
  },
];

/** The final node: not a view, the end of the game. */
export const SILENCE = {
  id: "silence",
  name: "",
  pos: [0, 1] as [number, number],
  sources: [
    {
      ref: "Vimalakīrtinirdeśa, ch. 9",
      gist: "Asked how one enters non-duality, the bodhisattvas each give an answer; Mañjuśrī says it is beyond words; Vimalakīrti stays silent, and Mañjuśrī praises the silence as the true entry.",
    },
  ] satisfies Source[],
};

export const CORE_IDS = PATH.filter((n) => !n.optional).map((n) => n.id);

export function byId(id: string) {
  return PATH.find((n) => n.id === id);
}

/** Public shape sent to the browser: the sky, and what each light means. */
export function sky() {
  return PATH.map(({ id, name, after, pos, optional, view, plain, matters }) => ({
    id,
    name,
    after,
    pos,
    optional: !!optional,
    view,
    plain,
    matters,
  }));
}
